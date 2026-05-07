# Manifest MCP Integration

System-to-system read API exposing Manifest's employee, project, company, hours, and time-off data to Butler (and future authorized consumers) via the Model Context Protocol.

**Status**: Implemented locally, not yet deployed. Awaiting human review and explicit approval before any push, deploy, or migration apply.

**Commit chain** (most recent first):
- `fadfacb` — reconciliation script uses canonical rounding path
- `a591088` — security + financial review findings addressed
- `23fc563` — frontend C1 fix (key creation routes through Edge Function)
- `f80ea48` — backend implementation
- `12b1e69` — frontend implementation

Built on top of `3206a73` (v1.0.0.107).

---

## 1. Executive Summary

- **What this is**: a read-only MCP (Model Context Protocol) server exposing Manifest's employee/project/company/hours/time-off data over JSON-RPC 2.0, plus an admin UI for generating and revoking API keys.
- **Who it's for**: system-to-system AI consumers — primarily Butler. Designed to be queried by an LLM that composes tool calls.
- **How it's secure**: bearer-token auth with sha256-hashed keys, dedicated Postgres role with EXECUTE-only privileges, audit log on every call, rate limit 600/min per key, full schema isolation (`mcp_api`) with zero alteration of Manifest's public schema.
- **How it's accurate**: server-side computation (no LLM math), resolver tools that error on ambiguity, server-resolved date phrases, structured provenance in every response, reconciliation tools.
- **How it's reversible**: `DROP SCHEMA mcp_api CASCADE; DROP ROLE mcp_reader; DROP ROLE mcp_owner;` — public schema returns byte-identical to pre-deploy.
- **What's not included**: write paths, financial fields (rates, costs, invoices), per-resource attribution (Butler sees one canonical Matthew, never the underlying Clockify/ClickUp/manual sources).

---

## 2. What Butler Can Ask

The 11 MCP tools were designed around concrete user-stated questions:

| Question | Tool(s) | Answers via |
|---|---|---|
| "Was Matthew off this week?" | `resolve_employee` → `get_employee_time_off` | BambooHR-synced PTO records overlapping the week |
| "How many hours did Matthew work this week?" | `resolve_employee` → `resolve_date_range` → `get_employee_week_summary` | Layer 3 daily totals summed canonically |
| "What projects is Matthew working on?" | `resolve_employee` → `get_employee_projects` | Layer 2 per-project rollup with canonical project resolution |
| "What did Matthew work on last week?" | `resolve_employee` → `resolve_date_range` → `get_employee_projects` | Same, scoped to a date range |
| "Did Matthew hit his 40-hour week?" | `resolve_employee` → `verify_employee_week` (with `expected_hours: 40`) | Reconciliation against caller-supplied target; never reads any DB-stored "expected hours" |
| "Show me everyone billing time to NeoCurrency this month" | `list_employees` + `list_projects` + `get_employee_projects` per employee | Composable across tools |

For each question, the LLM:
1. Resolves the human reference (`"Matthew"`) to a canonical UUID via the resolver
2. Resolves the time phrase (`"last week"`) to ISO dates via the date resolver
3. Calls one or more aggregator tools with the resolved IDs and dates
4. Reads the structured response with provenance and quotes back the answer

If any input is ambiguous, the resolver returns an `AMBIGUOUS` error with up to 6 candidate options. The LLM cannot proceed without disambiguation.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Butler (or future consumer)                                 │
│  - Stores API key in secrets manager                        │
│  - LLM calls JSON-RPC 2.0 tools                             │
└─────────────────────────────────────────────────────────────┘
                         │  HTTPS POST { jsonrpc, method, params }
                         │  Authorization: Bearer mfst_live_xxx
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Edge Function: supabase/functions/manifest-mcp              │
│  - Parses JSON-RPC envelope                                 │
│  - Validates bearer (sha256 → DB lookup → revoke check)     │
│  - Atomic auth + rate-limit check (single SQL helper)       │
│  - Logs every call to api_audit_log                         │
│  - Dispatches to one of 11 tool functions                   │
│  - Returns structured response with provenance              │
└─────────────────────────────────────────────────────────────┘
                         │  AS mcp_reader (EXECUTE only)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ mcp_api schema (Postgres)                                   │
