# Task 037: Fix Member Project Double-Counting in Billing Summary

## Status: READY FOR MIGRATION

## Problem
Member projects (e.g., "Food Cycler Science" under "FCS0001 Customer and Employee Dashboard") were getting their own standalone rows in `project_monthly_summary`, causing:
1. **Double-counted revenue** — member hours counted in both the member's row AND the primary's aggregated row
2. **Wrong rate applied** — member row used the member's rate ($45) instead of the primary's rate ($60)
3. FoodCycle Science Feb showed `project_count: 3` and $20,572.50 instead of expected $16,372.50

## Root Cause
The sync trigger `enqueue_affected_months()` enqueued the raw `projects.id` from timesheet entries without resolving member projects to their primary. When `recalculate_project_month(member_id)` ran, the canonical group lookup found nothing (member isn't a primary), creating a standalone summary row.

## Fix: Migration 050

### `supabase/migrations/050_fix_member_project_double_count.sql`
1. **Fix trigger** — `enqueue_affected_months()` now LEFT JOINs `project_group_members` → `project_groups` to resolve `COALESCE(pg.primary_project_id, p.id)` before enqueuing
2. **Fix views** — `v_combined_revenue_by_company_month`, `v_monthly_summary_by_company`, `v_monthly_summary_totals` all exclude member project rows via `LEFT JOIN pgm WHERE pgm.member_project_id IS NULL`
3. **New view** — `v_canonical_project_monthly_summary` for frontend use (excludes member rows)
4. **Cleanup** — DELETE stale member rows from `project_monthly_summary`
5. **Re-backfill** — `backfill_summaries('2026-01-01', CURRENT_DATE)` to regenerate correct data

### `src/hooks/useSummaryBilling.ts`
- Changed query from `project_monthly_summary` to `v_canonical_project_monthly_summary`

## To Apply
Run migration 050 in Supabase SQL Editor, then deploy frontend:
```bash
npx vercel --prod
```

## Verification
- [ ] Migration 050 applied in Supabase
- [ ] FoodCycle Science Feb: project_count = 1-2 (canonical only), revenue matches expected
- [ ] February total revenue correct
- [ ] Chart cumulative values correct
- [ ] Revenue page matches chart values
- [ ] No member project rows in project_monthly_summary
