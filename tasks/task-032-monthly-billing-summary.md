# Task 032: Monthly Billing Summary Table (Database-Only)

**Status:** COMPLETE (Phases 1-3 deployed. Phase 4-5 → Task 033)
**Stack:** Supabase/Postgres
**Scope:** Database schema, SQL functions, migration. No frontend code changes.

---

## Overview

Created a `project_monthly_summary` table that stores pre-calculated billing results at the project-month level. The database becomes the single source of truth for billing calculations.

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/044_create_monthly_billing_summary.sql` | Tables, functions, views, indexes, RLS (Phase 1) |
| `supabase/migrations/045_enable_summary_triggers.sql` | Triggers for auto-enqueue on data changes (Phase 3) |
| `supabase/rollbacks/044_045_rollback.sql` | Safe rollback script for both migrations |
| `tasks/task-032-monthly-billing-summary.md` | This document |

## Architecture

### Tier 1: Stored Table
- **`project_monthly_summary`** - One row per canonical project per month, stores full billing result + config snapshot + metadata

### Tier 2: Views (not stored)
- **`v_monthly_summary_by_company`** - Aggregate by company + month
- **`v_monthly_summary_totals`** - Aggregate by month with utilization + invoiced revenue
- **`v_carryover_chain`** - Audit trail for carryover flow

### Trigger Mechanism
- **`recalculation_queue`** table (decouples "what" from "when")
- STATEMENT-level trigger on `timesheet_daily_rollups` enqueues affected months
- Config change triggers on rates/rounding/limits/active_status
- `drain_recalculation_queue()` processes in chronological order
- Called by n8n after sync (primary) + optional manual runs

## Key Functions

| Function | Purpose |
|----------|---------|
| `recalculate_project_month(UUID, DATE)` | Core: recalculate one project for one month |
| `recalculate_month(DATE)` | Batch: recalculate all canonical projects for a month |
| `drain_recalculation_queue(INTEGER)` | Process pending queue items (n8n integration point) |
| `backfill_summaries(DATE, DATE)` | Historical backfill across a date range |
| `billing_round_hours(NUMERIC)` | Match TypeScript roundHours() |
| `billing_round_currency(NUMERIC)` | Match TypeScript roundCurrency() |
| `billing_apply_rounding(INTEGER, INTEGER)` | Match TypeScript applyRounding() |

## Migration Plan (5 Phases)

### Phase 1: Schema Deployment (Migration 044) - COMPLETE
Deployed tables, functions, views, indexes, RLS.

### Phase 2: Historical Backfill + Validation - COMPLETE
- Data quality checks passed (0 orphaned rollups, 0 NULL company_ids, 0 NULL first_seen_months)
- Backfilled 2026-01 and 2026-02 (60 project-month summaries, 30 projects x 2 months)
- Validation diff = 0 for both months (actual_minutes match perfectly)
- Idempotency confirmed (re-run produced identical results)

### Phase 3: Enable Auto-Update (Migration 045) - COMPLETE
Deployed all 5 triggers. n8n drain call documented but not yet added to workflow.

### Phase 4: Frontend Migration - Task 033
See `tasks/task-033-frontend-billing-migration.md`

### Phase 5: Cleanup - Task 033
See `tasks/task-033-frontend-billing-migration.md`

## Pre-Migration Data Quality Checks

Run these BEFORE backfill:

```sql
-- 1. Orphaned rollup entries (no matching project)
SELECT DISTINCT tdr.project_id, tdr.project_name
FROM timesheet_daily_rollups tdr
LEFT JOIN projects p ON p.project_id = tdr.project_id
WHERE p.id IS NULL AND tdr.total_minutes > 0;

-- 2. Projects with NULL company_id
SELECT id, project_id, project_name FROM projects WHERE company_id IS NULL;

-- 3. Projects with NULL first_seen_month
SELECT id, project_id, project_name FROM projects WHERE first_seen_month IS NULL;

-- 4. Earliest month with data
SELECT DATE_TRUNC('month', MIN(work_date))::DATE AS earliest_month
FROM timesheet_daily_rollups WHERE total_minutes > 0;
```

## Validation Query (Compare Summary vs. Raw Data)

After backfill, run for each month:

```sql
WITH raw AS (
    SELECT
        DATE_TRUNC('month', tdr.work_date)::DATE AS month,
        SUM(tdr.total_minutes) AS raw_minutes
    FROM timesheet_daily_rollups tdr
    WHERE tdr.total_minutes > 0
    GROUP BY DATE_TRUNC('month', tdr.work_date)::DATE
),
summary AS (
    SELECT
        summary_month AS month,
        SUM(actual_minutes) AS summary_minutes
    FROM project_monthly_summary
    GROUP BY summary_month
)
SELECT
    COALESCE(r.month, s.month) AS month,
    r.raw_minutes,
    s.summary_minutes,
    COALESCE(r.raw_minutes, 0) - COALESCE(s.summary_minutes, 0) AS diff
FROM raw r
FULL OUTER JOIN summary s ON s.month = r.month
ORDER BY month;
```

Expected: `diff = 0` for all months.

## n8n Integration (Phase 3)

After enabling triggers (migration 045), add to n8n workflow:

```
Node 7 (Code node): Call drain_recalculation_queue()
  - Supabase RPC: SELECT drain_recalculation_queue();
  - Only runs if fetch_complete === true (same gate as cleanup)
```

## Hard Rules (Calculation Safety)

1. Money stored as BIGINT cents. Never float for money storage.
2. Hours stored as NUMERIC(10,2). Matches roundHours() precision.
3. ID-only lookups. All joins by UUID or external ID, never by name.
4. Config snapshot on every calculation for auditability.
5. Idempotent recalculation (UPSERT, not INSERT).
6. Carryover cascade: changed carryover_out queues next month.
7. Canonical project grouping: members aggregated under primary.

## Rollback

Safe at every phase. Run:
```sql
-- From supabase/rollbacks/044_045_rollback.sql
-- Or manually:
-- Drops triggers, views, functions, tables in correct order
-- Zero impact on existing application
```