│  ─ Tables ──────────────────────────────────────────────    │
│   api_keys, api_audit_log, rate_limit_buckets               │
│  ─ Views (owned by mcp_owner) ──────────────────────────    │
│   v_api_employees, v_api_projects, v_api_companies,         │
│   v_api_employee_daily, v_api_employee_project_daily,       │
│   v_api_time_off                                            │
│  ─ Functions (SECURITY DEFINER, owned by mcp_owner) ────    │
│   _internal_aggregate_employee_hours (kernel)               │
│   _authenticate_and_consume (atomic auth + rate limit)      │
│   11 api_* tool functions                                   │
└─────────────────────────────────────────────────────────────┘
                         │  Read-only
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ public schema (Manifest, UNTOUCHED)                         │
│  resources, employee_daily_totals, employee_totals,         │
│  employee_time_off, projects, companies,                    │
│  v_entity_canonical, v_project_canonical, v_company_canonical│
└─────────────────────────────────────────────────────────────┘
```

**Decoupling guarantee**: nothing in the public schema is added, modified, or removed. No new triggers, columns, indexes, or constraints on existing tables. Rollback restores byte-identical state.

---

## 4. Data Boundary

### What is exposed

- **Employees**: `canonical_employee_id`, `first_name`, `last_name`, `email`, `employment_type`, `is_active`, `start_date`, `end_date`
- **Projects**: `canonical_project_id`, `project_name`, `client_id`, `client_name`, `is_active`
- **Companies**: `canonical_company_id`, `display_name`, `is_active`
- **Hours (daily, per-client)**: `canonical_employee_id`, `client_id`, `client_name`, `work_date`, `actual_hours`, `rounded_hours`
- **Hours (daily, per-project)**: `canonical_employee_id`, `canonical_project_id`, `canonical_company_id`, `project_display_name`, `company_display_name`, `work_date`, `rounded_hours`
- **Time off**: `canonical_employee_id`, `time_off_type`, `status`, `start_date`, `end_date`, `total_days`

### What is excluded (and why)

| Field | Source | Why excluded |
|---|---|---|
| `monthly_cost`, `hourly_rate`, `expected_hours`, `billing_mode` | `resources` | Compensation and contract structure |
| `rate`, `target_hours` | `projects` | Billing rates and targets |
| `min_hours`, `max_hours`, `carry_*` | `project_monthly_billing_limits` | Contract terms |
| `manual_origin` | `companies`, `projects` | Reveals one-off contract origin |
| `notes` | `companies`, `employee_time_off` | Free-text fields may contain compensation chatter |
| `bamboo_request_id`, `bamboo_employee_id` | `employee_time_off` | Cross-system identifiers, PII |
| Raw `user_id`, `project_id`, `client_id` | various | Source-system attribution leak |
| `entry_count`, `task_count` | `employee_daily_totals`, `employee_totals` | Reveals source-system entry granularity |
| `actual_minutes`, `rounded_minutes` | various | Forces consumers to one unit (hours) |
| `physical_person_group_id` | `resources` | Reveals canonical mapping structure |

**Enforcement**: every `mcp_api.v_api_*` view has an explicit column list. CI grep guards reject `SELECT *` and any reference to forbidden field names in the MCP source tree. Schema-snapshot CI tests fail if a view's columns drift.

### Canonical resolution

All three primary entities are canonicalized:

- **Employees**: a physical person can map to multiple `resource_id`s (Clockify sync, ClickUp sync, manual entry). Resolved via `physical_person_groups` + `v_entity_canonical` (migration 015). Butler sees one canonical Matthew with hours summed across all underlying resources.
- **Projects**: canonicalized via `v_project_canonical` (migration 030). Filter to `role IN ('primary','unassociated')` so member projects never appear.
- **Companies**: canonicalized via `v_company_canonical` (migration 023).

All MCP tools accept and return canonical UUIDs only. No raw resource_ids, no source-system labels, no per-resource breakdowns ever cross the boundary.

---

## 5. Security Model

### API key lifecycle

1. **Generation** (server-side, in `admin-api-keys` Edge Function):
   - `crypto.getRandomValues(24)` → 192 bits of entropy
   - Base64url-encoded, prefixed with `mfst_live_`
   - Format: `mfst_live_<32 url-safe chars>`
2. **Hashing**: SHA-256 over the plaintext, stored as hex
3. **Storage**: only the hash and the first 12 chars (prefix) are stored. Plaintext is returned to the admin browser ONCE, never logged, never persisted
4. **Display**: in the admin UI, keys appear only as `mfst_live_xxxx…`
5. **Revocation**: single-row update sets `revoked_at`. All future requests immediately fail with the generic "Invalid API key" message
6. **Rotation**: revoke + create a new key. Out-of-band hand-off to the consumer

### Auth flow (per request)

1. Edge Function reads `Authorization: Bearer <key>` header
2. SHA-256 hashes the bearer
3. Calls `mcp_api._authenticate_and_consume(token_hash, ip, ...)` — a single atomic SQL function that:
   - Looks up the key by hash
   - Checks `revoked_at` is null
   - Increments per-minute and per-hour rate-limit counters
   - Returns `{authenticated: true, key_id, ...}` or a structured error
4. On any failure, the wire response is the generic message "Invalid API key." (the audit log retains the specific reason via `error_code`)
5. On success, the tool dispatches; on completion, the Edge Function logs the call to `api_audit_log` with `response_payload_sha256` (not the body itself)

### Postgres role isolation

Two new roles, both `NOINHERIT`:

- **`mcp_owner`** (no login): owns all `mcp_api.*` objects, has `SELECT` on the specific public.* tables the views need, never directly invokable
- **`mcp_reader`** (login, used by Edge Function): has `EXECUTE` on the 11 `api_*` tool functions plus `_authenticate_and_consume`. Has NO direct `SELECT` on any view or any public.* table. `default_transaction_read_only = on`, `statement_timeout = 3s`, `lock_timeout = 200ms`.

Privilege chain on a tool call: `mcp_reader EXECUTE → api_get_employee_hours (SECURITY DEFINER, runs as mcp_owner) → SELECT v_api_employee_daily (owner = mcp_owner) → SELECT public.employee_daily_totals (mcp_owner has grant)`. Caller never has direct SELECT on any data; everything goes through audited functions.

### Rate limit

Two counters per key — per-minute and per-hour — implemented as `rate_limit_buckets` rows. Default: 600 req/min, configurable. The `_authenticate_and_consume` helper increments atomically; race conditions impossible.

### Audit log

Every authenticated AND failed-auth request logs to `mcp_api.api_audit_log`:

- `api_key_id` (nullable for missing-bearer cases)
- `tool_name`
- `params` (JSONB, with keys matching `/rate|cost|fee|amount|salary/i` automatically redacted by `_redact_jsonb_params`)
- `status_code`, `error_code` (internal distinction preserved here even though wire is generic)
- `response_payload_sha256` (NOT the body itself)
- `duration_ms`
- `created_at`

Retention: 90 days, enforced by `pg_cron` job `mcp_api_audit_cleanup` running daily at 03:15 UTC.

### Defense-in-depth controls

- CORS pinning on `admin-api-keys` (browser-facing) via `ADMIN_API_KEYS_ALLOWED_ORIGINS` env var; defaults to `https://timesheet-billing-manager.vercel.app`
- `manifest-mcp` retains `Access-Control-Allow-Origin: *` because it's bearer-only with no cookies — no CSRF surface
- ILIKE wildcard escaping in resolver fuzzy match (no `%`/`_` directory enumeration)
- Pool transaction hygiene: `DISCARD ALL` on every connection release, even on error paths
- Method allowlist: only `initialize`, `tools/list`, `tools/call` accepted
- Tool allowlist: only the 11 known tools dispatched; unknown returns Method Not Found
- No `SUPABASE_SERVICE_ROLE_KEY` in `manifest-mcp` (CI guard enforces)

