import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, config } from '../config.js';
import { log } from '../lib/logger.js';
import type { IcpSegment, IcpVerdict, MatchedJob } from '../types.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  // PRD §6.2: 20s timeout, 2 retries — the SDK retries 429/5xx/network with backoff.
  client = new Anthropic({
    apiKey: config.anthropicApiKey,
    timeout: 20_000,
    maxRetries: 2,
  });
  return client;
}

async function callLlm(system: string, user: string, maxTokens = 1024): Promise<string> {
  const response = await getClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude returned empty content');
  return text;
}

/** Strip ```json fences / stray prose and parse. Throws on invalid JSON. */
export function parseJsonLoose<T>(raw: string): T {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const firstBrace = s.search(/[[{]/);
  if (firstBrace > 0) s = s.slice(firstBrace);
  return JSON.parse(s) as T;
}

/** Generate 3–6 Google Jobs queries from the segment. Returns [] on failure. */
export async function generateSearchQueries(segment: IcpSegment): Promise<string[]> {
  const system =
    'You generate Google Jobs search query strings that find companies hiring for a target ICP. ' +
    'Respond ONLY with a JSON array of 3 to 6 short query strings. No prose, no markdown.';
  const user =
    'Given this ICP segment JSON, output a JSON array of 3-6 Google Jobs search query strings ' +
    'that would find companies hiring for these roles in these geos. ' +
    'Respond ONLY with the JSON array.\n\n' +
    JSON.stringify(
      {
        fixed_signals: segment.fixed_signals ?? [],
        custom_signals: segment.custom_signals ?? [],
        free_text_qualifier: segment.free_text_qualifier ?? '',
        geos: segment.geos ?? [],
      },
      null,
      2,
    );

  try {
    const raw = await callLlm(system, user, 512);
    const arr = parseJsonLoose<unknown>(raw);
    if (Array.isArray(arr)) {
      const queries = arr.map((q) => String(q).trim()).filter(Boolean).slice(0, 6);
      if (queries.length) {
        log.info('query', `generated ${queries.length} queries`, queries);
        return queries;
      }
    }
    log.warn('query', 'query generation returned no usable strings');
    return [];
  } catch (err) {
    log.error('query', `query generation failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

export class VerdictUnparseableError extends Error {
  constructor() {
    super('verdict_unparseable');
    this.name = 'VerdictUnparseableError';
  }
}

export async function qualifyCompany(input: {
  companyName: string;
  domain: string;
  segment: IcpSegment;
  jobs: MatchedJob[];
}): Promise<IcpVerdict> {
  const { companyName, domain, segment, jobs } = input;

  const system =
    'You qualify whether a company matches an ICP for a B2B sourcing tool. ' +
    'The company must be the actual HIRING employer, NOT a staffing/recruitment agency. ' +
    'Staffing agencies include: medical staffing firms, locum tenens agencies, per-diem/travel ' +
    'clinician placement firms, recruitment/executive-search firms, and any company whose ' +
    'business is placing workers at OTHER organizations rather than employing them for its own ' +
    'operations. Names containing "staffing", "personnel", "locums", "recruiting" are strong signals. ' +
    'Return a STRICT JSON object and nothing else with exactly these keys: ' +
    '{"qualified": boolean, "reason": string, "confidence": number (0-1), ' +
    '"is_staffing_agency": boolean, "company_size": string|null, "geography": string|null}. ' +
    'company_size must be one of the ICP size bands or null if unknown (never invent a precise number). ' +
    'geography must be a 2-letter uppercase country code (e.g. "US", "DE") or null.';

  const payload = {
    company: { name: companyName, domain },
    icp_segment: {
      company_sizes: segment.company_sizes ?? [],
      geos: segment.geos ?? [],
      fixed_signals: segment.fixed_signals ?? [],
      custom_signals: segment.custom_signals ?? [],
      free_text_qualifier: segment.free_text_qualifier ?? '',
    },
    open_jobs: jobs.map((j) => ({
      title: j.job_title,
      location: j.location,
      description_snippet: (j.description_snippet ?? '').slice(0, 1200),
    })),
  };

  const user =
    'Qualify this company against the ICP. Respond ONLY with the JSON verdict object.\n\n' +
    JSON.stringify(payload, null, 2);

  const allowedSizes = segment.company_sizes ?? [];

  // API/network errors propagate (→ per-company error upstream). Only a genuine
  // JSON-parse failure, after one strict retry, becomes verdict_unparseable (§6.4).
  const first = tryParseVerdict(await callLlm(system, user, 512), allowedSizes);
  if (first) return first;

  log.warn('icp', `verdict parse failed for ${companyName}, retrying strict`);
  const strictSystem = `${system} You MUST respond ONLY with valid JSON, no prose or markdown.`;
  const second = tryParseVerdict(await callLlm(strictSystem, user, 512), allowedSizes);
  if (second) return second;

  throw new VerdictUnparseableError();
}

/** Parse + normalize a verdict; returns null ONLY on JSON-parse failure. */
function tryParseVerdict(raw: string, allowedSizes: string[]): IcpVerdict | null {
  try {
    return normalizeVerdict(parseJsonLoose<Partial<IcpVerdict>>(raw), allowedSizes);
  } catch {
    return null;
  }
}

function normalizeVerdict(v: Partial<IcpVerdict>, allowedSizes: string[]): IcpVerdict {
  let confidence = typeof v.confidence === 'number' ? v.confidence : 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;
  return {
    qualified: Boolean(v.qualified),
    reason: typeof v.reason === 'string' ? v.reason : '',
    confidence,
    is_staffing_agency: Boolean(v.is_staffing_agency),
    company_size: normalizeSizeBand(v.company_size, allowedSizes),
    geography: normalizeGeoCode(v.geography),
  };
}

/** Accept the model's size only if it matches a declared ICP band; else null (§4: never invent). */
export function normalizeSizeBand(raw: unknown, allowedSizes: string[]): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const key = (s: string) => s.toLowerCase().replace(/[,\s]/g, '');
  const target = key(raw);
  for (const band of allowedSizes) {
    if (key(band) === target) return band; // return the canonical band spelling from the ICP
  }
  return null;
}

/** Coerce to a 2-letter uppercase country code, mapping common names; else null (§4). */
export function normalizeGeoCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const map: Record<string, string> = {
    'united states': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US',
    'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB',
    germany: 'DE', canada: 'CA', australia: 'AU', france: 'FR', ireland: 'IE',
  };
  return map[s.toLowerCase()] ?? null;
}
