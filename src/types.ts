// ---- Incoming payload (PRD §3) ----------------------------------------------

export interface IcpSegment {
  id?: string;
  icp_config_id?: string;
  company_sizes?: string[];
  geos?: string[];
  fixed_signals?: string[];
  custom_signals?: string[];
  free_text_qualifier?: string;
}

export interface IcpConfig {
  market?: Record<string, unknown>;
  segment?: IcpSegment;
  persona?: Record<string, unknown>;
}

export interface DefaultInputs {
  sourcing_config_id?: string;
  client_id?: string;
  icp_config?: IcpConfig;
}

export interface ModuleInputs {
  lookback_days?: number;
  max_companies?: number;
  search_queries_override?: string[] | null;
}

export interface RunPayload {
  default_inputs?: DefaultInputs;
  module_inputs?: ModuleInputs;
}

// ---- Internal working shapes ------------------------------------------------

export interface RawPosting {
  companyName: string;
  jobTitle: string;
  jobUrl: string | null;
  location: string | null;
  postedAt: string | null; // ISO date if derivable
  via: string | null;
  description: string | null;
  employerWebsite: string | null; // job-result website field, if present
  searchQueryUsed: string;
}

export interface CompanyGroup {
  companyName: string;
  postings: RawPosting[];
  searchQueryUsed: string; // query that first surfaced this company
}

export interface MatchedJob {
  job_title: string;
  job_url: string | null;
  location: string | null;
  posted_at: string | null;
  via: string | null;
  description_snippet: string | null;
}

export interface IcpVerdict {
  qualified: boolean;
  reason: string;
  confidence: number; // 0..1
  is_staffing_agency: boolean;
  company_size?: string | null; // band string, if inferable
  geography?: string | null; // 2-letter code, if inferable
}

export interface SourcingCompanyRow {
  sourcing_config_id: string;
  standardised_domain: string;
  company_name: string;
  company_linkedin_tag: string | null;
  geography: string | null;
  company_size: string | null;
  custom_fields: Record<string, unknown>;
}

export interface ModuleState {
  sourcing_config_id: string;
  backfill_done: boolean;
  last_serp_query: string | null;
}

// ---- Run summary (PRD §3 response) ------------------------------------------

export interface RunSummary {
  queries_run: number;
  postings_fetched: number;
  unique_companies: number;
  pushed: number;
  duplicates_skipped: number;
  dropped_no_domain: number;
  dropped_icp_fail: number;
  per_company_errors: number;
}