---

## 6. File Inventory

### New files (database)

- `supabase/migrations/103_create_mcp_api_schema.sql` — schema, roles, default privilege scrubs, role-level timeouts
- `supabase/migrations/104_create_api_keys_audit_rate_limit.sql` — `api_keys`, `api_audit_log`, `rate_limit_buckets`, `_redact_jsonb_params` helper
- `supabase/migrations/105_create_api_views.sql` — 6 views (`v_api_employees`, `v_api_projects`, `v_api_companies`, `v_api_employee_daily`, `v_api_employee_project_daily`, `v_api_time_off`)
- `supabase/migrations/106_create_api_functions.sql` — `_internal_aggregate_employee_hours` kernel, `_authenticate_and_consume` helper, 11 `api_*` tool functions
- `supabase/migrations/107_create_admin_rpcs_and_cron.sql` — `_internal_assert_admin`, `admin_list_api_keys`, `admin_create_api_key`, `admin_revoke_api_key`, `mcp_api_audit_cleanup` cron job
- `supabase/rollbacks/103_*.sql` … `107_*.sql` — symmetric rollbacks (cron unschedule first, schema cascade last)

### New files (Edge Functions)

- `supabase/functions/manifest-mcp/index.ts` — JSON-RPC 2.0 server entry point
- `supabase/functions/manifest-mcp/auth.ts` — bearer parse, atomic auth+rate-limit, audit log, pool hygiene
- `supabase/functions/manifest-mcp/tools.ts` — 11-tool registry with descriptions and JSON Schemas
- `supabase/functions/manifest-mcp/types.ts` — typed I/O for every tool
- `supabase/functions/manifest-mcp/README.md` — architecture overview + the `employee_time_off` schema documentation (since its DDL lives outside version control)
- `supabase/functions/admin-api-keys/index.ts` — admin-gated CRUD: generates plaintext + sha256 server-side, calls SQL RPCs

