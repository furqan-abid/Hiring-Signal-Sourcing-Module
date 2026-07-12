import { describe, expect, it } from 'vitest';
import { normalizeGeoCode, normalizeSizeBand } from '../src/clients/anthropic.js';
import { deriveGeoFromPostings } from '../src/pipeline.js';
import type { CompanyGroup, RawPosting } from '../src/types.js';

function group(location: string | null): CompanyGroup {
  const p: RawPosting = {
    companyName: 'Acme',
    jobTitle: 'CRNA',
    jobUrl: null,
    location,
    postedAt: null,
    via: null,
    description: null,
    employerWebsite: null,
    searchQueryUsed: 'q',
  };
  return { companyName: 'Acme', postings: [p], searchQueryUsed: 'q' };
}

describe('normalizeSizeBand (§4: never invent)', () => {
  const bands = ['51-200', '201-500', '501-1000', '1001-5000', '5001-10,000'];
  it('accepts a value that matches a declared band', () => {
    expect(normalizeSizeBand('1001-5000', bands)).toBe('1001-5000');
  });
  it('matches ignoring commas/whitespace and returns the canonical band', () => {
    expect(normalizeSizeBand('5001-10000', bands)).toBe('5001-10,000');
    expect(normalizeSizeBand(' 501 - 1000 ', bands)).toBe('501-1000');
  });
  it('rejects a non-band / invented value → null', () => {
    expect(normalizeSizeBand('about 3000 employees', bands)).toBeNull();
    expect(normalizeSizeBand('12345', bands)).toBeNull();
    expect(normalizeSizeBand('', bands)).toBeNull();
    expect(normalizeSizeBand(null, bands)).toBeNull();
  });
  it('returns null when no bands are declared', () => {
    expect(normalizeSizeBand('501-1000', [])).toBeNull();
  });
});

describe('normalizeGeoCode (§4: 2-letter or null)', () => {
  it('uppercases a 2-letter code', () => {
    expect(normalizeGeoCode('us')).toBe('US');
    expect(normalizeGeoCode('DE')).toBe('DE');
  });
  it('maps common country names', () => {
    expect(normalizeGeoCode('United States')).toBe('US');
    expect(normalizeGeoCode('germany')).toBe('DE');
  });
  it('returns null for garbage rather than a wrong 2-letter slice', () => {
    expect(normalizeGeoCode('Somewhere')).toBeNull(); // NOT "SO"
    expect(normalizeGeoCode('')).toBeNull();
    expect(normalizeGeoCode(null)).toBeNull();
  });
});

describe('deriveGeoFromPostings (fallback only)', () => {
  it('returns US for an explicit United States location', () => {
    expect(deriveGeoFromPostings(group('Remote, United States'))).toBe('US');
  });
  it('returns US for a real US state code', () => {
    expect(deriveGeoFromPostings(group('Cincinnati, OH'))).toBe('US');
  });
  it('does NOT stamp US for a foreign 2-letter region (non-colliding codes)', () => {
    expect(deriveGeoFromPostings(group('Toronto, ON'))).toBeNull();
    expect(deriveGeoFromPostings(group('London, GB'))).toBeNull();
    expect(deriveGeoFromPostings(group('Paris, FR'))).toBeNull();
    expect(deriveGeoFromPostings(group('Sydney, AU'))).toBeNull();
  });
  it('returns null for an empty/unknown location', () => {
    expect(deriveGeoFromPostings(group(null))).toBeNull();
  });
});
