import { describe, expect, it } from 'vitest';
import { derivePostedAt, geoToGl } from '../src/clients/serpapi.js';

describe('geoToGl', () => {
  it('maps United States to gl=us', () => {
    expect(geoToGl(['United States'])).toEqual({ gl: 'us', location: 'United States' });
  });

  it('defaults unknown geo to us', () => {
    expect(geoToGl(['Atlantis'])).toEqual({ gl: 'us', location: 'United States' });
  });

  it('defaults empty geo to us', () => {
    expect(geoToGl([])).toEqual({ gl: 'us', location: 'United States' });
    expect(geoToGl(undefined)).toEqual({ gl: 'us', location: 'United States' });
  });
});

describe('derivePostedAt', () => {
  const now = new Date('2026-07-11T12:00:00Z');

  it('subtracts days for "3 days ago"', () => {
    expect(derivePostedAt('3 days ago', now)).toBe('2026-07-08');
  });

  it('subtracts weeks', () => {
    expect(derivePostedAt('2 weeks ago', now)).toBe('2026-06-27');
  });

  it('returns null when not parseable', () => {
    expect(derivePostedAt('just posted', now)).toBeNull();
    expect(derivePostedAt(undefined, now)).toBeNull();
  });
});
