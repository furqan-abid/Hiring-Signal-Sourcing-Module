import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { ModuleState, SourcingCompanyRow } from '../types.js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY are not set');
  }
  client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = '23505';

/** Read module_state; defaults to backfill_done:false when absent. */
export async function loadState(sourcingConfigId: string): Promise<ModuleState> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('module_state')
    .select('sourcing_config_id, backfill_done, last_serp_query')
    .eq('sourcing_config_id', sourcingConfigId)
    .maybeSingle();

  if (error) {
    log.warn('state', `loadState error: ${error.message} — defaulting to not-backfilled`);
  }
  if (!data) {
    return { sourcing_config_id: sourcingConfigId, backfill_done: false, last_serp_query: null };
  }
  return {
    sourcing_config_id: data.sourcing_config_id,
    backfill_done: Boolean(data.backfill_done),
    last_serp_query: data.last_serp_query ?? null,
  };
}

/** Upsert module_state. Non-fatal on error (logged). */
export async function saveState(state: ModuleState): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('module_state').upsert(
    {
      sourcing_config_id: state.sourcing_config_id,
      backfill_done: state.backfill_done,
      last_serp_query: state.last_serp_query,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'sourcing_config_id' },
  );
  if (error) log.error('state', `saveState failed: ${error.message}`);
  else log.info('state', `state saved (backfill_done=${state.backfill_done})`);
}

/** True if (sourcing_config_id, standardised_domain) already exists. */
export async function companyExists(
  sourcingConfigId: string,
  domain: string,
): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sourcing_companies')
    .select('id')
    .eq('sourcing_config_id', sourcingConfigId)
    .eq('standardised_domain', domain)
    .limit(1)
    .maybeSingle();
  if (error) {
    log.warn('insert', `dup check error for ${domain}: ${error.message}`);
    return false; // fall through to insert; the unique index is the backstop.
  }
  return Boolean(data);
}

export type InsertResult = 'inserted' | 'duplicate';

/**
 * Insert a company row. Unique-violation (23505) returns 'duplicate' instead of
 * throwing — the silent-skip the PRD requires, and a race backstop for the pre-check.
 */
export async function insertCompany(row: SourcingCompanyRow): Promise<InsertResult> {
  const supabase = getSupabase();
  const { error } = await supabase.from('sourcing_companies').insert({
    sourcing_config_id: row.sourcing_config_id,
    standardised_domain: row.standardised_domain,
    company_name: row.company_name,
    company_linkedin_tag: row.company_linkedin_tag,
    geography: row.geography,
    company_size: row.company_size,
    custom_fields: row.custom_fields,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      log.info('insert', `duplicate (23505) for ${row.standardised_domain}, skipping`);
      return 'duplicate';
    }
    throw new Error(`insert failed for ${row.standardised_domain}: ${error.message}`);
  }
  log.info('insert', `pushed ${row.company_name} (${row.standardised_domain})`);
  return 'inserted';
}
