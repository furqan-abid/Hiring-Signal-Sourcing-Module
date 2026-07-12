import { config } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { log } from '../lib/logger.js';
import type { RawPosting } from '../types.js';

const SERP_BASE = 'https://serpapi.com/search.json';

interface GoogleJobsItem {
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  detected_extensions?: { posted_at?: string; schedule_type?: string };
  related_links?: { link?: string; text?: string }[];
  apply_options?: { title?: string; link?: string }[];
  job_id?: string;
  share_link?: string;
}

interface GoogleJobsResponse {
  jobs_results?: GoogleJobsItem[];
  serpapi_pagination?: { next_page_token?: string };
  error?: string;
}

interface GoogleSearchResponse {
  organic_results?: { link?: string; title?: string; displayed_link?: string }[];
  error?: string;
}

/** Map a geo label to SerpAPI's `gl` country code. Unknown → us (with a warn). */
export function geoToGl(geos: string[] | undefined): { gl: string; location: string } {
  const first = (geos?.[0] ?? '').trim().toLowerCase();
  const map: Record<string, { gl: string; location: string }> = {
    'united states': { gl: 'us', location: 'United States' },
    usa: { gl: 'us', location: 'United States' },
    us: { gl: 'us', location: 'United States' },
    'united kingdom': { gl: 'uk', location: 'United Kingdom' },
    uk: { gl: 'uk', location: 'United Kingdom' },
    germany: { gl: 'de', location: 'Germany' },
    canada: { gl: 'ca', location: 'Canada' },
    australia: { gl: 'au', location: 'Australia' },
  };
  if (map[first]) return map[first];
  if (first) log.warn('query', `unknown geo "${geos?.[0]}", defaulting to gl=us`);
  return { gl: 'us', location: 'United States' };
}

/**
 * ISO date from Google Jobs' relative `posted_at` ("3 days ago"). Best-effort,
 * null when not parseable. `now` injected for deterministic tests.
 */
export function derivePostedAt(posted: string | undefined, now: Date): string | null {
  if (!posted) return null;
  const m = posted.match(/(\d+)\s*(hour|day|week|month)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const d = new Date(now);
  if (unit === 'hour') d.setHours(d.getHours() - n);
  else if (unit === 'day') d.setDate(d.getDate() - n);
  else if (unit === 'week') d.setDate(d.getDate() - n * 7);
  else if (unit === 'month') d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function pickJobUrl(item: GoogleJobsItem): string | null {
  if (item.apply_options?.[0]?.link) return item.apply_options[0].link;
  if (item.related_links?.[0]?.link) return item.related_links[0].link;
  if (item.share_link) return item.share_link;
  return null;
}

/** Fetch Google Jobs postings for one query, paginating up to `maxPages`. */
export async function searchGoogleJobs(params: {
  query: string;
  gl: string;
  location: string;
  lookbackDays?: number | null;
  maxPages?: number;
  now: Date;
}): Promise<RawPosting[]> {
  if (!config.serpApiKey) throw new Error('SERPAPI_KEY is not set');

  const { query, gl, location, lookbackDays, maxPages = 2, now } = params;
  const postings: RawPosting[] = [];
  let nextPageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(SERP_BASE);
    url.searchParams.set('engine', 'google_jobs');
    url.searchParams.set('q', query);
    url.searchParams.set('gl', gl);
    url.searchParams.set('hl', 'en');
    url.searchParams.set('location', location);
    url.searchParams.set('api_key', config.serpApiKey);
    if (lookbackDays) {
      // google_jobs filters dates via the `chips` param, NOT a bare `date_posted`
      // (SerpAPI silently ignores the latter). Buckets: today | 3days | week | month.
      const bucket =
        lookbackDays <= 1 ? 'today' : lookbackDays <= 3 ? '3days' : lookbackDays <= 7 ? 'week' : 'month';
      url.searchParams.set('chips', `date_posted:${bucket}`);
    }
    if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);

    const data = await fetchJson<GoogleJobsResponse>(
      url.toString(),
      { method: 'GET' },
      `serp:google_jobs:${query}`,
    );

    if (data.error) {
      // e.g. "Google hasn't returned any results" — non-fatal per query.
      log.warn('query', `serp google_jobs error for "${query}": ${data.error}`);
      break;
    }

    const items = data.jobs_results ?? [];
    for (const item of items) {
      if (!item.company_name || !item.title) continue;
      postings.push({
        companyName: item.company_name.trim(),
        jobTitle: item.title.trim(),
        jobUrl: pickJobUrl(item),
        location: item.location?.trim() ?? null,
        postedAt: derivePostedAt(item.detected_extensions?.posted_at, now),
        via: item.via?.replace(/^via\s+/i, '').trim() ?? null,
        description: item.description ?? null,
        employerWebsite: item.related_links?.find((l) => l.text?.toLowerCase().includes('company'))
          ?.link ?? null,
        searchQueryUsed: query,
      });
    }

    nextPageToken = data.serpapi_pagination?.next_page_token;
    if (!nextPageToken) break;
  }

  log.info('query', `"${query}" → ${postings.length} postings`);
  return postings;
}

/** Plain Google search via SerpAPI — organic result links in order. */
export async function googleSearch(query: string): Promise<{ link: string; title: string }[]> {
  if (!config.serpApiKey) throw new Error('SERPAPI_KEY is not set');

  const url = new URL(SERP_BASE);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('gl', 'us');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('num', '10');
  url.searchParams.set('api_key', config.serpApiKey);

  const data = await fetchJson<GoogleSearchResponse>(
    url.toString(),
    { method: 'GET' },
    `serp:google:${query}`,
  );
  if (data.error) {
    log.warn('resolve', `serp google error for "${query}": ${data.error}`);
    return [];
  }
  return (data.organic_results ?? [])
    .filter((r) => r.link)
    .map((r) => ({ link: r.link as string, title: r.title ?? '' }));
}
