import 'dotenv/config';

/**
 * Missing keys do NOT crash startup — /health must stay green regardless.
 * Each client checks its own key at use time and fails that run cleanly.
 */
export const config = {
  serpApiKey: process.env.SERPAPI_KEY ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
  port: Number(process.env.PORT ?? 3000),
  moduleSharedSecret: process.env.MODULE_SHARED_SECRET ?? '',
} as const;

/** Claude model for query generation + ICP checks — locked by PRD §2. */
export const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Per-company concurrency cap — keeps us under SerpAPI/LLM 429s (PRD §6.7). */
export const COMPANY_CONCURRENCY = 3;

/** Pagination depth: backfill fetches broadly, incremental only the lookback window. */
export const BACKFILL_MAX_PAGES = 5;
export const INCREMENTAL_MAX_PAGES = 2;

/** External-call safety knobs (see PRD §6.2). */
export const HTTP_TIMEOUT_MS = 20_000;
export const HTTP_RETRIES = 2;
export const HTTP_BACKOFF_MS = [1_000, 3_000];
