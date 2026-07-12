import { describe, expect, it } from 'vitest';
import { isValidationError, validatePayload } from '../src/steps/validate.js';

const good = {
  default_inputs: {
    sourcing_config_id: 'cfg-123',
    client_id: 'client-1',
    icp_config: {
      segment: {
        company_sizes: ['51-200'],
        geos: ['United States'],
        fixed_signals: ['hiring for Anesthesia and CRNA'],
        free_text_qualifier: 'Look for healthcare providers with open CRNA roles',
      },
    },
  },
  module_inputs: { lookback_days: 14, max_companies: 50, search_queries_override: null },
};

describe('validatePayload', () => {
  it('accepts a well-formed payload', () => {
    const v = validatePayload(good);
    expect(isValidationError(v)).toBe(false);
    if (!isValidationError(v)) {
      expect(v.sourcingConfigId).toBe('cfg-123');
      expect(v.moduleInputs.max_companies).toBe(50);
    }
  });

  it('rejects a missing sourcing_config_id with the exact message', () => {
    const bad = { default_inputs: { icp_config: { segment: {} } } };
    const v = validatePayload(bad);
    expect(isValidationError(v)).toBe(true);
    if (isValidationError(v)) expect(v.error).toBe('missing sourcing_config_id');
  });

  it('rejects a missing segment', () => {
    const bad = { default_inputs: { sourcing_config_id: 'x' } };
    const v = validatePayload(bad);
    expect(isValidationError(v)).toBe(true);
  });

  it('applies defaults when module_inputs is absent', () => {
    const noMi = { default_inputs: good.default_inputs };
    const v = validatePayload(noMi);
    expect(isValidationError(v)).toBe(false);
    if (!isValidationError(v)) {
      expect(v.moduleInputs.lookback_days).toBe(14);
      expect(v.moduleInputs.max_companies).toBe(50);
      expect(v.moduleInputs.search_queries_override).toBeNull();
    }
  });

  it('ignores unknown extra fields without crashing', () => {
    const extra = { ...good, junk: { a: 1 }, another: [1, 2, 3] };
    const v = validatePayload(extra);
    expect(isValidationError(v)).toBe(false);
  });

  it('uses a non-empty override array verbatim', () => {
    const withOverride = {
      ...good,
      module_inputs: { search_queries_override: ['q1', 'q2'] },
    };
    const v = validatePayload(withOverride);
    if (!isValidationError(v)) {
      expect(v.moduleInputs.search_queries_override).toEqual(['q1', 'q2']);
    }
  });

  it('rejects a null / non-object body', () => {
    expect(isValidationError(validatePayload(null))).toBe(true);
    expect(isValidationError(validatePayload('nope'))).toBe(true);
  });
});
