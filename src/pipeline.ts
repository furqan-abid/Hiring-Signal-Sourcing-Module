import pLimit from 'p-limit';
import { generateSearchQueries, qualifyCompany, VerdictUnparseableError } from './clients/anthropic.js';
import { geoToGl, searchGoogleJobs } from './clients/serpapi.js';
import { companyExists, insertCompany, loadState, saveState } from './clients/supabase.js';
import { BACKFILL_MAX_PAGES, COMPANY_CONCURRENCY, INCREMENTAL_MAX_PAGES } from './config.js';
import { log } from './lib/logger.js';
import { normalizeDomain } from './lib/normalizeDomain.js';
import { resolveDomain } from './steps/domain.js';
import { buildMatchedJobs, dedupePostings } from './steps/jobs.js';
import { resolveLinkedinTag } from './steps/linkedin.js';
import type { CompanyGroup, RawPosting, RunSummary, SourcingCompanyRow } from './types.js';
import type { ValidatedRun as VR } from './steps/validate.js';

export interface RunResult {
  status: 'success';
  sourcing_config_id: string;
  run_mode: 'backfill' | 'incremental';
  summary: RunSummary;
}

function groupByCompany(postings: RawPosting[]): CompanyGroup[] {
  const map = new Map<string, CompanyGroup>();
  for (const p of postings) {
    const key = p.companyName.trim().toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.postings.push(p);
    } else {
      map.set(key, {
        companyName: p.companyName.trim(),
        postings: [p],
        searchQueryUsed: p.searchQueryUsed,
      });
    }
  }
  return [...map.values()];
}

/**
 * One full sourcing run. Per-company failures are caught and counted — only a
 * total pre-loop failure propagates (and becomes the 500).
 */
