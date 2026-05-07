# manifest-mcp

JSON-RPC 2.0 over HTTP server that exposes the Manifest dataset as MCP tools.

## Architecture

```
┌──────────────┐  POST /functions/v1/manifest-mcp
│ MCP client   │─────────────────────────────────────►┐
│ (Claude etc) │  Authorization: Bearer mfst_live_…   │
└──────────────┘                                      │
                                                      ▼
                                       ┌──────────────────────────┐
                                       │  manifest-mcp (Deno)     │
                                       │   index.ts (router)      │
                                       │   auth.ts  (sha256, RL)  │
                                       │   tools.ts (registry)    │
                                       │   types.ts (contracts)   │
                                       └────────────┬─────────────┘
                                                    │  pg connection
                                                    │  AS mcp_reader
                                                    ▼
                                       ┌──────────────────────────┐
                                       │ mcp_api schema           │
                                       │   api_authenticate_key   │
                                       │   api_consume_rate_limit │
                                       │   api_log_request        │
                                       │   api_list_*             │
                                       │   api_resolve_*          │
                                       │   api_get_*              │
                                       │   api_verify_*           │
                                       │     │                    │
                                       │     ▼ SECURITY DEFINER   │
                                       │   v_api_* views          │
                                       │     │                    │
                                       │     ▼                    │
                                       │   public.* (read only)   │
                                       └──────────────────────────┘
```

The Edge Function never authenticates as `service_role`. It connects to
Postgres as `mcp_reader`, which has `EXECUTE` only on the curated
`mcp_api.api_*` functions and zero privileges on `public.*`.

## Environment

| Variable | Purpose |
|---|---|
| `MANIFEST_MCP_DB_URL` | Postgres connection string for the `mcp_reader` role. |

The Supabase service role key is **deliberately not used** by this function.

## Wire format

Every request is a JSON-RPC 2.0 envelope:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_employee_hours",
    "arguments": {
      "canonical_employee_id": "…",
      "start_date": "2026-04-29",
      "end_date": "2026-05-05",
      "granularity": "day"
    }
  }
}
```

Methods:

| Method | Result |
|---|---|
| `initialize` | Server info + capabilities. |
| `tools/list` | Array of `{name, description, inputSchema}`. |
| `tools/call` | The tool envelope (see below) returned by the matching `mcp_api.api_*` function. |

Tool envelope:

```ts
type ToolEnvelope =
  | { ok: true,  data: any, provenance: {
      source: string,
      computed_at: string,   // ISO
      row_count: number,
      truncated: boolean,
      canonical_employee_id?: string,
      period_start?: string,
      period_end?: string
    } }
  | { ok: false, error: { code: 'AMBIGUOUS' | 'NOT_FOUND' | 'INVALID_DATE'
                              | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'INTERNAL',
                          message: string,
                          candidates?: any } };
```

## Rate limits

| Window | Limit |
|---|---|
| 1 minute | 60 requests |
| 1 hour   | 1200 requests |

A `429` is returned with `Retry-After` (seconds) when either is exceeded.

## Audit

Every call writes one row into `mcp_api.api_audit_log`:

- `params` is **redacted** at write time. Any object key whose name matches
  the case-insensitive pattern `rate|cost|fee|amount|salary` is replaced with
  `"[redacted]"`.
- `response_payload_sha256` is the SHA-256 of the canonicalized response
  body. **The response body itself is never stored.**

Rows are pruned after 90 days by the `mcp_api_audit_cleanup` pg_cron job.

## Tools

| Name | Postgres function | Description |
|---|---|---|
| `list_employees` | `mcp_api.api_list_employees()` | Canonical employee directory. |
| `list_projects` | `mcp_api.api_list_projects()` | Canonical project directory. |
| `list_companies` | `mcp_api.api_list_companies()` | Canonical company directory. |
| `resolve_employee` | `mcp_api.api_resolve_employee(query)` | Free-text → canonical id. |
| `resolve_project` | `mcp_api.api_resolve_project(query, client_hint)` | Free-text → canonical project. |
| `resolve_date_range` | `mcp_api.api_resolve_date_range(phrase, ref?)` | NL phrase → date range. |
| `get_employee_hours` | `mcp_api.api_get_employee_hours(emp, start, end, granularity)` | Hours buckets. |
| `get_employee_week_summary` | `mcp_api.api_get_employee_week_summary(emp, week_start)` | Per-day weekly summary. |
| `get_employee_projects` | `mcp_api.api_get_employee_projects(emp, start, end)` | Companies + hours. |
| `get_employee_time_off` | `mcp_api.api_get_employee_time_off(emp, start, end)` | Approved time-off. |
| `verify_employee_week` | `mcp_api.api_verify_employee_week(emp, week_start, expected)` | Compare actual vs caller-supplied expected. |

## Schema dependency: `public.employee_time_off`

The DDL for `employee_time_off` lives **outside** version control (the table
was created via a one-off migration during the BambooHR integration). The
`mcp_api.v_api_employee_time_off` view depends on it, so we record the schema
here for future readers:

```sql
-- public.employee_time_off
--
-- One row per approved (or otherwise-statused) time-off request, ingested by
-- supabase/functions/sync-bamboohr-timeoff/index.ts.
--
-- id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
-- bamboo_request_id   TEXT     NOT NULL UNIQUE   -- BambooHR request id
-- bamboo_employee_id  TEXT     NOT NULL          -- BambooHR employee id
-- resource_id         UUID     NOT NULL REFERENCES resources(id) ON DELETE CASCADE
-- employee_name       TEXT     NOT NULL          -- denorm of resources.first/last name
-- employee_email      TEXT                       -- denorm of resources.email (optional)
-- time_off_type       TEXT     NOT NULL          -- e.g. "Vacation", "Sick"
-- status              TEXT     NOT NULL          -- 'approved' | 'denied' | 'cancelled' | …
-- start_date          DATE     NOT NULL
-- end_date            DATE     NOT NULL
-- total_days          NUMERIC  NOT NULL          -- can be fractional for half-days
-- notes               TEXT                       -- requester notes
-- synced_at           TIMESTAMPTZ NOT NULL       -- sync run time
```

The MCP view filters to `status = 'approved'` and surfaces only:
`canonical_employee_id, start_date, end_date, total_days, time_off_type, status`.
The `bamboo_*` ids, `employee_email`, and `notes` are excluded by Condition 10
of the locked architecture.

## Locked invariants enforced by CI

See `scripts/ci/mcp-grep-guards.sh` and the SQL snapshots in the same folder.
The CI guards fail the build if any of the following drift:

1. Any reference to `expected_hours`, `monthly_cost`, `hourly_rate`, or
   `billing_mode` appears in this folder.
2. Any reference to `manual_origin` outside the views.
3. Any `select *` in lowercase or otherwise.
4. Any change to `public.*` made by migrations 103-107.
5. Any reference to `SUPABASE_SERVICE_ROLE_KEY` or the literal `service_role`
   in this folder.
6. Any `CREATE FUNCTION mcp_api.api_*` not followed by both
   `SET search_path = mcp_api, pg_temp` and `SECURITY DEFINER`.
7. The columns of every `mcp_api.v_api_*` view (snapshot test).
8. Pinned-row checksums on `v_api_employees` and `v_api_companies` to catch
   semantic redefinitions.
