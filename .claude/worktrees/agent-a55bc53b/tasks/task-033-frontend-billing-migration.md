# Task 033: Frontend Billing Migration (Summary Table Cutover)

**Status:** Step 2B COMPLETE, gaps resolved (migration 049) - Step 3 next
**Depends on:** Task 032 (Phases 1-3 complete)
**Stack:** Supabase/Postgres + React/TypeScript
**Scope:** Safely transition frontend from calculating billing in-browser to reading from `project_monthly_summary`.

---

## Problem Statement

The frontend currently calculates all billing in the browser via `useUnifiedBilling` → `billingCalculations.ts`. Task 032 deployed a `project_monthly_summary` table that replicates these calculations in PostgreSQL. Before switching the frontend to read from the summary table, we must **prove** the SQL engine produces identical results to the TypeScript engine for every project-month.

The challenge: the frontend code is correct and trusted. Any migration must not alter visible results.

---

## Strategy (4 Steps + 2B)

### Step 1: Per-Project Comparison Query (COMPLETE)
Create a SQL query/function that recomputes billing from raw data (mimicking the TypeScript pipeline) and compares field-by-field against `project_monthly_summary`. This exposes any discrepancies at the individual project level.

### Step 2: Shadow-Read Hook (`useSummaryBilling`) (COMPLETE)
Create a React hook that reads from `project_monthly_summary` and formats results in the same shape as `MonthlyBillingResult`. Run it alongside `useUnifiedBilling` in a diagnostics page, showing a side-by-side diff.

### Step 2B: Fixed Billings Integration (COMPLETE)
Extend the summary table system to include fixed billings (service fees, subscriptions, licenses, reimbursements, unlinked milestones) and milestone overrides, enabling a combined revenue comparison that matches the Dashboard's `combinedTotalRevenue` formula.

### Step 3: Feature-Flagged Cutover
Add a feature flag (Supabase `app_settings` or localStorage) that switches components from `useUnifiedBilling` to `useSummaryBilling`. Parallel-run for N weeks with automated diff logging.

### Step 4: Cleanup
Remove `useUnifiedBilling`, `billingCalculations.ts` calculation functions, and `useCarryoverSync`. The summary table becomes the sole source of truth.

---

## Step 1: Comparison Query — Detailed Specification

### What It Must Compare

For each canonical project + month, compare these fields between the summary table and a fresh recomputation from raw data:

| Field | Summary Column | Recomputed From |
|-------|---------------|-----------------|
| Actual minutes | `actual_minutes` | `SUM(total_minutes)` from rollups |
| Rounded minutes | `rounded_minutes` | Per-task `CEIL(minutes/increment)*increment`, then SUM |
| Actual hours | `actual_hours` | `actual_minutes / 60` |
| Rounded hours | `rounded_hours` | `rounded_minutes / 60` |
| Carryover in | `carryover_in_hours` | From `project_carryover_hours` |
| Adjusted hours | `adjusted_hours` | `rounded_hours + carryover_in` |
| Billed hours | `billed_hours` | After MIN/MAX applied |
| Unbillable hours | `unbillable_hours` | Excess when MAX applied, no carryover |
| Carryover out | `carryover_out_hours` | Excess when MAX applied, carryover enabled |
| Minimum padding | `minimum_padding_hours` | `minimum - adjusted` when MIN applied |
| Min applied flag | `minimum_applied` | Boolean |
| Max applied flag | `maximum_applied` | Boolean |
| Rate used | `rate_used` | From `get_effective_project_rate()` |
| Rounding used | `rounding_used` | From `get_effective_project_rounding()` |
| Base revenue (cents) | `base_revenue_cents` | `ROUND(rounded_hours * rate * 100)` |
| Billed revenue (cents) | `billed_revenue_cents` | `ROUND(billed_hours * rate * 100)` |

### Acceptance Criteria for Step 1

- [x] Comparison query created as a SQL function (`compare_summary_vs_recomputed(DATE)`)
- [x] Task grouping discrepancy investigated (task_name vs task_id mapping)
- [x] Task grouping aligned: SQL updated to GROUP BY task_name (migration 046)
- [x] Comparison query returns 0 discrepancy rows for all months with data
- [x] Idempotency confirmed (re-backfill + re-compare = 0 discrepancies)
- [x] Results documented below

### Step 1 Results (2026-02-10)