export async function runPipeline(input: VR, now: Date): Promise<RunResult> {
  const { sourcingConfigId, segment, moduleInputs } = input;
  const summary: RunSummary = {
    queries_run: 0,
    postings_fetched: 0,
    unique_companies: 0,
    pushed: 0,
    duplicates_skipped: 0,
    dropped_no_domain: 0,
    dropped_icp_fail: 0,
    per_company_errors: 0,
  };

  const state = await loadState(sourcingConfigId);
  const runMode: 'backfill' | 'incremental' = state.backfill_done ? 'incremental' : 'backfill';
  log.info('run', `mode=${runMode} for ${sourcingConfigId}`);

  let queries = moduleInputs.search_queries_override;
  if (!queries || !queries.length) {
    queries = await generateSearchQueries(segment ?? {});
  }
  if (!queries.length) {
    log.warn('query', 'no queries available — returning empty run');
    await saveState({ ...state, sourcing_config_id: sourcingConfigId });
    return { status: 'success', sourcing_config_id: sourcingConfigId, run_mode: runMode, summary };
  }

  const { gl, location } = geoToGl(segment?.geos);
  const lookback = runMode === 'incremental' ? moduleInputs.lookback_days : null;
  const maxPages = runMode === 'backfill' ? BACKFILL_MAX_PAGES : INCREMENTAL_MAX_PAGES;

  // Queries run sequentially — gentle on SerpAPI quota.
  const allPostings: RawPosting[] = [];
  let lastQuery: string | null = state.last_serp_query;
  let queryErrors = 0;
  for (const q of queries) {
    summary.queries_run++;
    lastQuery = q;
    try {
      const postings = await searchGoogleJobs({
        query: q,
        gl,
        location,
        lookbackDays: lookback,
        maxPages,
        now,
      });
      allPostings.push(...postings);
    } catch (err) {
      queryErrors++;
      log.error('query', `query "${q}" failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  summary.postings_fetched = allPostings.length;

  // SerpAPI's date buckets are coarse (14d → 'month'), so enforce the exact
  // lookback window here. Undated postings are kept — never over-drop.
  let workingPostings = allPostings;
  if (lookback) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - lookback);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    workingPostings = allPostings.filter((p) => !p.postedAt || p.postedAt >= cutoffStr);
    const dropped = allPostings.length - workingPostings.length;
    if (dropped) log.info('query', `lookback ${lookback}d dropped ${dropped} older postings`);
  }

  const groups = groupByCompany(workingPostings).slice(0, moduleInputs.max_companies);
  summary.unique_companies = groups.length;
  log.info('run', `grouped into ${groups.length} unique companies (cap ${moduleInputs.max_companies})`);

  const seenDomains = new Set<string>();
  const limit = pLimit(COMPANY_CONCURRENCY);

  await Promise.all(
    groups.map((group) =>
      limit(async () => {
        try {
          await processCompany(group, {
            sourcingConfigId,
            segment: segment ?? {},
            seenDomains,
            summary,
          });
        } catch (err) {
          // Backstop — processCompany catches internally too.
          summary.per_company_errors++;
          log.error('run', `unexpected error for ${group.companyName}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    ),
  );

  // State is written only at run end (idempotency: a mid-run crash leaves it
  // untouched). If every backfill query errored, leave backfill_done unchanged
  // so the historical backfill isn't skipped forever.
  const allQueriesFailed = summary.queries_run > 0 && queryErrors === summary.queries_run;
  const backfillDone = runMode === 'backfill' && allQueriesFailed ? state.backfill_done : true;
  if (runMode === 'backfill' && allQueriesFailed) {
    log.warn('state', 'all queries failed during backfill — leaving backfill_done unchanged');
  }
  await saveState({
    sourcing_config_id: sourcingConfigId,
    backfill_done: backfillDone,
    last_serp_query: lastQuery,
  });

  log.info('run', 'run complete', summary);
  return { status: 'success', sourcing_config_id: sourcingConfigId, run_mode: runMode, summary };
}

async function processCompany(
  group: CompanyGroup,
  ctx: {
    sourcingConfigId: string;
    segment: NonNullable<VR['segment']>;
    seenDomains: Set<string>;
    summary: RunSummary;
  },
): Promise<void> {
  const { sourcingConfigId, segment, seenDomains, summary } = ctx;
  const { companyName } = group;

  try {
    if (!companyName.trim()) {
      summary.dropped_no_domain++;
      return;
    }

    const uniquePostings = dedupePostings(group.postings);

    const employerWebsite = uniquePostings.find((p) => p.employerWebsite)?.employerWebsite ?? null;
    const jobUrls = uniquePostings.map((p) => p.jobUrl);
    const rawDomain = await resolveDomain(companyName, employerWebsite, jobUrls);
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      summary.dropped_no_domain++;
      return;
    }

    if (seenDomains.has(domain)) {
      summary.duplicates_skipped++;
      log.info('insert', `in-run duplicate ${domain}, skipping`);
      return;
    }
    seenDomains.add(domain);

    // DB dup-check must stay BEFORE enrichment — it saves the Jina/LLM/LinkedIn
    // calls for companies we already have (PRD §3).
    if (await companyExists(sourcingConfigId, domain)) {
      summary.duplicates_skipped++;
      log.info('insert', `db duplicate ${domain}, skipping`);
      return;
    }

    const matchedJobs = await buildMatchedJobs({ ...group, postings: uniquePostings });

    let verdict;
    try {
      verdict = await qualifyCompany({ companyName, domain, segment, jobs: matchedJobs });
    } catch (err) {
      if (err instanceof VerdictUnparseableError) {
        summary.dropped_icp_fail++;
        log.warn('icp', `${companyName}: verdict_unparseable, dropping`);
        return;
      }
      throw err;
    }

    if (!verdict.qualified || verdict.is_staffing_agency) {
      summary.dropped_icp_fail++;
      log.info(
        'icp',
        `${companyName} dropped (qualified=${verdict.qualified}, staffing=${verdict.is_staffing_agency})`,
      );
      return;
    }

    const linkedinTag = await resolveLinkedinTag(companyName);
    const geography = verdict.geography ?? deriveGeoFromPostings(group);
    const companySize = verdict.company_size ?? null;

    const row: SourcingCompanyRow = {
      sourcing_config_id: sourcingConfigId,
      standardised_domain: domain,
      company_name: companyName,
      company_linkedin_tag: linkedinTag,
      geography,
      company_size: companySize,
      custom_fields: {
        matched_jobs: matchedJobs,
        hiring_signal_matched: (segment.fixed_signals ?? [])[0] ?? null,
        icp_fit_reason: verdict.reason,
        icp_confidence: verdict.confidence,
        search_query_used: group.searchQueryUsed,
        jobs_found_count: uniquePostings.length,
      },
    };

    const result = await insertCompany(row);
    if (result === 'inserted') summary.pushed++;
    else summary.duplicates_skipped++;
  } catch (err) {
    summary.per_company_errors++;
    log.error('run', `company ${companyName} error: ${err instanceof Error ? err.message : err}`);
  }
}

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR',
]);

/**
 * Fallback geography when the LLM verdict has none: US state codes count,
 * arbitrary 2-letter regions ("Toronto, ON") do not. Codes shared with ISO
 * countries (DE = Delaware/Germany) resolve US — rare, fallback-only.
 */
export function deriveGeoFromPostings(group: CompanyGroup): string | null {
  const loc = group.postings.find((p) => p.location)?.location ?? '';
  if (/united states|\bUSA\b/i.test(loc)) return 'US';
  const m = loc.match(/,\s*([A-Za-z]{2})\b/);
  if (m && US_STATES.has(m[1].toUpperCase())) return 'US';
  return null;
}
