# Task 031: Employee Page Missing Hours + Revenue Trend Chart Fix

**Status:** COMPLETE
**Created:** 2026-02-09
**Completed:** 2026-02-09

---

## Problem Statement

Two data display bugs discovered during review:

### Bug 1: Employee Page — Non-Revenue Projects Missing

The Employees page only shows projects that have billing rate configurations. Resources who log hours against non-revenue-generating projects (e.g., internal, admin, R&D) have those hours completely hidden from the employee view.

**Expected:** ALL hours for every resource should appear, regardless of whether the project has a billing rate.

**Actual:** Only projects present in `projectsWithRates` (from `useMonthlyRates`) are displayed. All other hours are silently dropped.

### Bug 2: 12-Month Revenue Trend Chart — Understated Revenue

The 12-Month Revenue Trend chart on the Dashboard and Investor Dashboard shows ~$76,000 for January 2026 when the actual revenue is $127,548.24. February MTD should show $38,515.50.

**Expected:** Chart bars/lines should reflect combined revenue (timesheet-based + fixed billings/milestones).

**Actual:** The chart uses timesheet-only revenue from `aggregateEntriesByMonth()` which computes `(total_minutes / 60) * rate`. The ~$51K in milestone/fixed billing revenue is missing from the chart. A correction mechanism exists in `DashboardChartsRow` but only patches the currently selected month — all other months remain understated.

---

## Root Cause Analysis

### Bug 1: Filtering Chain

```
useTimesheetData() → fetches ALL entries (correct)
       ↓
useMonthlyRates() → RPC get_all_project_rates_for_month() → only canonical projects with rate config
       ↓
useUnifiedBilling.ts (line ~205-210):
  entries.filter(entry => billingConfigByProjectId.has(canonicalId))
  → DROPS all entries whose project_id is not in projectsWithRates
       ↓
EmployeePerformance.tsx → only renders what survived the filter
```

**Key file:** `src/hooks/useUnifiedBilling.ts` — the `matchedEntries` filter (~line 205-210) enforces that every entry must have a corresponding billing config. Entries without one are classified as `unmatchedProjects` (data integrity errors) instead of being displayed with $0 revenue.

### Bug 2: Chart Data Pipeline

```
chartTransforms.ts: aggregateEntriesByMonth()
  → computes monthly revenue as SUM(total_minutes/60 * rate) — timesheet only
       ↓
Dashboard.tsx: combinedTotalRevenue
  → correctly adds totalRevenue + fixedBillingCents + milestoneAdjustment = $127,548.24
       ↓
DashboardChartsRow.tsx: correctedMonthlyAggregates
  → replaces ONLY the selected month's revenue with combinedTotalRevenue
  → all other 11 months remain at timesheet-only values
       ↓
Chart displays understated revenue for non-selected months
```

**Key files:**
- `src/utils/chartTransforms.ts` — `aggregateEntriesByMonth()` only computes timesheet revenue
- `src/components/DashboardChartsRow.tsx` — correction only patches selected month
- Same pattern in `src/components/pages/InvestorDashboardPage.tsx`

---

## Fix Plan

### Fix 1: Employee Page — Include All Hours

**Approach:** Modify `useUnifiedBilling.ts` to include entries for projects not in `projectsWithRates`, assigning them a default billing config with rate=$0, so their hours appear but revenue shows as $0.

**Files to modify:**

| File | Change |
|------|--------|
| `src/hooks/useUnifiedBilling.ts` | Stop filtering out entries for unknown projects. Instead, create a fallback billing config (rate=0, rounding=default) for any project not in `projectsWithRates`. |

**Logic change (useUnifiedBilling.ts):**
- Current: `matchedEntries = entries.filter(e => billingConfigByProjectId.has(canonicalId))`
- New: Process ALL entries. For entries whose project is not in `billingConfigByProjectId`, use a default config: `{ rate: 0, rounding: 1, minimumHours: null, maximumHours: null, carryoverEnabled: false, isActive: false, carryoverHoursIn: 0 }`
- Remove or reduce the `unmatchedProjects` error reporting for this case (these are expected, not errors)

### Fix 2: Revenue Trend Chart — Include Fixed Billings for All Months

**Approach:** Compute combined revenue (timesheet + billing transactions) for each month in the 12-month range, not just the selected month.

**Files to modify:**

| File | Change |
|------|--------|
| `src/components/pages/Dashboard.tsx` | Fetch billing transactions for the full 12-month range and pass monthly billing totals to DashboardChartsRow |
| `src/components/DashboardChartsRow.tsx` | Apply billing revenue corrections to ALL months, not just the selected month |
| `src/components/pages/InvestorDashboardPage.tsx` | Same pattern as Dashboard — apply billing corrections to all months |
| `src/utils/chartTransforms.ts` | (Optional) Accept a billing-by-month map in `aggregateEntriesByMonth()` or add a merge utility |