**Investigation findings:**
- `task_id → task_name` is many-to-one (each task_id has exactly one name)
- `task_name → task_id` is one-to-many ("PM" maps to 139 task_ids across 2 projects)
- Grouping by task_id inflated rounded_minutes (e.g., 3,000 extra minutes for "Projects" in Jan)
- 14 projects affected in Jan 2026, 12 in Feb 2026

**Fix applied:**
- Migration 046 deployed: `recalculate_project_month()` v1.1 groups by `COALESCE(task_name, 'No Task')`
- Backfill re-run: 60 project-month summaries updated
- `compare_summary_vs_recomputed()` function deployed for ongoing validation

**Final validation:**
- 60 total rows, 0 discrepancies (all fields match: minutes, hours, revenue, flags, config)
- Raw minute validation: diff = 0 for both months (137,679 Jan, 44,330 Feb)
- Idempotency: re-backfill produced identical results

### Files Created (Step 1)

| File | Description |
|------|-------------|
| `supabase/migrations/046_fix_task_grouping_and_comparison.sql` | Fix task grouping + comparison function |

---

## Step 2: Shadow-Read Hook — Specification

### Acceptance Criteria for Step 2

- [x] `useSummaryBilling` hook returns data in `MonthlyBillingResult` shape
- [x] Diagnostics page shows side-by-side comparison
- [x] Fields match for projects with entries (22/30 projects match exactly in Feb 2026)
- [ ] All fields match — blocked by known gaps (see below)

### Files Created/Modified (Step 2)

| File | Description |
|------|-------------|
| `src/hooks/useSummaryBilling.ts` | Shadow-read hook querying project_monthly_summary |
| `src/hooks/useUnifiedBilling.ts` | Added minimum-hours injection for zero-entry projects |
| `src/components/pages/DiagnosticsPage.tsx` | Added SummaryComparisonPanel with monthly totals + per-project comparison |

### Step 2 Implementation Notes (2026-02-10)

- Hook queries `project_monthly_summary` with joins to `projects` and `companies`
- Groups by `companies.client_id` (external ID, matching useUnifiedBilling grouping)
- Revenue converted from cents (BIGINT in DB) to dollars
- Comparison panel uses `useUnifiedBilling` directly (same engine as Dashboard/RevenuePage)
- Discrepancy count filters out 0-hour/0-revenue DB-only entries (noise)
- TypeScript compiles cleanly (zero errors)

### Known Gaps Between Frontend and Summary Table

| Gap | Status | Resolution |
|-----|--------|------------|
| Canonical project grouping (member → primary) | **RESOLVED** (migration 044) | SQL builds canonical project group via `project_groups`/`project_group_members` |
| Canonical company mapping (cross-system) | **RESOLVED** (migration 049) | `recalculate_project_month()` v1.2 resolves via `v_company_canonical` |
| Minimum-hours injection (0-entry SLA projects) | **RESOLVED** (both systems) | SQL iterates all canonical projects; FE updated to match |
| Carryover chain (useCarryoverSync write-back) | **RESOLVED** (verified matching) | SQL reads/writes `project_carryover_hours` with cascade. Data verified: Crossroads SLA 27.25h, FoodCycler Hypercare 135.75h |
| Cross-system employee deduplication | **DEFERRED** (display-only) | Only affects `resource_count`, not revenue/hours/billing. No impact on Step 3 cutover |

All revenue-affecting gaps are resolved. Step 3 cutover can proceed.

---

## Step 2B: Fixed Billings Integration — Specification

### Problem

The Diagnostics comparison panel only compared timesheet billing (`useUnifiedBilling` vs `useSummaryBilling`). The ~$13K gap between the panel ($114K) and Dashboard ($127K) for January was entirely from fixed billings and milestone replacements that weren't captured in the summary table system.

### Solution

Extended the summary table system with:

1. **New table: `monthly_fixed_billing_summary`** — Company-month level aggregation of non-milestone billing_transactions (service fees, subscriptions, licenses, reimbursements, unlinked milestones)

2. **New column: `project_monthly_summary.milestone_override_cents`** — When set, milestone amount replaces timesheet revenue for that project. NULL = no override.

3. **New function: `recalculate_fixed_billing_month(DATE)`** — Populates both milestone overrides and fixed billing summaries. Called automatically via trigger on `billing_transactions`.

4. **New view: `v_combined_revenue_by_company_month`** — Combines timesheet (with milestone overrides) + fixed billings per company-month.

### Combined Revenue Formula (SQL matches Dashboard)

