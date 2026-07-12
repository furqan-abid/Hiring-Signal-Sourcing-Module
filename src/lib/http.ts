import { HTTP_BACKOFF_MS, HTTP_RETRIES, HTTP_TIMEOUT_MS } from '../config.js';
import { log } from './logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * fetch with 20s timeout and 2 retries (backoff 1s/3s) on 429/5xx/network
 * errors — PRD §6.2. Returns the parsed JSON body.
 */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  label = 'request',
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= HTTP_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        if (isRetryable(res.status) && attempt < HTTP_RETRIES) {
          const wait = HTTP_BACKOFF_MS[attempt] ?? 3_000;
          log.warn('http', `${label} got ${res.status}, retry ${attempt + 1} in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw new HttpError(
          `${label} failed: ${res.status}`,
          res.status,
          bodyText.slice(0, 500),
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;

      // Non-retryable status → surface immediately; network/abort → retry.
      if (err instanceof HttpError && !isRetryable(err.status)) throw err;
      if (attempt < HTTP_RETRIES) {
        const wait = HTTP_BACKOFF_MS[attempt] ?? 3_000;
        const reason = err instanceof Error ? err.message : String(err);
        log.warn('http', `${label} network error (${reason}), retry ${attempt + 1} in ${wait}ms`);
        await sleep(wait);
        continue;
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`${label} failed after ${HTTP_RETRIES + 1} attempts`);
}

/** Plain-text variant (used by the Jina reader). Same retry/timeout policy. */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  label = 'request',
): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= HTTP_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        if (isRetryable(res.status) && attempt < HTTP_RETRIES) {
          const wait = HTTP_BACKOFF_MS[attempt] ?? 3_000;
          log.warn('http', `${label} got ${res.status}, retry ${attempt + 1} in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw new HttpError(`${label} failed: ${res.status}`, res.status);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof HttpError && !isRetryable(err.status)) throw err;
      if (attempt < HTTP_RETRIES) {
        const wait = HTTP_BACKOFF_MS[attempt] ?? 3_000;
        await sleep(wait);
        continue;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}