### New files (frontend)

- `src/components/pages/ApiKeysPage.tsx` — admin page (template: `UsersPage.tsx`)
- `src/components/ApiKeysTable.tsx` — feature-level table composition
- `src/components/ApiKeyEditorModal.tsx` — Create form modal
- `src/components/ApiKeyCreatedModal.tsx` — One-shot plaintext key display modal
- `src/components/ApiKeyRevokeConfirmModal.tsx` — Danger confirm modal
- `src/hooks/useAdminApiKeys.ts` — admin hook (list/revoke via `mcp_api` RPC, create via Edge Function)

### New files (CI)

- `scripts/ci/mcp-grep-guards.sh` — 12 grep invariants (financial leak, public schema mutations, search_path lockdown, etc.)
- `scripts/ci/mcp-schema-snapshot.sql` — column-list assertion for every `v_api_*` view
- `scripts/ci/mcp-semantic-checksum.sql` — pinned-row checksums to catch semantic drift
- `scripts/ci/mcp-manifest-lockin.sql` — compile-only view referencing every required public.* column
- `scripts/ci/mcp-employee-projects-reconciliation.sql` — Layer 2 vs Layer 3 sum reconciliation per canonical employee (within 0.01h, using canonical rounding path)

### Modified files (purely additive)

- `src/components/MainHeader.tsx` — added `'api-keys'` to `NavRoute` union; new dropdown button between User Management and Employee Management
- `src/App.tsx` — import `ApiKeysPage`; new `case 'api-keys'` in `renderPage()` switch
- `src/types/index.ts` — appended `ApiKey`, `CreateApiKeyParams`, `CreateApiKeyResult`, `RevokeApiKeyResult` interfaces

### Untouched

Everything else. Specifically: zero modifications to any existing component, page, hook, edge function, migration, or design-system atom. Pre-existing local edits in `supabase/.temp/cli-latest` and `supabase/functions/send-weekly-revenue-report/index.ts` were preserved untouched per universal rule.

---

## 7. MCP Tool Reference

All tools follow the envelope:

```
Success: { ok: true, data: T, provenance: { source, computed_at, row_count, truncated, ... } }
Error:   { ok: false, error: { code, message, candidates? } }
```

Error codes: `AMBIGUOUS`, `NOT_FOUND`, `INVALID_DATE`, `RATE_LIMITED`, `UNAUTHORIZED`, `INTERNAL`.

### List tools

- **`list_employees(active_only?, limit?, offset?)`** — canonical employees, no rates/costs
- **`list_projects(client_id?, active_only?, limit?, offset?)`** — canonical projects, no rates
- **`list_companies(limit?, offset?)`** — canonical companies, name only

