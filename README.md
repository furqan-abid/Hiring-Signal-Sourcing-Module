# hiring_signal_scraper

## 1. Overview

> **hiring_signal_scraper**: company-level, evergreen sourcing module.
>
> Receives a single JSON POST (default_inputs plus optional module_inputs), derives Google Jobs search queries from the segment's fixed_signals and free_text_qualifier, finds companies actively hiring for those roles in the target geos, resolves and normalises each company's domain, qualifies each company against the ICP config via a Claude API check (size band, geography, and a provider-vs-staffing-agency filter), and inserts qualified companies directly into sourcing_companies. All matched job postings, the ICP-fit reason, and a confidence score are stored in custom_fields. Returns 200 with per-stage counters. Safe to re-trigger after a partial failure.

---

## 2. Quick start

### Environment variables

| Var | Required | Purpose |
|---|---|---|
| `SERPAPI_KEY` | yes | SerpAPI — `google_jobs` + `google` engines |
| `ANTHROPIC_API_KEY` | yes | Claude API (query generation + ICP qualification; model `claude-sonnet-4-6`) |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | yes | Supabase service-role key (server-side only) |
| `PORT` | no | HTTP port, default 3000 |
| `MODULE_SHARED_SECRET` | no | If set, `POST /run` requires header `x-module-secret` |

### Run

```bash
npm install
cp .env.example .env    # fill in keys
npm run dev             # dev (hot reload)
# or: npm run build && npm start
npm test                # 47 unit tests
```

Database setup: run `src/db/schema.sql` in the Supabase SQL editor (creates `sourcing_companies`, the unique index, `module_state`).

### Deploy

Railway: `railway up` — `railway.json` pins build (`npm install && npm run build`), start (`npm start`), healthcheck (`/health`). Set the env vars in the Railway dashboard. Fallback host: Render, same commands.

### curl example (reference payload)

```bash
curl -sX POST "$MODULE_URL/run" -H "content-type: application/json" -d '{
  "default_inputs": {
    "sourcing_config_id": "15e3ed02-e0a2-46da-8f2b-4672e3f496a6",
    "client_id": "22222222-2222-2222-2222-222222222222",
    "icp_config": {
      "segment": {
        "company_sizes": ["51-200","201-500","501-1000","1001-5000","5001-10,000"],
        "geos": ["United States"],
        "fixed_signals": ["hiring for Anesthesia and CRNA"],
        "custom_signals": [],
        "free_text_qualifier": "Look for healthcare providers which have got open roles for Anesthesia and CRNA"
      }
    }
  },
  "module_inputs": { "lookback_days": 14, "max_companies": 50, "search_queries_override": null }
}'
```

(Also in `sample-payload.json`: `curl -sX POST "$MODULE_URL/run" -H "content-type: application/json" --data-binary @sample-payload.json`.)

---

## 3. API

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness. `{"status":"ok"}` |
| `POST` | `/run` | Execute one sourcing run |

### Request shape

`default_inputs.sourcing_config_id` (uuid, required) · `default_inputs.icp_config.segment` (object, required) · `module_inputs` (optional, see §5.2). Unknown/extra fields are ignored.

### Success response (200)

```json
{
  "status": "success",
  "sourcing_config_id": "…",
  "run_mode": "backfill",
  "summary": {
    "queries_run": 4, "postings_fetched": 142, "unique_companies": 61,
    "pushed": 37, "duplicates_skipped": 5, "dropped_no_domain": 7,
    "dropped_icp_fail": 11, "per_company_errors": 1
  }
}
```

### Error responses

| Code | Body | When |
|---|---|---|
| 400 | `{"status":"error","error":"missing sourcing_config_id"}` | id absent/empty |
| 400 | `{"status":"error","error":"missing default_inputs.icp_config.segment"}` | segment absent |
| 401 | `{"status":"error","error":"unauthorized"}` | shared secret set and header wrong |
| 500 | `{"status":"error","error":"<message>"}` | total failure only (never per-company) |

---

## 4. Pipeline

```
validate payload
→ load state for sourcing_config_id (backfill_done?)
→ generate search queries (LLM from segment; override used verbatim if provided)
→ for each query: SerpAPI google_jobs
    (backfill: 5 pages; incremental: 2 pages + chips=date_posted lookback filter)
→ client-side postedAt cutoff to the exact lookback window (incremental only)
→ collect raw postings → group by company name (in-memory)
→ for each unique company (cap max_companies, concurrency 3):
    try {
      dedupe postings (same job across pages collapses by job_url)
      resolve domain: employer field → apply-URL host → Google search
        (aggregator/ATS domains rejected; careers.x.org normalised to x.org)
      no domain? dropped_no_domain++, continue
      in-memory duplicate within run? skip
      DB duplicate (domain + sourcing_config_id)? duplicates_skipped++, continue
        [checked BEFORE enrichment to save API calls]
      attach descriptions (SerpAPI body; Jina fallback; missing → null)
      Claude ICP check → { qualified, reason, confidence, is_staffing_agency,
                        company_size (validated against ICP bands), geography }
      not qualified OR staffing agency? dropped_icp_fail++, continue
      best-effort: linkedin slug, geography (2-letter), company_size (band or null)
      INSERT into sourcing_companies  (23505 → silent duplicate skip)
      pushed++
    } catch { per_company_errors++, continue }
→ write state at END only (backfill_done not set if every query errored)
→ return 200 summary
```

