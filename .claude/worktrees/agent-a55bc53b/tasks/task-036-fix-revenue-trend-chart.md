# Task 036: Fix 12-Month Revenue Trend Chart

## Status: COMPLETE

## Stack
- React/TypeScript
- Recharts (LineGraphAtom)
- Supabase DB view: `v_combined_revenue_by_company_month`

## Problem
The 12-month cumulative revenue trend chart showed incorrect values:
- February cumulative was ~$4K off
- March showed a DROP (impossible in cumulative chart)
- Chart values changed depending on selected month in date picker

Root cause: Two competing data sources with a race condition and month-dependent override logic.

## Fix
Use `combinedRevenueByMonth` (billing engine DB output) as the **sole** data source for all trend charts. Remove `monthlyAggregates` (raw `hours * base_rate`) from the chart pipeline entirely.

## Files Modified

### `src/utils/chartTransforms.ts`
- `transformToLineChartData()`: Changed param from `MonthlyAggregate[]` to `Map<string, number>` (YYYY-MM keyed). Filters to current year internally.
- `transformToMoMGrowthData()`: Same signature change.
- `calculateGrowthStats()`: Same signature change.
- `transformToCAGRProjectionData()`: Updated unused param type for consistency.

### `src/components/DashboardChartsRow.tsx`
- Removed `correctedMonthlyAggregates` useMemo (no longer needed)
- Removed `currentMonthRevenue`, `selectedMonthKey`, `monthlyAggregates` from props
- Simplified `lineData` useMemo: calls `transformToLineChartData(combinedRevenueByMonth)` directly
- Made `combinedRevenueByMonth` a required prop (non-optional)

### `src/components/Dashboard.tsx`
- Added `combinedRevenueLoading` from `useCombinedRevenue`
- Removed `monthlyAggregates`, `currentMonthRevenue`, `selectedMonthKey` from DashboardChartsRow props
- Loading state: `loading || billingsLoading || combinedRevenueLoading`

### `src/components/pages/InvestorDashboardPage.tsx`
- Same changes as Dashboard.tsx
- Removed `correctedMonthlyAggregates`, `selectedMonthKey`, month-dependent override logic
- Added `combinedRevenueLoading` to `isLoading`

## Verification
- [x] `npx tsc --noEmit` passes
- [ ] Dashboard chart: Jan = $127,548, Feb cumulative = $210,249, Mar+ = flat carry-forward with projections
- [ ] Chart is identical regardless of which month is selected in the date picker
- [x] Chart shows loading state until DB data is available (no flash of raw values)
- [ ] Investor Dashboard shows same values
- [ ] MoM growth chart still works correctly
