-- Supabase schema for the Hiring Signal Sourcing Module (PRD §5).
-- Run this in the Supabase SQL editor for the test project.

-- Qualified companies, one row per company (company-level granularity).
CREATE TABLE IF NOT EXISTS sourcing_companies (
  idx BIGINT GENERATED ALWAYS AS IDENTITY,
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_config_id UUID NOT NULL,
  standardised_domain TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_linkedin_tag TEXT,
  geography TEXT,
  company_size TEXT,
  custom_fields JSONB,
  surfaced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- DB-level dedupe (belt + suspenders). Insert path catches 23505 as a silent skip.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_per_config
  ON sourcing_companies (sourcing_config_id, standardised_domain);

-- Per-config runtime state. Only two fields, ever (PRD §7.5, §10).
CREATE TABLE IF NOT EXISTS module_state (
  sourcing_config_id UUID PRIMARY KEY,
  backfill_done BOOLEAN NOT NULL DEFAULT false,
  last_serp_query TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