---

## 5. Declarations

### 5.1 Description

> **hiring_signal_scraper:** Searches Google Jobs (via SerpAPI) for postings matching the segment's fixed_signals and free_text_qualifier in the target geos. Groups postings by company, resolves each company's domain, fetches the job description, then uses the Claude API to qualify the company against the ICP config (size band, geography, provider-vs-staffing-agency check). Qualified companies are pushed to sourcing_companies at company level, with all matched jobs, the ICP-fit reason, and confidence stored in custom_fields. Evergreen: first run backfills, subsequent runs fetch only postings from the lookback window.

### 5.2 Input schema

```json
{
  "input_schema": [
    {
      "name": "lookback_days",
      "type": "integer",
      "default": 14,
      "required": false,
      "description": "After backfill, only postings from the last N days are fetched on each run.",
      "interface_suggestion": "Number stepper, 1–90."
    },
    {
      "name": "max_companies",
      "type": "integer",
      "default": 50,
      "required": false,
      "description": "Cap on unique companies processed per run (cost control).",
      "interface_suggestion": "Number input with a cost estimate hint."
    },
    {
      "name": "search_queries_override",
      "type": "string[]",
      "default": null,
      "required": false,
      "description": "Manual Google Jobs queries. When null, queries are AI-generated from the segment's fixed_signals + free_text_qualifier.",
      "interface_suggestion": "Tag input with an 'AI-suggest queries' button that pre-fills from the ICP config — editable before running."
    }
  ]
}
```

### 5.3 Output declaration

| Output field | Source | Status |
|---|---|---|
| standardised_domain | job result website / apply-URL host / search resolution | PRODUCED — drop-gate |
| company_name | Google Jobs employer name | PRODUCED — drop-gate |
| company_linkedin_tag | LinkedIn slug search | BEST-EFFORT — nullable |
| geography | Claude verdict / job location | BEST-EFFORT — nullable |
| company_size | Claude inference, validated against ICP bands | BEST-EFFORT — nullable |
| custom_fields.matched_jobs[] | Google Jobs + Jina | PRODUCED |
| custom_fields.icp_fit_reason / icp_confidence | Claude verdict | PRODUCED |

### 5.4 De-dupe JSON

```json
[ { "field": "standardised_domain" } ]
```

### 5.5 State schema

```json
{
  "state_schema": [
    {
      "name": "backfill_done",
      "type": "boolean",
      "schema_type": "app",
      "default": false,
      "description": "false on first run; the module backfills all current postings for the signal, then sets true. Subsequent runs read this and fetch only the lookback window (evergreen behaviour).",
      "read_recommendation": "Badge on the sourcing config: 'Backfilled / Not backfilled'. Logic: if false → full backfill; if true → incremental run."
    },
    {
      "name": "last_serp_query",
      "type": "string",
      "schema_type": "metadata",
      "default": null,
      "description": "The last Google Jobs query string sent to SerpAPI. Write-only, for debugging failed or empty runs."
    }
  ]
}
```

---

## 6. Error handling and failure modes

| Scenario | Module behaviour | What the response shows |
|---|---|---|
| Empty / non-object body | Reject | `400 missing sourcing_config_id` |
| Missing `sourcing_config_id` | Reject | `400`, names the field |
| Missing `segment` | Reject | `400`, names the path |
| `module_inputs` absent | Defaults (14 / 50 / null) | normal `200` |
| Unknown geo | `gl=us` fallback, warn log, no crash | normal `200` |
| Query returns zero jobs | Log, next query | `200`, counters reflect it |
| ALL queries empty | Not an error | `200` with `pushed: 0` |
| SerpAPI/Jina/LLM/Supabase call fails | 20s timeout; 2 retries, backoff 1s/3s on 429/5xx/network (`src/lib/http.ts`) | absorbed or counted |
| Company domain unresolvable | Drop, continue | `dropped_no_domain++` |
| LinkedIn not found | Insert with NULL tag | row present, tag null |
| Claude verdict not valid JSON | Strip fences → parse → 1 strict retry → drop (`src/clients/anthropic.ts`) | `dropped_icp_fail++` |
| Claude API outage on ICP check | Counted as company error, run continues | `per_company_errors++` |
| One company throws anywhere | try/catch per company, loop continues | `per_company_errors++` |
| Insert hits unique index (23505) | Silent skip, no crash | `duplicates_skipped++` |
| Process killed mid-run | Partial inserts persist; state NOT written | see §7 |
| Every query fails during backfill | `backfill_done` left unchanged, so the backfill re-runs next trigger | `200`, `pushed: 0` |

Logs are stage-tagged: `[query] [resolve] [linkedin] [icp] [insert] [state] [run] [http]`.

---

## 7. Idempotency and re-runs

