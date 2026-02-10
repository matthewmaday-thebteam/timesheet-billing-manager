# Task 034: Feature-Flagged Billing Cutover

**Status:** IN PROGRESS
**Depends on:** Task 033 (Steps 1-2B complete, 0 discrepancies confirmed)
**Stack:** React/TypeScript + Supabase/Postgres
**Scope:** Switch frontend from in-browser billing (`useUnifiedBilling`) to reading from `project_monthly_summary`, controlled by a feature flag for safe parallel-run.

---

## Context

Migration 049 confirmed the SQL summary table produces identical results to the frontend — 0 discrepancies across all 30 projects. This task adds a feature flag to safely switch the data source.

---

## Steps

### 3.1: BillingSourceContext (CREATE)
- `src/contexts/BillingSourceContext.tsx`
- Three modes: `'frontend'` | `'summary'` | `'parallel'`
- Persisted in `localStorage` key `billing_source`
- Default: `'frontend'` (zero behavior change on deploy)

### 3.2: useBilling wrapper hook (CREATE)
- `src/hooks/useBilling.ts`
- Always calls both hooks (React rules — no conditional calls)
- Returns data from active source based on `useBillingSource()` mode
- In `'parallel'` mode: returns frontend data, logs discrepancies to console

### 3.3: useSummaryCombinedRevenueByMonth (CREATE)
- `src/hooks/useSummaryCombinedRevenueByMonth.ts`
- Single Supabase query to `v_combined_revenue_by_company_month` for last N months
- Returns same shape as `useCombinedRevenueByMonth`

### 3.4: useCombinedRevenue wrapper hook (CREATE)
- `src/hooks/useCombinedRevenue.ts`
- Same delegation pattern as `useBilling`

### 3.5: Update 4 consumer pages (MODIFY)
- `Dashboard.tsx` → `useBilling` + `useCombinedRevenue`
- `RevenuePage.tsx` → `useBilling`
- `EmployeesPage.tsx` → `useBilling`
- `InvestorDashboardPage.tsx` → `useBilling` + `useCombinedRevenue`

### 3.6: DiagnosticsPage toggle (MODIFY)
- Add billing source select at top of page

### 3.7: Wire up BillingSourceProvider (MODIFY)
- Add to App.tsx provider tree

---

## Verification

- [ ] Default mode (`'frontend'`): All pages render identically to today
- [ ] Switch to `'summary'` via DiagnosticsPage: All pages show DB-sourced data
- [ ] Switch to `'parallel'`: Console logs any discrepancies
- [ ] `npx tsc --noEmit` passes cleanly
- [ ] Revenue match: Dashboard, RevenuePage, InvestorDashboardPage show same numbers
- [ ] Edge cases: MIN/MAX/carryover projects match

---

## Rollback

Switch localStorage `billing_source` back to `'frontend'` (or clear it). Zero code deployment needed.
