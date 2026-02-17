# Task 045: MetricCard Loading States

## Status: Complete

## Stack
- React (TypeScript)
- Tailwind CSS

## Problem

MetricCards display incorrect/misleading values while async data is still loading. Because multiple hooks resolve at different times, computed metrics (underutilization, lost revenue, utilization %, time off) are calculated from partial data — showing wrong numbers that jump to the correct values a couple seconds later. This creates a confusing UX where the user sees a "random" number shift to the real one.

**Example:** On EmployeesPage, `employees` might load before `entries`, causing `useUtilizationMetrics` to calculate 100% underutilization (employees exist but no hours recorded yet). Seconds later when entries arrive, the numbers jump to the real values.

## Scope

Add a loading state to MetricCard so it displays no value until the data is ready. Apply this pattern to all pages that render MetricCards with async data.

### Design Decision

Show an empty value area (render the card shell with title but display `—` for the value) while loading. This keeps layout stable (no CLS) while clearly indicating "not yet calculated."

## Pages Affected

| Page | MetricCards | Loading Sources | Currently Gated? |
|------|-------------|-----------------|-------------------|
| **EmployeesPage** | Underutilization, Lost Revenue, Utilization, Time Off | `useTimesheetData`, `useMonthlyRates`, `useEmployeeTableEntities`, `useTimeOff`, holidays fetch | No — cards render unconditionally |
| **Dashboard (StatsOverview)** | Total Hours, Utilization, Status, Projects, Resources, Under Target | `useTimesheetData`, `useBillings`, `useEmployeeTableEntities`, `useTimeOff`, `useMonthlyRates`, holidays fetch | Partial — gates on `loading \|\| billingsLoading` but NOT on employees/timeOff/rates/holidays that feed `utilizationPercent` |
| **RatesPage** | Average Rate, Target, Base Rate, At Target, Default | `useMonthlyRates` | No — cards render while `isLoading === true` |
| **EmployeeManagementPage** | Total, Full-time, Part-time, Contractor, Vendor, Incomplete | `useEmployeeTableEntities` | No — shows `0` while loading |
| **HolidaysPage** | Total Holidays, Auto-Generated, Manual, Year | `useHolidays` | No — shows `0` while loading |
| **UsersPage** | Total Users, Admins, Verified, Pending | `useAdminUsers` | No — shows `0` while loading |

**Already correct:** InvestorDashboardPage (wraps entire MetricCard grid in `isLoading` check with Spinner).

## Steps

### 1. MetricCard — Add `loading` prop

**File:** `src/components/MetricCard.tsx`

- Add optional `loading?: boolean` prop to `MetricCardProps`
- When `loading === true`, render `—` (em dash) in place of the value, using `text-vercel-gray-200` to indicate placeholder
- Keep the card shell (title, border, background) rendered for layout stability

```tsx
// In the value display area:
<span className={`text-2xl font-semibold ${loading ? 'text-vercel-gray-200' : valueClasses}`}>
  {loading ? '—' : value}
</span>
```

- When `loading === true`, hide the status dot and action button (no point showing "View" for data that isn't ready)

### 2. EmployeesPage — Gate utilization MetricCards on loading

**File:** `src/components/pages/EmployeesPage.tsx`

- Derive a combined loading state: `const metricsLoading = loading || !employees.length;` (or track individual hook loading states)
- Pass `loading={metricsLoading}` to all four MetricCards (Underutilization, Lost Revenue, Utilization, Time Off)
- Note: `useUtilizationMetrics` is a pure `useMemo` — it computes instantly from whatever data is available. The issue is its *inputs* arriving at different times.

### 3. Dashboard (StatsOverview) — Expand loading gate

**File:** `src/components/Dashboard.tsx`

- The existing gate at line 270 checks `loading || billingsLoading`
- Also need to wait for: `employees` (from `useEmployeeTableEntities`), `timeOff` (from `useTimeOff`), `holidays` (from state), and `projectsWithRates` (from `useMonthlyRates`)
- Options:
  - **Option A:** Expand the existing conditional to include all loading states → shows Spinner longer
  - **Option B:** Pass `loading` prop to `StatsOverview` which passes it to relevant MetricCards → shows card shells immediately, values appear when ready
- **Recommended: Option B** — feels more responsive, cards are visible, values fill in together

**File:** `src/components/StatsOverview.tsx`
- Add optional `utilizationLoading?: boolean` prop
- Pass it to the Utilization MetricCard as `loading`

### 4. RatesPage — Gate MetricCards on isLoading

**File:** `src/components/pages/RatesPage.tsx`

- Pass `loading={isLoading}` to all five MetricCards

### 5. EmployeeManagementPage — Gate MetricCards on loading

**File:** `src/components/pages/EmployeeManagementPage.tsx`

- Pass `loading={loading}` to all six MetricCards

### 6. HolidaysPage — Gate MetricCards on loading

**File:** `src/components/pages/HolidaysPage.tsx`

- Pass `loading={loading}` to all four MetricCards

### 7. UsersPage — Gate MetricCards on loading

**File:** `src/components/pages/UsersPage.tsx`

- Pass `loading={loading}` to all four MetricCards

## Verification

- [x] MetricCard shows `—` placeholder when `loading={true}`
- [x] MetricCard shows real value when `loading={false}` or `loading` not provided (backwards compatible)
- [x] EmployeesPage: Underutilization, Lost Revenue, Utilization, Time Off show `—` until all data loads, then show correct values simultaneously
- [x] Dashboard: Utilization card shows `—` until employees/timeOff/rates all resolve
- [x] RatesPage: Data-dependent rate metrics show `—` while `isLoading` is true; static values (Target, Base Rate) always show
- [x] EmployeeManagementPage: Counts show `—` while entities load; Incomplete alert suppressed while loading
- [x] HolidaysPage: Counts show `—` while holidays load; Year always shows (static)
- [x] UsersPage: Counts show `—` while users load
- [x] InvestorDashboardPage: Unchanged (already correct)
- [x] No layout shift when values appear (card dimensions remain stable)
- [x] `npx tsc --noEmit` passes
