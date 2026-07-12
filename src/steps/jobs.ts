import { fetchDescriptionViaJina } from '../clients/jina.js';
import type { CompanyGroup, MatchedJob, RawPosting } from '../types.js';

const SNIPPET_LEN = 1500;

/**
 * Collapse postings describing the same job (SerpAPI repeats them across
 * pages/queries). Identity = job_url, else title+location. First wins.
 */
export function dedupePostings(postings: RawPosting[]): RawPosting[] {
  const seen = new Set<string>();
  const out: RawPosting[] = [];
  for (const p of postings) {
    const key = (p.jobUrl ?? `${p.jobTitle}|${p.location ?? ''}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Build matched_jobs[] from (already de-duplicated) postings. Description from
 * the SerpAPI body; Jina reader fallback capped per company. Missing
 * description = null — never blocks the pipeline.
 */
export async function buildMatchedJobs(
  group: CompanyGroup,
  opts: { maxJobs?: number; maxJinaCalls?: number } = {},
): Promise<MatchedJob[]> {
  const { maxJobs = 10, maxJinaCalls = 2 } = opts;
  const jobs: MatchedJob[] = [];
  let jinaCalls = 0;

  for (const p of group.postings.slice(0, maxJobs)) {
    let description = p.description;
    if (!description && jinaCalls < maxJinaCalls && p.jobUrl) {
      description = await fetchDescriptionViaJina(p.jobUrl);
      jinaCalls++;
    }
    jobs.push({
      job_title: p.jobTitle,
      job_url: p.jobUrl,
      location: p.location,
      posted_at: p.postedAt,
      via: p.via,
      description_snippet: description ? description.slice(0, SNIPPET_LEN) : null,
    });
  }
  return jobs;
}