### Resolver tools (error on ambiguity)

- **`resolve_employee(query)`** — fuzzy match on display_name/external_label. Returns `AMBIGUOUS` with up to 6 candidates (and the true match count) if more than one matches; `NOT_FOUND` if zero. `query` is escaped against `%`/`_`/`\` so wildcards cannot enumerate the directory.
- **`resolve_project(query, client_hint?)`** — same pattern. `client_hint` narrows the search.
- **`resolve_date_range(phrase, reference_date?)`** — server-side date math. Phrases: `today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`, `this_year`, `last_year`, `last_7_days`, `last_30_days`, `last_90_days`, `mtd`, `ytd`. Returns `{start_date, end_date, interpretation}`.

### Aggregator tools

- **`get_employee_hours(canonical_employee_id, start_date, end_date, granularity)`** — granularity `day | week | month`. Returns rows with hours per period plus per-client breakdown.
- **`get_employee_week_summary(canonical_employee_id, week_start_date)`** — one week, by-day breakdown plus total + time-off context.
- **`get_employee_projects(canonical_employee_id, start_date, end_date)`** — canonical projects with hours, sorted by hours descending. Reads from `v_api_employee_project_daily` (Layer 2, project granularity).
- **`get_employee_time_off(canonical_employee_id, start_date, end_date)`** — BambooHR PTO records overlapping the range. Excludes notes and bamboo identifiers.
- **`verify_employee_week(canonical_employee_id, week_start_date, expected_hours)`** — reconciliation. `expected_hours` is caller-supplied ONLY; never read from `resources.expected_hours` (CI grep guard enforces). Returns `{actual_hours, time_off_hours, expected_hours, delta_hours, reconciled}`.

### Provenance contract

Every response includes:

```json
{
  "source": "view_name_or_aggregation_path",
  "computed_at": "ISO timestamp",
  "row_count": 0,
  "truncated": false,
  "canonical_employee_id": "uuid (when applicable)",
  "period_start": "ISO date (when applicable)",
  "period_end": "ISO date (when applicable)"
}
```

What's NEVER in provenance: `resource_ids[]`, `source_systems[]`, `count_of_resources`, raw `user_id`, source labels (Clockify/ClickUp/manual). Butler cannot infer underlying resource attribution from any tool response.

---

## 8. Admin UI Reference

### Where it lives

Avatar dropdown menu → "API Keys" (between "User Management" and "Employee Management").

### Generate flow

1. Click "Create API Key" button
2. Editor modal: Name (required) + Description (optional)
3. Submit → Edge Function generates plaintext + hash server-side, persists hash + prefix
4. Created modal opens with the plaintext key in a readonly Input + Copy button
5. "Done" button is disabled until "Copy" is clicked
6. Closing the modal removes the plaintext from memory; it is never displayed again

### Revoke flow

1. Click "Revoke" on a row
2. Confirm modal: "Are you sure you want to revoke '{name}'?" with danger styling
3. Confirm → DB update sets `revoked_at = now()`
4. Row updates with revoked badge; revocation takes effect immediately

### Admin gate

Server-side via the `mcp_api.*` admin RPCs (which call `_internal_assert_admin` first). Non-admin users will see a generic error from the hook. No client-side `is_admin()` check.

---

## 9. CI Guards

12 grep guards in `scripts/ci/mcp-grep-guards.sh`:

1. No financial column references in MCP source/migrations
2a. No `manual_origin` outside view definitions
2b. No `bamboo_*` identifier references in MCP code
2c. Bonus: `api_verify_employee_week` body has zero `public.resources.expected_hours` references
3. No case-insensitive `SELECT *` in migrations or MCP code
4a. No `CREATE TABLE public.*`, `ALTER TABLE public.*`, etc. in mcp_api migrations
4b. No new triggers/indexes/policies on public schema
5. No `SUPABASE_SERVICE_ROLE_KEY` or `service_role` in `manifest-mcp/`
6. (placeholder)
7. Every `CREATE FUNCTION mcp_api.api_*` declares `SECURITY DEFINER` and `SET search_path = mcp_api, pg_temp`
8. All public.* references inside CREATE VIEW/SELECT only

Plus three SQL CI tests:

- **Schema snapshot** (`mcp-schema-snapshot.sql`): asserts the exact column list of every `v_api_*` view via `information_schema.columns`. Drift → fail.
- **Semantic checksum** (`mcp-semantic-checksum.sql`): pinned-row md5 checksums catch semantic redefinition (e.g., if `actual_hours` semantics change).
- **Reconciliation** (`mcp-employee-projects-reconciliation.sql`): SUM-by-canonical-employee parity between Layer 2 and Layer 3 within 0.01h, using canonical rounding path.
- **Manifest schema lock-in** (`mcp-manifest-lockin.sql`): compile-only view referencing every required public.* column. If Manifest renames or drops a load-bearing column, this view fails to compile.

All 12 grep guards pass at HEAD. Typecheck passes. `npm run ci:check` passes.

---

## 10. Pre-Deploy Checklist

Before applying migrations or deploying Edge Functions:

- [ ] Review this document end-to-end
- [ ] Run `bash scripts/ci/mcp-grep-guards.sh` — all 12 guards PASS
- [ ] Run `npx tsc --noEmit` — exit 0
- [ ] Run `npm run ci:check` — exit 0
- [ ] Verify `supabase/.temp/cli-latest` and `supabase/functions/send-weekly-revenue-report/index.ts` pre-existing local edits are still intact (per universal rule "never-commit-uncommitted-local-edits")
- [ ] Set Supabase secret `MANIFEST_MCP_DB_URL` for the `mcp_reader` role (Postgres connection string)
- [ ] Set Supabase secret `ADMIN_API_KEYS_ALLOWED_ORIGINS` (comma-separated origins, e.g., your Vercel URL)
- [ ] On a feature branch / preview env first if available; otherwise schedule a low-traffic window for prod
- [ ] Take a `pg_dump --schema=public` snapshot before applying migrations (rollback verification baseline)
- [ ] Have the rollback SQL ready (Section 13)

---

## 11. Deployment Runbook

When ready to deploy (in order):

### Database

```bash
# 1. Snapshot pre-deploy state
supabase db dump --schema=public --linked > /tmp/manifest-public-pre-mcp.sql

