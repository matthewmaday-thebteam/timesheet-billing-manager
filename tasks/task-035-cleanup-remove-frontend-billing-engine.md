# Task 035: Cleanup — Remove Frontend Billing Engine

**Status:** COMPLETE
**Depends on:** Task 034 (Feature-flagged cutover validated — summary mode confirmed matching)
**Stack:** React/TypeScript + Supabase/Postgres
**Scope:** Remove frontend billing calculation engine and feature flag infrastructure, making `project_monthly_summary` the sole billing source.

---

## Context

Step 3 (Task 034) deployed the feature-flagged cutover. Summary mode has been validated — all numbers match across all pages. The summary table is now the trusted source. This step removes the frontend billing calculation engine and the feature flag infrastructure.

---

## Critical Finding: `useProjectHierarchy`

`src/hooks/useProjectHierarchy.ts` calls `useUnifiedBilling` directly (not through the `useBilling` wrapper). It's used by `ProjectsPage.tsx` for the 5-tier Company > Project > Employee > Day > Task hierarchy.

**Fix:** Refactor `useProjectHierarchy` to accept `billingResult` as a param instead of calling `useUnifiedBilling` internally. `ProjectsPage` will call `useBilling` and pass the result down.

---

## Files to DELETE (4)

| File | Reason |
|------|--------|
| `src/hooks/useUnifiedBilling.ts` | Frontend billing engine — replaced by summary table |
| `src/hooks/useCombinedRevenueByMonth.ts` | Frontend multi-month chart calculator — replaced by `useSummaryCombinedRevenueByMonth` |
| `src/hooks/useCarryoverSync.ts` | Frontend carryover persistence — SQL handles this natively |
| `src/contexts/BillingSourceContext.tsx` | Feature flag context — single mode now, no longer needed |

## Files to MODIFY (10)

### 4.1: `src/utils/billingCalculations.ts` — Strip functions, keep types
- **Remove:** `calculateTaskBilling`, `calculateProjectBilling`, `calculateCompanyBilling`, `calculateMonthlyBilling`, `buildBillingInputs`, `DEFAULT_BILLING_CONFIG`
- **Keep:** All type/interface exports (`MonthlyBillingResult`, `CompanyBillingResult`, `ProjectBillingResult`, `TaskBillingResult`, `CompanyInput`, `ProjectInput`, `TaskInput`, `ProjectBillingConfig`, `CanonicalCompanyResult`, `BuildBillingInputsParams`, `BilledHoursResult`)
- 7 files still import types from this file

### 4.2: `src/hooks/useBilling.ts` — Simplify to summary-only
- Remove `useUnifiedBilling` import and call
- Remove `useBillingSource` import and feature flag logic
- Remove parallel-mode discrepancy logging
- Only call `useSummaryBilling({ selectedMonth })`
- Simplify params to just `{ selectedMonth: MonthSelection }`
- Return `billingResult` (non-nullable, using empty default when null)
- Keep returning `unmatchedProjects: []`, `allProjectsMatched: true`, `isLoading`

### 4.3: `src/hooks/useCombinedRevenue.ts` — Simplify to summary-only
- Remove `useCombinedRevenueByMonth` import and call
- Remove `useBillingSource` import and feature flag logic
- Remove parallel-mode discrepancy logging
- Only call `useSummaryCombinedRevenueByMonth`
- Simplify params to `{ dateRange, extendedMonths }` (drop `extendedEntries`, `projectCanonicalIdLookup`)

### 4.4: `src/hooks/useProjectHierarchy.ts` — Accept billingResult as prop
- Remove `import { useUnifiedBilling }` (line 18)
- Remove internal `useUnifiedBilling` call (line 99)
- Add `billingResult: MonthlyBillingResult` to params interface
- Remove `projectsWithRates` from params (was only for useUnifiedBilling)
- Existing logic that reads from `billingResult` stays unchanged

### 4.5: `src/components/pages/ProjectsPage.tsx` — Add useBilling call
- Add `import { useBilling }`
- Call `useBilling({ selectedMonth })` to get `billingResult`
- Pass `billingResult` to `useProjectHierarchy` (replacing `projectsWithRates`)

### 4.6: `src/components/Dashboard.tsx` — Simplify hook calls
- Simplify `useBilling` call: `useBilling({ selectedMonth })` (drop entries/rates/lookup)
- Simplify `useCombinedRevenue` call: drop `extendedEntries`, `projectCanonicalIdLookup`

### 4.7: `src/components/pages/RevenuePage.tsx` — Remove carryover + simplify
- Remove `import { useCarryoverSync }`
- Remove `useCarryoverSync(...)` call
- Simplify `useBilling` call: `useBilling({ selectedMonth })`

### 4.8: `src/components/pages/EmployeesPage.tsx` — Simplify hook call
- Simplify `useBilling` call: `useBilling({ selectedMonth })`

### 4.9: `src/components/pages/InvestorDashboardPage.tsx` — Simplify hook calls
- Simplify `useBilling` call: `useBilling({ selectedMonth })`
- Simplify `useCombinedRevenue` call: drop `extendedEntries`, `projectCanonicalIdLookup`

### 4.10: `src/components/pages/DiagnosticsPage.tsx` — Remove toggle + comparison panel
- Remove `useBillingSource` import and `BILLING_SOURCE_OPTIONS`
- Remove billing source toggle UI
- Remove `useUnifiedBilling` import and call
- Remove `SummaryComparisonPanel` component (no frontend to compare against)
- Switch `appBillingByProject` to use `summaryBillingResult` (for file validation)

### 4.11: `src/App.tsx` — Remove BillingSourceProvider
- Remove `BillingSourceProvider` import
- Remove `<BillingSourceProvider>` wrapper from JSX

---

## What Does NOT Change

- `useSummaryBilling` — stays intact (now the primary billing hook)
- `useSummaryCombinedRevenueByMonth` — stays intact
- `useBillings` — stays intact (fetches fixed billing transactions, still needed by 4 pages)
- All milestone/billing transaction logic in consumer pages — stays intact
- Props-only consumers (DashboardChartsRow, RevenueTable, EmployeePerformance, FormulasPage) — no changes
- `BillingsPage` — no changes

---

## Verification

- [x] `npx tsc --noEmit` passes cleanly (exit code 0)
- [ ] All pages render: Dashboard, Revenue, Employees, Projects, Investor Dashboard, Diagnostics
- [ ] Revenue numbers match what was validated in Step 3
- [ ] Projects page still shows 5-tier hierarchy correctly
- [ ] Diagnostics file validation still works with summary data
- [ ] Deploy via `npx vercel --prod`
