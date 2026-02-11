# Task 040: Add Week Filter to Customer Revenue Report Modal

## Status: Complete

## Stack
- React (RevenuePage.tsx)
- date-fns (week calculations)
- Supabase (v_timesheet_entries query with date range)

## Scope
Add a week dropdown to the Customer Revenue Report modal so the report can be scoped to a single week within the selected month.

## Files Modified
1. **`src/utils/calculations.ts`** — Added `WeekOption` interface and `getWeekOptionsForMonth()` utility
2. **`src/hooks/useTaskBreakdown.ts`** — Added optional `dateRange` and `skip` parameters
3. **`src/components/pages/RevenuePage.tsx`** — Week dropdown state, weekly billing computation, CSV export update

## Key Design Decisions
- Weekly mode uses simple calculation: `roundedHours * rate` per task
- No MIN/MAX billing limits (monthly concepts)
- No carryover adjustments (monthly)
- No milestone overrides (monthly)
- No fixed billings (monthly)
- Rounding still applies per-task
- Companies with zero weekly revenue are excluded from weekly export
- CSV filename includes week range when a week is selected

## Implementation Steps
1. Added `getWeekOptionsForMonth()` to `calculations.ts` — returns Monday-based week options clamped to month boundaries
2. Added `dateRange` and `skip` params to `useTaskBreakdown` hook — enables filtered queries by date range
3. Added `customerReportWeek` state and `Select` dropdown to Customer Revenue Report modal
4. Added second `useTaskBreakdown` instance for weekly data (skipped when 'all' selected)
5. Built `weeklyBillingResult` memo that computes simple revenue from weekly task data
6. Updated `handleExportCustomerRevenue` to branch on weekly vs monthly mode
7. Updated CSV filename to include week range suffix

## Verification
- [x] Week dropdown appears in Customer Revenue Report modal
- [x] "Entire Month" selected by default — exports same as before (no regression)
- [x] Selecting a specific week filters task data to that week only
- [x] Weekly revenue = sum of (roundedHours * rate) per task, no MIN/MAX/carryover
- [x] Company filter works in combination with week filter
- [x] CSV filename includes week range when a week is selected
- [x] Companies with zero weekly revenue are excluded from export
- [x] `npx tsc --noEmit` passes
