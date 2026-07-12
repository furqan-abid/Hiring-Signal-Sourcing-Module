import type { ModuleInputs, RunPayload } from '../types.js';

export interface ValidationError {
  status: 'error';
  error: string;
}

export interface ValidatedRun {
  sourcingConfigId: string;
  segment: NonNullable<NonNullable<RunPayload['default_inputs']>['icp_config']>['segment'];
  moduleInputs: Required<Pick<ModuleInputs, 'lookback_days' | 'max_companies'>> & {
    search_queries_override: string[] | null;
  };
}

const DEFAULTS = { lookback_days: 14, max_companies: 50 };

/** PRD §3 entry validation → ValidatedRun, or ValidationError (handler → 400). */
export function validatePayload(body: unknown): ValidatedRun | ValidationError {
  if (!body || typeof body !== 'object') {
    return { status: 'error', error: 'missing or non-object payload' };
  }

  const payload = body as RunPayload;
  const di = payload.default_inputs;

  const sourcingConfigId = di?.sourcing_config_id;
  if (!sourcingConfigId || typeof sourcingConfigId !== 'string' || !sourcingConfigId.trim()) {
    return { status: 'error', error: 'missing sourcing_config_id' };
  }

  const segment = di?.icp_config?.segment;
  if (!segment || typeof segment !== 'object') {
    return {
      status: 'error',
      error: 'missing default_inputs.icp_config.segment',
    };
  }

  // module_inputs may be missing entirely → all defaults. Unknown fields ignored.
  const mi = payload.module_inputs ?? {};
  const lookback =
    typeof mi.lookback_days === 'number' && mi.lookback_days > 0
      ? Math.floor(mi.lookback_days)
      : DEFAULTS.lookback_days;
  const maxCompanies =
    typeof mi.max_companies === 'number' && mi.max_companies > 0
      ? Math.floor(mi.max_companies)
      : DEFAULTS.max_companies;
  const override =
    Array.isArray(mi.search_queries_override) && mi.search_queries_override.length
      ? mi.search_queries_override.map((q) => String(q)).filter(Boolean)
      : null;

  return {
    sourcingConfigId: sourcingConfigId.trim(),
    segment,
    moduleInputs: {
      lookback_days: lookback,
      max_companies: maxCompanies,
      search_queries_override: override,
    },
  };
}

export function isValidationError(v: ValidatedRun | ValidationError): v is ValidationError {
  return (v as ValidationError).status === 'error';
}
