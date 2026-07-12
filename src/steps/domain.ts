import { googleSearch } from '../clients/serpapi.js';
import { log } from '../lib/logger.js';
import { isAggregatorDomain, normalizeDomain, toCompanyDomain } from '../lib/normalizeDomain.js';

/**
 * Domain waterfall (PRD §2, hardened): employer website field → apply-URL host
 * → Google search → null (drop-gate). The apply-host step improves accuracy
 * (the apply link IS the employer) and saves a search when it hits.
 */
export async function resolveDomain(
  companyName: string,
  employerWebsite: string | null,
  jobUrls: (string | null)[] = [],
): Promise<string | null> {
  // Step 1: employer website field on the job posting.
  const fromField = toCompanyDomain(normalizeDomain(employerWebsite));
  if (fromField && !isAggregatorDomain(fromField)) {
    log.info('resolve', `${companyName} → ${fromField} (job field)`);
    return fromField;
  }

  // Step 2: employer's own careers host from the apply/job URL.
  for (const url of jobUrls) {
    const d = toCompanyDomain(normalizeDomain(url));
    if (d && !isAggregatorDomain(d)) {
      log.info('resolve', `${companyName} → ${d} (apply host)`);
      return d;
    }
  }

  // Step 3: Google search for the official website.
  try {
    const results = await googleSearch(`"${companyName}" official website`);
    for (const r of results) {
      const d = toCompanyDomain(normalizeDomain(r.link));
      if (d && !isAggregatorDomain(d)) {
        log.info('resolve', `${companyName} → ${d} (search)`);
        return d;
      }
    }
  } catch (err) {
    log.warn('resolve', `domain search failed for ${companyName}: ${err instanceof Error ? err.message : err}`);
  }

  // Step 4: drop-gate.
  log.warn('resolve', `${companyName} → no domain (dropping)`);
  return null;
}
