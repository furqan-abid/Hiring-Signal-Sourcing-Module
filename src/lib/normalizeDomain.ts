/**
 * Reduce a URL/host to a bare comparable domain (PRD §4):
 * `https://www.Foo.com/careers/` → `foo.com`. Null when nothing usable
 * remains — the caller treats null as "no domain" (drop-gate).
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;

  let s = input.trim().toLowerCase();
  if (!s) return null;

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.replace(/^\/\//, ''); // protocol-relative
  s = s.split(/[/?#]/)[0] ?? ''; // path/query/hash

  const at = s.lastIndexOf('@'); // credentials
  if (at !== -1) s = s.slice(at + 1);

  s = s.replace(/:\d+$/, ''); // port
  s = s.replace(/^www\./, '');
  s = s.replace(/\.$/, '').trim(); // trailing dot (FQDN form)

  if (!s || !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(s)) return null;
  return s;
}

/** Leading subdomain labels that denote a careers/portal host, not the company identity. */
const CAREERS_PREFIXES = new Set([
  'careers',
  'career',
  'jobs',
  'job',
  'apply',
  'recruiting',
  'recruit',
  'talent',
  'work',
  'hire',
  'hiring',
  'employment',
  'join',
  'mychart', // Epic patient-portal subdomain (mychart.hfhs.org → hfhs.org)
  'gfj', // google-for-jobs feed subdomain (gfj.smh.com → smh.com)
]);

/**
 * Strip a single leading careers/jobs label (`careers.acme.org` → `acme.org`)
 * so the dedupe key is stable across waterfall sources. Only strips when >2
 * labels remain — never mangles an apex like `careers.com`.
 */
export function toCompanyDomain(domain: string | null): string | null {
  if (!domain) return null;
  const parts = domain.split('.');
  if (parts.length > 2 && CAREERS_PREFIXES.has(parts[0])) {
    return parts.slice(1).join('.');
  }
  return domain;
}

/**
 * Hosts that must never be treated as a company's own domain:
 *   - job boards / aggregators
 *   - ATS platforms (careers/apply pages hosted on a vendor domain)
 *   - generic web properties (search, social, reference)
 */
const AGGREGATOR_DOMAINS = new Set([
  // Job boards / aggregators
  'indeed.com',
  'linkedin.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'monster.com',
  'simplyhired.com',
  'careerbuilder.com',
  'snagajob.com',
  'dice.com',
  'jooble.org',
  'talent.com',
  'jobcase.com',
  'remotive.com',
  'remote.co',
  'weworkremotely.com',
  'wellfound.com',
  'bebee.com',
  'builtin.com',
  'doccafe.com',
  'jobrapido.com',
  'jobs2careers.com',
  'adzuna.com',
  'lensa.com',
  'usajobs.gov',
  'flexjobs.com',
  'ladders.com',
  'nexxt.com',
  'whatjobs.com',
  'simplify.jobs',
  'jobot.com',
  'himalayas.app',
  'workatastartup.com',
  'startup.jobs',
  'otta.com',
  'welcometothejungle.com',
  // Healthcare-specific job boards / societies / unions (surfaced in live runs)
  'womenforhire.com',
  'pedjobs.org',
  'nejmcareercenter.org',
  'asahq.org',
  'afgenvac.org',
  'healthecareers.com',
  'practicelink.com',
  'practicematch.com',
  'gaswork.com',
  'healthjobsnationwide.com',
  // ATS / recruiting platforms (careers pages hosted on a vendor domain)
  'lever.co',
  'greenhouse.io',
  'workable.com',
  'myworkdayjobs.com',
  'icims.com',
  'taleo.net',
  'ashbyhq.com',
  'jobvite.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'applytojob.com',
  'breezy.hr',
  'recruitee.com',
  'jazzhr.com',
  'paylocity.com',
  'ultipro.com',
  'adp.com',
  'ceipal.com',
  'paycomonline.net',
  'oraclecloud.com',
  'career-pages.com',
  'successfactors.com',
  'eightfold.ai',
  'dayforcehcm.com',
  // Generic web properties
  'jobs.google.com',
  'google.com',
  'bing.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'wikipedia.org',
  'crunchbase.com',
  'bloomberg.com',
]);

/** True when `domain` (or a parent of it) is a known aggregator/job-board. */
export function isAggregatorDomain(domain: string | null): boolean {
  if (!domain) return false;
  if (AGGREGATOR_DOMAINS.has(domain)) return true;
  for (const agg of AGGREGATOR_DOMAINS) {
    if (domain.endsWith(`.${agg}`)) return true;
  }
  return false;
}