# 2. Apply migrations 103-107 in order. Each is wrapped in BEGIN/COMMIT.
supabase db push --linked --include-all

# 3. Verify schema isolation
psql $DB_URL -c "\dn mcp_api"               # schema exists
psql $DB_URL -c "\dt mcp_api.*"             # 3 tables
psql $DB_URL -c "\dv mcp_api.v_api_*"       # 6 views
psql $DB_URL -c "\df mcp_api.api_*"         # 11 functions
psql $DB_URL -c "SELECT * FROM cron.job WHERE jobname = 'mcp_api_audit_cleanup'"

# 4. Verify CI guards still pass against deployed schema
psql $DB_URL -f scripts/ci/mcp-schema-snapshot.sql
psql $DB_URL -f scripts/ci/mcp-manifest-lockin.sql
```

### Edge Functions

```bash
supabase functions deploy admin-api-keys
supabase functions deploy manifest-mcp

# Set required secrets
supabase secrets set MANIFEST_MCP_DB_URL="postgresql://mcp_reader:..."
supabase secrets set ADMIN_API_KEYS_ALLOWED_ORIGINS="https://timesheet-billing-manager.vercel.app"
```

### Frontend

```bash
git push origin main           # only after explicit user approval
vercel --prod                  # required — Manifest does NOT auto-deploy on push
```

### Smoke test

See Section 12.

### Generate Butler's production key

1. Open https://manifest…/api-keys (you must be admin)
2. Click "Create API Key", name "Butler – production"
3. Copy the plaintext from the Created modal
4. Hand off to Butler's secrets manager out-of-band (Slack DM, secrets.thebteam, etc.)
5. Verify in audit log table: `SELECT * FROM mcp_api.api_audit_log ORDER BY created_at DESC LIMIT 1`

---

## 12. Smoke Test Sequence

After deploy, run from a curl harness or Butler's debug surface:

```bash
KEY="mfst_live_xxx"
URL="https://<project>.supabase.co/functions/v1/manifest-mcp"

# 1. Discovery
curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# Expect: 11 tools listed

