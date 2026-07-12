import { describe, expect, it } from 'vitest';
import { isAggregatorDomain, normalizeDomain, toCompanyDomain } from '../src/lib/normalizeDomain.js';

describe('normalizeDomain', () => {
  it('strips protocol, www, path and lowercases (PRD §4 hard rule)', () => {
    expect(normalizeDomain('https://www.Foo.com/careers/')).toBe('foo.com');
  });

  it('passes a bare domain through unchanged', () => {
    expect(normalizeDomain('foo.com')).toBe('foo.com');
  });

  it('lowercases an all-caps host', () => {
    expect(normalizeDomain('WWW.FOO.COM')).toBe('foo.com');
  });

  it('strips port and deep path', () => {
    expect(normalizeDomain('http://sub.foo.co.uk:8080/x/y?q=1#z')).toBe('sub.foo.co.uk');
  });

  it('strips credentials', () => {
    expect(normalizeDomain('https://user:pass@bar.com/login')).toBe('bar.com');
  });

  it('strips a trailing dot (FQDN form)', () => {
    expect(normalizeDomain('foo.com.')).toBe('foo.com');
  });

  it('handles protocol-relative URLs', () => {
    expect(normalizeDomain('//www.example.org/path')).toBe('example.org');
  });

  it('returns null for empty / non-domain input', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeDomain('   https://Foo.com/  ')).toBe('foo.com');
  });
});

describe('toCompanyDomain', () => {
  it('strips a leading careers/jobs/apply label to the company apex', () => {
    expect(toCompanyDomain('careers.baptistonline.org')).toBe('baptistonline.org');
    expect(toCompanyDomain('jobs.acme.com')).toBe('acme.com');
    expect(toCompanyDomain('apply.usahealthsystem.com')).toBe('usahealthsystem.com');
  });

  it('handles multi-part TLDs', () => {
    expect(toCompanyDomain('careers.foo.co.uk')).toBe('foo.co.uk');
  });

  it('leaves a non-careers subdomain untouched', () => {
    expect(toCompanyDomain('health.partners.org')).toBe('health.partners.org');
  });

  it('leaves an apex domain untouched and never over-strips', () => {
    expect(toCompanyDomain('acme.com')).toBe('acme.com');
    expect(toCompanyDomain('jobs.com')).toBe('jobs.com');
    expect(toCompanyDomain(null)).toBeNull();
  });

  it('gives a stable dedupe key regardless of waterfall source', () => {
    // apply-host form and search form must collapse to the same identity
    expect(toCompanyDomain(normalizeDomain('https://careers.wellspan.org/x')))
      .toBe(toCompanyDomain(normalizeDomain('https://www.wellspan.org/')));
  });
});

describe('isAggregatorDomain', () => {
  it('flags known job boards / aggregators', () => {
    expect(isAggregatorDomain('indeed.com')).toBe(true);
    expect(isAggregatorDomain('linkedin.com')).toBe(true);
    expect(isAggregatorDomain('jobs.google.com')).toBe(true);
  });

  it('flags subdomains of aggregators', () => {
    expect(isAggregatorDomain('careers.indeed.com')).toBe(true);
  });

  it('flags the newly added job boards and ATS platforms', () => {
    expect(isAggregatorDomain('remotive.com')).toBe(true);
    expect(isAggregatorDomain('usajobs.gov')).toBe(true);
    expect(isAggregatorDomain('doccafe.com')).toBe(true);
    expect(isAggregatorDomain('acme.myworkdayjobs.com')).toBe(true);
    expect(isAggregatorDomain('boards.greenhouse.io')).toBe(true);
    expect(isAggregatorDomain('jobs.lever.co')).toBe(true);
  });

  it('does not flag a real employer domain (incl. legit .org / careers host)', () => {
    expect(isAggregatorDomain('mercyhealth.org')).toBe(false);
    expect(isAggregatorDomain('baptistonline.org')).toBe(false);
    expect(isAggregatorDomain('usahealthsystem.com')).toBe(false);
    expect(isAggregatorDomain(null)).toBe(false);
  });
});
