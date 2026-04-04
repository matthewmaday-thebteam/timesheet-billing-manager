# Task: Migrate Clockify Sync from n8n to Supabase Edge Functions

**Status:** Planned
**Priority:** High
**Estimated Complexity:** Easier than BambooHR migration (~2-3 hours)
**Date:** 2026-04-04

---

## Summary

Migrate the 7-node Clockify n8n pipeline to a single Supabase Edge Function (`sync-clockify-timesheets`), following the same pattern established for the BambooHR sync migration.

---

## Current Pipeline (n8n — 7 Nodes)

| Node | Purpose | Details |
|------|---------|---------|
| **1 - Date Range** | Compute sync window | 14 days before 1st of current month through end of month |
| **2 - Fetch** | Paginated API fetch | `POST /v1/workspaces/{id}/reports/detailed` (1000/page, max 50 pages) |
| **3 - Split** | Fan-out entries | n8n-specific: splits array into individual items |
| **4 - Normalize** | Transform entries | Extracts `task_id`, `project_id`, `user_id`, `work_date`, `duration_seconds`, etc. |
| **5 - Build Rows** | Prepare for upsert | Filters invalid entries, converts to `timesheet_daily_rollups` shape, `total_minutes = Math.ceil(seconds/60)` |
| **n8n Supabase** | Upsert | Native n8n node upserting to `timesheet_daily_rollups` on `(clockify_workspace_id, task_id)` |
| **6 - Cleanup** | Delete stale entries | Calls RPC `cleanup_stale_timesheet_entries` (only if fetch complete) |
| **7 - Recalculate** | Drain billing queue | Calls RPC `drain_recalculation_queue` (only if fetch complete) |

---

## Proposed Architecture

### Single Edge Function: `sync-clockify-timesheets`

All 7 nodes consolidated into one function. Unlike BambooHR (split into employees/time-off), Clockify is a single atomic pipeline — fetch, transform, upsert, cleanup, recalculate — that must run sequentially.

**Schedule:** Every 2 hours via pg_cron (`0 */2 * * *`)

### Steps in the Edge Function

1. Compute date range (14-day lookback default, or manual override via POST body)
2. Paginated fetch from Clockify Reports API (1000/page, 50-page safety limit)
3. Normalize + build upsert rows in a single pass (no fan-out needed)
4. Batch upsert to `timesheet_daily_rollups` (500-row batches, on conflict `clockify_workspace_id, task_id`)
5. Conditional cleanup via RPC `cleanup_stale_timesheet_entries` (only if fetch complete)
6. Drain recalculation queue via RPC `drain_recalculation_queue` (only if fetch complete)
7. Basic reconciliation alerts to `sync_alerts` table
8. Return summary JSON

### Auth Pattern

Same as BambooHR functions: decode JWT payload, check `role === 'service_role'`. Handles both JWT and `sb_secret_` env var formats.

---

## Table: `timesheet_daily_rollups`

| Column | Type | Source |
|--------|------|--------|
| `clockify_workspace_id` | TEXT | Constant from secrets |
| `task_id` | TEXT | Clockify `_id` |
| `work_date` | DATE | Derived from `timeInterval.start` UTC |
| `project_id` | TEXT | Clockify `projectId` |
| `project_name` | TEXT | Clockify `projectName` |
| `user_id` | TEXT | Clockify `userId` |
| `user_name` | TEXT | Clockify `userName` |
| `task_name` | TEXT | Clockify `description` |
| `client_id` | TEXT | Clockify `clientId` |
| `client_name` | TEXT | Clockify `clientName` |
| `total_minutes` | INTEGER | `Math.ceil(duration_seconds / 60)` |
| `synced_at` | TIMESTAMPTZ | Current timestamp |
| `sync_run_id` | UUID | Generated per run |
| `sync_run_at` | TIMESTAMPTZ | Current timestamp |

**Upsert key:** `(clockify_workspace_id, task_id)` — partial unique index where `task_id IS NOT NULL`

**RPC functions called post-sync:**
- `cleanup_stale_timesheet_entries(p_workspace_id, p_range_start, p_range_end, p_sync_run_id)`
- `drain_recalculation_queue(p_max_depth)`

---

## Secrets to Configure

```bash
supabase secrets set CLOCKIFY_API_KEY=NGE4ODkxZTAtYzQ1Ni00ZGQ2LWI2NGMtZDQ4M2Y2YjQzYzI0
supabase secrets set CLOCKIFY_WORKSPACE_ID=683ee2051325f11af65497bd
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are auto-injected.

---

## Reconciliation Alerts

Add to existing `sync_alerts` table (same pattern as BambooHR):

| Alert Type | Severity | Condition |
|------------|----------|-----------|
| `clockify_sync_incomplete` | error | API fetch failed or hit 50-page safety limit |
| `clockify_zero_entries` | warning | Sync returned 0 entries for expected date range |
| `clockify_high_deletion_count` | warning | Cleanup deleted > 50 entries in one run |

Non-blocking (wrapped in try/catch). Auto-resolve on next successful sync.

---

## Optimization Opportunities

| Optimization | Description |
|---|---|
| Eliminate n8n overhead | 7 separate nodes + fan-out/fan-in + static data passing all gone |
| Single-pass transform | No split/normalize — map directly from API response to DB rows |
| Batch upsert | Supabase client upsert in 500-row chunks vs n8n's row-by-row |
| No static data hack | Variables are just in scope — no `$getWorkflowStaticData` |
| Secrets management | Hardcoded keys moved to `Deno.env.get()` |
| Manual trigger support | Optional POST body `{ rangeStartDate, rangeEndDate }` for backfills |

---

## Implementation Steps

1. Set Clockify secrets in Supabase
2. Create `supabase/functions/sync-clockify-timesheets/index.ts`
3. Deploy and test manually with curl
4. Create pg_cron migration (`079_clockify_sync_cron.sql`)
5. Run in parallel with n8n for 1-2 weeks
6. Validate data parity
7. Disable n8n Clockify workflow

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Data loss during cutover | High | Run both in parallel — same upsert key, idempotent |
| Clockify API rate limiting | Low | 10 req/sec limit, typically 1-5 pages |
| Edge Function timeout | Medium | 150s limit on Pro plan; typical run well under that |
| Breaking changes to frontend | None | Same table, same columns, same upsert keys |
| Recalculation timing | Low | Same sequential flow — drain queue after upsert+cleanup |

---

## Open Questions

1. **Current n8n schedule?** What cadence does the Clockify sync run on today? (determines pg_cron schedule)
2. **ClickUp sync too?** The ClickUp scripts follow the identical 7-node pattern — migrate together?
3. **n8n still needed?** If all 3 syncs (BambooHR, Clockify, ClickUp) are migrated, can n8n be decommissioned?
4. **Rotate Clockify API key?** Key is hardcoded in committed n8n scripts — should be rotated after migration
5. **14-day lookback sufficient?** Any cases of employees entering time later than 14 days?
6. **Manual trigger UI?** Add a "Sync Now" button in Manifest for on-demand syncs?

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/sync-clockify-timesheets/index.ts` | Edge Function |
| `supabase/migrations/079_clockify_sync_cron.sql` | pg_cron schedule |

## Files NOT Modified

- No table migrations (tables already exist)
- No frontend changes (reads from same table)
- No changes to existing Edge Functions