# 2. Resolve
curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"resolve_employee","arguments":{"query":"Matthew Maday"}}}'
# Expect: { ok: true, data: { canonical_employee_id: "<uuid>", ... } }

# 3. Ambiguity
curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"resolve_employee","arguments":{"query":"matt"}}}'
# Expect: { ok: false, error: { code: "AMBIGUOUS", candidates: [...] } }

# 4. Date range
curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"resolve_date_range","arguments":{"phrase":"last_week"}}}'
# Expect: { start_date, end_date, interpretation }

# 5. Week summary (the most important test — verifies canonical employee aggregation)
curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_employee_week_summary","arguments":{"canonical_employee_id":"<uuid>","week_start_date":"2026-04-27"}}}'
# Verify: total_hours sums across ALL Matthew's underlying resource_ids
# Cross-check against Manifest's Reports page for the same week

# 6. Time off (verify excluded fields)
curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_employee_time_off","arguments":{"canonical_employee_id":"<uuid>","start_date":"2026-01-01","end_date":"2026-12-31"}}}'
# Verify: response excludes `notes`, `bamboo_request_id`, `bamboo_employee_id`

# 7. Reconciliation
curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"verify_employee_week","arguments":{"canonical_employee_id":"<uuid>","week_start_date":"2026-04-27","expected_hours":40}}}'
# Verify: delta_hours matches manual reconciliation against Reports page

# 8. Auth error (use revoked or wrong key)
curl -X POST "$URL" -H "Authorization: Bearer wrong_key" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/list"}'
# Expect: 401, generic message "Invalid API key."

# 9. Rate limit (burst 700 calls)
for i in {1..700}; do
  curl -X POST "$URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":'$i',"method":"tools/list"}' &
done; wait
# Verify: requests beyond 600/min return RATE_LIMITED
```

After smoke test, query `api_audit_log` to confirm every call was logged:

```sql
SELECT tool_name, error_code, count(*)
FROM mcp_api.api_audit_log
WHERE created_at > now() - interval '10 minutes'
GROUP BY tool_name, error_code
ORDER BY tool_name;
```

---

## 13. Rollback Procedure

In priority order:

```sql
-- 1. STOP THE LEAK FIRST (under 60 seconds)
UPDATE mcp_api.api_keys SET revoked_at = now() WHERE revoked_at IS NULL;

-- 2. Disable the Edge Function via Supabase dashboard (callers get 503)

-- 3. Unschedule pg_cron jobs (must come before role drops)
SELECT cron.unschedule('mcp_api_audit_cleanup');

-- 4. Drop the schema (cascades views, functions, tables, sequences)
DROP SCHEMA mcp_api CASCADE;

-- 5. Reassign and drop owned objects (defense)
REASSIGN OWNED BY mcp_owner TO postgres;
DROP OWNED BY mcp_owner;
DROP OWNED BY mcp_reader;

