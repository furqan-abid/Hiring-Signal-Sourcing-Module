import { fetchText } from '../lib/http.js';
import { log } from '../lib/logger.js';

/**
 * Fallback job-description fetch via the Jina reader (https://r.jina.ai/<url>).
 * Best-effort: any failure returns null (the caller keeps going with null).
 */
export async function fetchDescriptionViaJina(jobUrl: string | null): Promise<string | null> {
  if (!jobUrl) return null;
  try {
    const readerUrl = `https://r.jina.ai/${jobUrl}`;
    const text = await fetchText(readerUrl, { method: 'GET' }, 'jina:reader');
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned.slice(0, 4000) : null;
  } catch (err) {
    log.warn('resolve', `jina fetch failed for ${jobUrl}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
