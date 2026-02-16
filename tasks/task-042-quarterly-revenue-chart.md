# Task 042: Quarterly Revenue Chart

**Status:** Complete
**Stack:** React, TypeScript, Tailwind CSS, Recharts
**Date:** 2026-02-16

## Scope

Add a quarterly revenue chart alongside the existing 12-Month Revenue Trend chart. The 12-month chart takes 2/3 width and the new quarterly chart takes 1/3. The quarterly chart shows the same data (Target, Budget, Revenue) for only the 3 months of the selected quarter — no optimistic/pessimistic projections. A Select dropdown allows choosing Q1–Q4. Current year only. Applies to both Dashboard and Investor Dashboard pages.

## Design

### Layout
```
┌──────────────────────────────────┬─────────────────┐
│  12-Month Revenue Trend (2/3)    │  Q_ Revenue (1/3)│
│                                  │  [Q1 ▼]         │
│  Target / Budget / Revenue /     │  Target / Budget │
│  Optimistic / Pessimistic        │  / Revenue       │
└──────────────────────────────────┴─────────────────┘
```

### Quarterly Chart Behavior
- Shows cumulative values from the 12-month data (year-to-date, consistent with main chart)
- X-axis: 3 month labels (e.g., Jan/Feb/Mar for Q1)
- Lines: Target, Budget, Revenue only (bestCase/worstCase set to null)
- Quarter dropdown: Q1, Q2, Q3, Q4 — defaults to current quarter
- Legend hidden (redundant with adjacent 12-month chart)

## Steps

### Step 1: Add `transformToQuarterlyChartData()` in `chartTransforms.ts`
- Accept the full 12-month `LineGraphDataPoint[]` array and a quarter number (1–4)
- Slice to the 3 months for that quarter (indices 0–2, 3–5, 6–8, 9–11)
- Null out `bestCase` and `worstCase` fields
- Return the 3-element `LineGraphDataPoint[]`

### Step 2: Update `DashboardChartsRow.tsx` layout
- Add `useState` for selected quarter (default: current quarter)
- Change the full-width revenue trend Card to a grid: `grid-cols-1 lg:grid-cols-[2fr_1fr]`
- Left column: existing 12-Month Revenue Trend card (unchanged)
- Right column: new Quarterly Revenue card with:
  - Header row: title + Select dropdown (Q1/Q2/Q3/Q4)
  - `LineGraphAtom` with quarterly data, `showLegend={false}`
- Compute quarterly data via `useMemo` from `lineData` + selected quarter

### Step 3: Update `InvestorDashboardPage.tsx` layout
- Same pattern as DashboardChartsRow: add quarter state, grid layout, quarterly chart card
- Reuse the same `transformToQuarterlyChartData()` function

### Step 4: Verify
- Both pages render side-by-side charts at correct proportions
- Quarter dropdown updates the chart data
- Responsive: stacks vertically on small screens (`grid-cols-1` below `lg`)
- No TypeScript errors

## Files Changed

1. **Modified** `src/utils/chartTransforms.ts` — Add `transformToQuarterlyChartData()`
2. **Modified** `src/components/DashboardChartsRow.tsx` — 2/3 + 1/3 grid layout with quarterly chart
3. **Modified** `src/components/pages/InvestorDashboardPage.tsx` — Same layout change

## Verification

- [x] 12-Month Revenue Trend displays at 2/3 width on large screens
- [x] Quarterly Revenue chart displays at 1/3 width on large screens
- [x] Charts stack vertically on small screens
- [x] Quarter dropdown defaults to current quarter
- [x] Selecting a different quarter updates the chart to show correct 3 months
- [x] Quarterly chart shows Target, Budget, Revenue lines only (no projections)
- [x] Quarterly chart values match the corresponding months in the 12-month chart
- [x] Legend hidden on quarterly chart
- [x] Both Dashboard and Investor Dashboard pages updated
- [x] `npx tsc --noEmit` passes