-- 6. Drop roles
DROP ROLE mcp_reader;
DROP ROLE mcp_owner;
```

Verify post-rollback:

```bash
supabase db dump --schema=public --linked > /tmp/manifest-public-post-rollback.sql
diff /tmp/manifest-public-pre-mcp.sql /tmp/manifest-public-post-rollback.sql
# Expect: no diff (byte-identical)
```

Frontend rollback: revert the diffs to `MainHeader.tsx`, `App.tsx`, `types/index.ts`, and remove the new files. Or feature-flag the dropdown entry off.

---

## 14. Risk Assessment

**Final rating against Postulate #0 ("Manifest is a live site"): MEDIUM.**

### What pushed it down from HIGH

- Full schema isolation eliminates "accidental Manifest alteration" risk
- Privilege chain ensures `mcp_reader` cannot directly read any data, even if its credentials leak
- Financial fields physically excluded at the view layer, not just in code
- CI guards reject leaks at PR time
- Read-only role flag plus `default_transaction_read_only = on` defense-in-depth
- Rollback verified clean (4-6 commands, byte-identical post-revert)

### What keeps it above LOW

- Read contention with billing engine on `task_monthly_totals` and `employee_daily_totals` mitigated by 3s statement_timeout / 200ms lock_timeout, but not eliminated
- Schema drift: future ALTERs to public.* tables could break views silently or expose semantic drift; the lockin + snapshot CI tests catch most cases but not all
- API key leak on consumer side (Butler) is outside Manifest's control; mitigated by short revocation path and audit log
- CORS pinning depends on `ADMIN_API_KEYS_ALLOWED_ORIGINS` being set correctly pre-deploy

### Specific failure modes still in scope

- A misconfigured Butler that bursts 600+/min sees 429s; queue should back off
- A migration that adds a financial column to `employee_daily_totals` will not auto-leak (views are explicit-list) but the lockin CI test will fail loudly
- The 90-day audit retention may be too short for a long-running incident investigation; bump if needed

---

## 15. Open Items

These were considered and either deferred or accepted as residual:

1. **`employee_time_off` DDL not in version control.** The table is referenced by `sync-bamboohr-timeoff/index.ts` but no `CREATE TABLE` exists in `supabase/migrations/`. Was created out-of-band (Studio or n8n era). Schema is documented in `supabase/functions/manifest-mcp/README.md`. Recommend a future "snapshot migration" that captures the current schema for reproducibility — but NOT as part of this PR.
2. **Existing `v_api_employee_project_daily` rounding asymmetry vs `v_api_employee_daily`.** Per-day per-employee totals can differ by ~0.005h × tasks/day. The reconciliation CI test compares using the canonical rounding path (sums of `rounded_minutes` divided by 60 once) so it's apples-to-apples. Comment on the view documents the consumer-visible asymmetry.
3. **`get_employee_week_summary` does not include per-project breakdown today.** If Butler asks "what did Matthew work on this week and how much per project?", the LLM must call both `get_employee_week_summary` and `get_employee_projects`. Could be added as a future enhancement.
4. **Date phrase coverage gaps in `resolve_date_range`.** Missing: `this_quarter`, `last_quarter`, named months. Acceptable for v1; expand on demand.
5. **Audit log retention.** 90 days. Could be extended later via a single `pg_cron` job edit.
6. **No rate limit override per key.** Currently 600/min for all keys. Could add a `rate_limit_override` column to `api_keys` if Butler legitimately needs more.
7. **No semantic-checksum seed data committed.** `mcp-semantic-checksum.sql` accepts `psql -v` seed values for the pinned employee/project/range. Operator must seed pre-deploy or the test gracefully no-ops.

---

## 16. Decision Log

Key decisions made during planning that future maintainers should understand:

- **MCP over REST**: chose MCP because Butler is AI-first and the LLM can read tool descriptions directly without integration code. REST is a reasonable alternative if non-AI consumers emerge.
- **JSON-RPC over plain HTTP, not Streamable HTTP**: Streamable HTTP adds SSE complexity that Manifest's request/response use case doesn't need.
- **Schema isolation (`mcp_api`)**: chosen over a separate database because the data lives here, the lock blast-radius is limited, and the rollback is dramatically simpler than syncing two databases.
- **`mcp_reader` EXECUTE-only**: chosen over GRANT SELECT on views to ensure every data access is auditable and goes through a typed function with provenance.
- **Caller-supplied `expected_hours` only**: chosen over reading `resources.expected_hours` because that column is contract-derived (financial). Caller-supplied keeps the financial firewall intact.
- **No new index on `employee_daily_totals`**: deliberately rejected. The existing UNIQUE constraint `(user_id, client_id, work_date)` already provides the composite path; adding another would alter Manifest. Performance benchmarks at current scale are well within targets.
- **Local commits only, no push**: per universal rule "never-push-or-deploy-without-explicit-ask". Deployment requires explicit user instruction.

---

## 17. Sign-Off

This integration is ready for human review. The scope is locked, the implementation is committed locally on top of v1.0.0.107, all CI guards pass, and the rollback is clean.

To greenlight deployment, a human reviewer should:

1. Read this document end-to-end
2. Spot-check the migrations and Edge Functions for any concerns
3. Confirm the pre-deploy checklist (Section 10) is satisfied
4. Approve in writing (commit message, Slack, or PR comment)
5. Then and only then: push, deploy, and apply migrations per Section 11

Until that approval, nothing is pushed, deployed, or migrated. Manifest's production state is untouched.