**Logic change:**
- Fetch `billing_transactions` for the full 12-month window (grouped by `transaction_month`)
- Build a `Map<string, number>` of month → total billing cents
- In `correctedMonthlyAggregates`, merge billing revenue into EVERY month (not just selected)
- Ensure the combined revenue is used for YoY, MoM, CAGR calculations

---

## Acceptance Criteria

### Bug 1
- [ ] All timesheet hours appear under each employee, including non-billable projects
- [ ] Non-billable projects show hours correctly with $0 revenue
- [ ] Existing billable project calculations remain unchanged
- [ ] No new TypeScript errors

### Bug 2
- [ ] All 12 months in the Revenue Trend chart reflect combined revenue (timesheet + billings)
- [ ] January 2026 shows ~$127,548.24 (not ~$76K)
- [ ] February 2026 MTD shows ~$38,515.50
- [ ] YoY growth calculation uses correct combined revenue
- [ ] Dashboard and Investor Dashboard charts are both fixed
- [ ] No new TypeScript errors

---

## Technical Notes

- No database changes required — both fixes are frontend-only
- Must not alter the billing calculation pipeline for billable projects
- Employee page fix preserves the `unmatchedProjects` reporting for informational tracking

---

## Implementation Notes (2026-02-09)

### Bug 1 Fix: `src/hooks/useUnifiedBilling.ts`

**Change:** Removed the `entries.filter()` that dropped non-rate projects. Now ALL entries with a `project_id` are processed. Projects without billing config get `DEFAULT_BILLING_CONFIG` (rate=0, default rounding) from `billingCalculations.ts`.

**Key lines changed:**
- Import `DEFAULT_BILLING_CONFIG` from billingCalculations
- Replaced `matchedEntries` filter with `allEntries` that processes all entries
- `getBillingConfig` now returns `billingConfigByProjectId.get(projectId) || DEFAULT_BILLING_CONFIG`

**Result:** Non-billable projects now appear in `billingResult` with hours tracked and $0 revenue. Employee Performance table shows all projects.

### Bug 2 Fix: Dashboard + InvestorDashboard + DashboardChartsRow + chartTransforms + useTimesheetData

**Root cause of v1 deployment failure (showing $101K instead of $127K for January):**
The initial fix naively added ALL billing transaction amounts on top of timesheet revenue for non-selected months. But for milestone-linked billings, the correct behavior is to REPLACE the linked project's timesheet revenue with the milestone amount. Simply adding the milestone amount double-counts: the project's timesheet revenue stays in the chart base AND the milestone amount is added on top. The fix needed to subtract the linked project's base timesheet revenue from the billing adjustment.

**Files modified:**
1. `src/utils/chartTransforms.ts` — Added `aggregateProjectRevenueByMonth()` utility to compute per-project-per-month timesheet revenue from extended entries (using base project rates).
2. `src/hooks/useTimesheetData.ts` — Exposed `projectRevenueByMonth` (Map<month, Map<projectId, revenue>>) computed from extended entries. This provides the per-project revenue data needed for milestone adjustment.
3. `src/components/Dashboard.tsx` — Billing transaction fetch now includes billing type and linked_project_id via Supabase relation join (`billings(type, linked_project_id)`). Raw transactions stored in state, then `billingCentsByMonth` computed in a `useMemo` that adjusts for milestone replacement: for each linked milestone, subtracts the linked project's base timesheet revenue (once per project per month) from the billing total.
4. `src/components/DashboardChartsRow.tsx` — No changes needed (receives adjusted data).
5. `src/components/pages/InvestorDashboardPage.tsx` — Same milestone-adjusted billing computation as Dashboard.

**Chart correction logic (v2):**
- Selected month: uses precise `combinedTotalRevenue` (handles milestone replacement via effective rates)
- Other months: `billingCentsByMonth` now = rawBillingCents - linkedProjectTimesheetRevenueCents, so adding it to the chart's timesheet revenue effectively replaces milestone-linked project revenue with the milestone amount

**Key formula:**
```
For non-selected months:
  chart_revenue = base_timesheet_rev + adjustedBillingCents/100
  where adjustedBillingCents = allBillingCents - sum(linked_project_base_ts_rev * 100)
  effectively = (non_linked_ts_rev) + (all_billing_amounts/100)
```

### TypeScript Validation

`npx tsc --noEmit` — passed with zero errors (both v1 and v2).
