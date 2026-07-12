import { googleSearch } from '../clients/serpapi.js';
import { log } from '../lib/logger.js';

/**
 * Best-effort LinkedIn company slug via `<company> site:linkedin.com/company`.
 * Extracts `<slug>` from `/company/<slug>`. Returns null on any failure —
 * never throws (nullable field, must not error the pipeline).
 */
export async function resolveLinkedinTag(companyName: string): Promise<string | null> {
  try {
    const results = await googleSearch(`${companyName} site:linkedin.com/company`);
    for (const r of results) {
      const m = r.link.match(/linkedin\.com\/company\/([^/?#]+)/i);
      if (m && m[1]) {
        const slug = decodeURIComponent(m[1]).trim().replace(/\/$/, '');
        if (slug) {
          log.info('linkedin', `${companyName} → ${slug}`);
          return slug;
        }
      }
    }
  } catch (err) {
    log.warn('linkedin', `lookup failed for ${companyName}: ${err instanceof Error ? err.message : err}`);
  }
  return null;
}