```sql
-- Per project: use milestone override if it exists, otherwise timesheet revenue
COALESCE(pms.milestone_override_cents, pms.billed_revenue_cents) AS effective_revenue_cents

-- Per company-month combined:
SUM(COALESCE(pms.milestone_override_cents, pms.billed_revenue_cents))
  + COALESCE(fbs.fixed_billing_cents, 0) AS combined_revenue_cents
```

This mirrors the Dashboard formula:
- `totalRevenue` → `SUM(billed_revenue_cents)` for non-milestone projects
- `milestoneAdjustment` → milestone overrides replace billed_revenue_cents
- `filteredBillingCents` → `fixed_billing_cents` (excludes linked milestones)

### Acceptance Criteria for Step 2B

- [x] Migration 047 written with table, column, function, view, triggers, RLS
- [x] `useSummaryBilling` updated to fetch and expose combined revenue fields
- [x] DiagnosticsPage updated with CombinedRevenuePanel showing breakdown
- [x] Rollback scripts updated (047-only and combined 044-047)
- [ ] Migration deployed to Supabase
- [ ] Backfill validated against Dashboard numbers
- [ ] TypeScript compiles cleanly

### Files Created/Modified (Step 2B)

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/047_fixed_billing_summary.sql` | CREATE | New table, column, function, view, trigger, backfill |
| `supabase/rollbacks/047_rollback.sql` | CREATE | Standalone rollback for 047 objects |
| `supabase/rollbacks/044_045_046_047_rollback.sql` | CREATE | Combined rollback for all billing migrations |
| `src/hooks/useSummaryBilling.ts` | MODIFY | Added combined revenue, fixed billing, milestone override fields |
| `src/components/pages/DiagnosticsPage.tsx` | MODIFY | Added CombinedRevenuePanel with revenue breakdown |
| `tasks/task-033-frontend-billing-migration.md` | MODIFY | Documented Step 2B |

### Step 2B Implementation Notes (2026-02-10)

**SQL Changes:**
- `monthly_fixed_billing_summary` table stores company-month fixed billing totals
- `milestone_override_cents` on `project_monthly_summary` enables per-project milestone replacement
- `recalculate_fixed_billing_month()` is idempotent and handles: milestone overrides, milestone clearing, fixed billing upsert, and cleanup
- Trigger on `billing_transactions` auto-recalculates on INSERT/UPDATE/DELETE
- Backfill runs for all months with data

**Frontend Changes:**
- `useSummaryBilling` now fetches `monthly_fixed_billing_summary` in parallel with `project_monthly_summary`
- Returns new fields: `combinedRevenue`, `fixedBillingRevenue`, `effectiveRevenue`, `milestoneOverrides`
- `CombinedRevenuePanel` shows full breakdown: timesheet → milestone adjustment → effective → fixed → combined
- Milestone override details table shows per-project timesheet vs milestone amounts

### Deployment Steps

1. Deploy migration 047 via Supabase SQL Editor
2. Verify backfill completed (check NOTICE output for month count)
3. Validate: `SELECT * FROM v_combined_revenue_by_company_month WHERE summary_month = '2026-01-01'`
4. Compare combined_revenue_cents against Dashboard's January total ($127,548.24)
5. Deploy frontend
6. Verify DiagnosticsPage shows CombinedRevenuePanel with data

---

## Step 3: Feature-Flagged Cutover — Specification

### Feature Flag

Add to `app_settings` table (or localStorage for dev):
```
billing_source: 'frontend' | 'summary_table'
```

### Components That Read Billing Data

These components use `useUnifiedBilling` and would need to switch:

| Component | File | Usage |
|-----------|------|-------|
| Dashboard | `src/components/Dashboard.tsx` | Total revenue, hours |
| DashboardChartsRow | `src/components/DashboardChartsRow.tsx` | Revenue chart data |
| RevenuePage | `src/components/pages/RevenuePage.tsx` | Revenue table |
| RevenueTable | `src/components/atoms/RevenueTable.tsx` | Per-project breakdown |
| EmployeesPage | `src/components/pages/EmployeesPage.tsx` | Employee billing |
| EmployeePerformance | `src/components/EmployeePerformance.tsx` | Performance metrics |
| DiagnosticsPage | `src/components/pages/DiagnosticsPage.tsx` | Billing validation |
| FormulasPage | `src/components/pages/FormulasPage.tsx` | Formula display |
| InvestorDashboardPage | `src/components/pages/InvestorDashboardPage.tsx` | Investor view |
| useCombinedRevenueByMonth | `src/hooks/useCombinedRevenueByMonth.ts` | Multi-month chart |
| useCarryoverSync | `src/hooks/useCarryoverSync.ts` | Carryover write-back |
| generateRevenueCSV | `src/utils/generateRevenueCSV.ts` | CSV export |
| validateBilling | `src/utils/diagnostics/validateBilling.ts` | Diagnostic checks |

### Acceptance Criteria for Step 3

- [ ] Feature flag controls billing source
- [ ] All components work with both sources
- [ ] Parallel-run for 2+ weeks with zero discrepancies
- [ ] Manual verification of edge cases (MIN/MAX/carryover projects)

---

## Step 4: Cleanup — Specification

After cutover is validated:

### Files to Remove/Simplify

| Action | File | Reason |
|--------|------|--------|
| Remove | `src/hooks/useCarryoverSync.ts` | Summary table handles carryover |
| Simplify | `src/utils/billingCalculations.ts` | Keep types, remove calculation functions |
| Simplify | `src/utils/billing.ts` | Keep formatting utils, remove calculation functions |
| Remove | Feature flag code | No longer needed |

### Acceptance Criteria for Step 4

- [ ] Frontend reads exclusively from `project_monthly_summary`
- [ ] No in-browser billing calculations remain
- [ ] All tests pass
- [ ] TypeScript compiles cleanly
- [ ] No user-visible changes in any dashboard/page

---

## Key Files Reference

### Database (Task 032)
- `supabase/migrations/044_create_monthly_billing_summary.sql` — Tables, functions, views
- `supabase/migrations/045_enable_summary_triggers.sql` — Auto-enqueue triggers
- `supabase/migrations/046_fix_task_grouping_and_comparison.sql` — Fix task grouping + comparison function
- `supabase/migrations/047_fixed_billing_summary.sql` — Fixed billing summary + milestone overrides
- `supabase/migrations/048_billing_verification_snapshots.sql` — Golden snapshot verification system
- `supabase/migrations/049_canonical_company_mapping.sql` — Canonical company resolution in recalculate_project_month() v1.2

### Rollbacks
- `supabase/rollbacks/047_rollback.sql` — Rollback 047 only
- `supabase/rollbacks/044_045_046_047_rollback.sql` — Rollback all billing migrations

### Frontend (Current Billing Engine)
- `src/utils/billingCalculations.ts` — Core calculation pipeline (Task → Project → Company → Monthly)
- `src/utils/billing.ts` — Precision utilities, rounding, MIN/MAX logic
- `src/hooks/useUnifiedBilling.ts` — Main billing hook (canonical grouping, config lookup)
- `src/hooks/useCarryoverSync.ts` — Writes carryover back to DB

### Frontend (Summary Table / Migration)
- `src/hooks/useSummaryBilling.ts` — Shadow-read hook (timesheet + combined revenue)
- `src/components/pages/DiagnosticsPage.tsx` — Billing validation + comparison panels

### Frontend (Consumers of Billing Data)
- `src/components/Dashboard.tsx`
- `src/components/DashboardChartsRow.tsx`
- `src/components/pages/RevenuePage.tsx`
- `src/components/atoms/RevenueTable.tsx`
- `src/components/pages/EmployeesPage.tsx`
- `src/components/EmployeePerformance.tsx`
- `src/components/pages/FormulasPage.tsx`
- `src/components/pages/InvestorDashboardPage.tsx`
- `src/hooks/useCombinedRevenueByMonth.ts`
- `src/utils/generateRevenueCSV.ts`
- `src/utils/diagnostics/validateBilling.ts`

---

## Hard Rules

1. **Zero user-visible changes** until Step 4 cleanup. Every step is additive/parallel.
2. **Frontend is the source of truth** until proven equivalent. If SQL disagrees, fix SQL.
3. **ID-only lookups.** No name-based matching in any new code.
4. **Money as cents.** All revenue comparisons in BIGINT cents to avoid float issues.
5. **Idempotent and reversible.** Every step can be rolled back without data loss.

---

## Pending: n8n Integration

Task 032 Phase 3 deployed the triggers but the n8n `drain_recalculation_queue()` call has not been added yet. This should be done before Step 3 cutover so the summary table stays current after every sync.

```
n8n Node 7 (after cleanup): Supabase RPC → drain_recalculation_queue()
Only runs if fetch_complete === true
```