State is written once, at the end of a successful pass — a run that dies partway leaves `backfill_done` untouched. Already-inserted companies are skipped by three dedupe layers (in-run set, DB pre-check, unique index with 23505 handling), so re-triggering after a partial failure never double-inserts. Tested: killed the process mid-run (7 rows inserted, state absent), re-ran the same payload — run completed, `duplicates_skipped: 4`, final table had zero duplicate domains. A second identical run returns `pushed: 0, duplicates_skipped: N, 200`.

---

## 8. Run summary reference

| Counter | Meaning |
|---|---|
| `queries_run` | Google Jobs queries executed (incl. failed ones) |
| `postings_fetched` | Raw postings returned across all queries/pages |
| `unique_companies` | Distinct companies after grouping, capped at `max_companies` |
| `pushed` | Rows inserted into `sourcing_companies` this run |
| `duplicates_skipped` | Skipped: already in run, already in DB, or 23505 |
| `dropped_no_domain` | Dropped by the domain/name drop-gate |
| `dropped_icp_fail` | Claude said not qualified, staffing agency, or verdict unparseable |
| `per_company_errors` | Companies lost to unexpected errors (run continued) |

`unique_companies = pushed + duplicates_skipped + dropped_no_domain + dropped_icp_fail + per_company_errors`. `run_mode` is `backfill` on a config's first successful pass, `incremental` after.

---

## 9. Design decisions

> **Why a hiring signal module.** The reference ICP payload is itself a hiring signal ("hiring for Anesthesia and CRNA", US healthcare). This module consumes the segment natively: fixed_signals, free_text_qualifier, geos, and company_sizes all directly drive the search and qualification. No field of the payload is ignored.
>
> **Why company-level rows with jobs nested in custom_fields.** The brief fixes granularity at company level. One row per company keeps dedupe clean, and every matched posting is preserved in custom_fields.matched_jobs[] so no evidence is lost. A row-per-job design was considered and rejected because it belongs to job-level granularity, which this brief excludes.
>
> **Why dedupe on standardised_domain only.** At company granularity the domain is the company's identity. Dedupe on custom_fields.job_id (the job-level pattern) was considered and rejected for the same reason. Dedupe is scoped to the sourcing_config_id, enforced both in the application and by a DB unique index. Duplicates are silently skipped per spec: no insert, no update, no error.
>
> **Why exactly two state fields.** The spec asks for state only when necessary. backfill_done (app) is the behaviour-changing flag that makes the module evergreen: first run backfills all current postings, later runs read it and fetch only the lookback window. last_serp_query (metadata) is write-only debug context for empty or failed runs. Nothing else earns its place. last_run_at, totals, and status are deliberately not declared since the platform records those automatically.
>
> **Why an AI qualification step instead of keyword filtering.** Job postings surface many false positives: staffing agencies, job boards, loosely related roles. A per-company Claude check against the full segment JSON, with the job description as evidence, filters these and records a reason and confidence, so every accepted row is auditable via custom_fields.icp_fit_reason. Query generation is also derived from the segment, so the module works for any hiring-signal ICP without code changes. A search_queries_override input keeps a manual escape hatch.
>
> **Why the counters-based response.** A run that returns {"ok":true} hides everything. The summary (postings_fetched, unique_companies, pushed, duplicates_skipped, dropped_no_domain, dropped_icp_fail, per_company_errors) makes every run self-explaining and makes silent data-quality drift visible from the calling application.
>
> **Why per-company error isolation.** A run is a batch over unreliable external sources. Each company is processed in its own try/catch with timeouts and bounded retries on every external call, so one bad source record costs the run exactly one company, never the whole batch. Combined with dedupe and end-of-run state writes, a run that dies partway can simply be triggered again: already-inserted companies skip, nothing double-processes.
>
> **Why drop instead of guess.** Rows missing a resolvable domain or company name are dropped and counted, never padded with guesses. company_linkedin_tag, geography, and company_size are best-effort and honestly NULL when unknown. A NULL is recoverable downstream. A fabricated value is not.

All lines verified true of the final build.

---

## 10. Known limitations

- **Lookback granularity.** Google Jobs' date filter has fixed buckets (today/3days/week/month). The module requests the nearest bucket then applies an exact client-side `posted_at` cutoff — but postings with no derivable date are kept rather than dropped, so a few older postings can enter on incremental runs.
- **Company-size inference is Claude-derived.** Accepted only when it exactly matches a declared ICP band; otherwise NULL. Roughly 12% of rows in test runs carry NULL size.
- **Domain resolution is heuristic.** Employer field → apply-URL host → web search, with an aggregator/ATS block-list. A company whose name is ambiguous (e.g. plain "Baptist") can still resolve to a related-but-wrong org if none of the earlier steps yield a host.
- **Geography fallback ambiguity.** When the Claude verdict omits geography, US-state detection is used; two-letter codes shared with countries (DE = Delaware/Germany) resolve US. Rare — fallback only.
- **SerpAPI coverage.** Results reflect Google Jobs indexing; postings only on niche boards Google doesn't index will be missed.
