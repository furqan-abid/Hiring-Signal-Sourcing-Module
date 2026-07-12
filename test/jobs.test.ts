import { describe, expect, it } from 'vitest';
import { dedupePostings } from '../src/steps/jobs.js';
import type { RawPosting } from '../src/types.js';

function posting(over: Partial<RawPosting>): RawPosting {
  return {
    companyName: 'Acme',
    jobTitle: 'CRNA',
    jobUrl: null,
    location: 'Mobile, AL',
    postedAt: null,
    via: null,
    description: null,
    employerWebsite: null,
    searchQueryUsed: 'q',
    ...over,
  };
}

describe('dedupePostings', () => {
  it('collapses postings with the same job_url', () => {
    const out = dedupePostings([
      posting({ jobUrl: 'https://x.com/j/1' }),
      posting({ jobUrl: 'https://x.com/j/1' }),
      posting({ jobUrl: 'https://x.com/j/1' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('is case-insensitive on the url key', () => {
    const out = dedupePostings([
      posting({ jobUrl: 'https://X.com/J/1' }),
      posting({ jobUrl: 'https://x.com/j/1' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('falls back to title+location when job_url is null', () => {
    const out = dedupePostings([
      posting({ jobUrl: null, jobTitle: 'CRNA', location: 'Mobile, AL' }),
      posting({ jobUrl: null, jobTitle: 'CRNA', location: 'Mobile, AL' }),
      posting({ jobUrl: null, jobTitle: 'CRNA', location: 'Tampa, FL' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps genuinely distinct jobs', () => {
    const out = dedupePostings([
      posting({ jobUrl: 'https://x.com/j/1' }),
      posting({ jobUrl: 'https://x.com/j/2' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('preserves first-seen order', () => {
    const out = dedupePostings([
      posting({ jobUrl: 'https://x.com/j/1', jobTitle: 'First' }),
      posting({ jobUrl: 'https://x.com/j/2', jobTitle: 'Second' }),
      posting({ jobUrl: 'https://x.com/j/1', jobTitle: 'Dup' }),
    ]);
    expect(out.map((p) => p.jobTitle)).toEqual(['First', 'Second']);
  });
});
