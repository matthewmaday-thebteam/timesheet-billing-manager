# Task 043: Under-Hours Highlighting on Burn Grid

## Status: Complete

## Stack
- React (TypeScript)
- Tailwind CSS

## Scope
Highlight cells on the Burn page daily hours grid where employees logged fewer hours than expected on normal working days.

### Rules
- Full-time employee + day < 7 hours → highlight
- Part-time employee + day < 4 hours → highlight
- Only on normal working days (not weekends, holidays, or time-off days)
- Does NOT apply to vendors or contractors (unknown employment types skipped)

## Files Changed
| File | Change |
|------|--------|
| `src/components/pages/BurnPage.tsx` | Added `useMemo` to compute `underHoursCells` set; pass to BurnGrid |
| `src/components/atoms/BurnGrid.tsx` | Added `underHoursCells` prop; apply `text-bteam-brand font-semibold` to matching cells |

## Steps
1. **BurnPage** — Compute `underHoursCells: Set<string>` (keys: `"employeeName|YYYY-MM-DD"`)
   - Map display name → employment type via `employees` + `userIdToDisplayNameLookup`
   - Map resource_id → display name for time-off lookup
   - Build holiday date set from `holidays`
   - Expand time-off date ranges per employee
   - Iterate burnGridData × dateRange: skip weekends, holidays, time-off, non-FT/PT; flag cells below threshold
2. **BurnGrid** — Accept `underHoursCells` prop; conditionally apply `text-bteam-brand font-semibold` vs `text-vercel-gray-600`

## Verification
- [x] Full-time employees with < 7 hours on a working day show brand-colored text
- [x] Part-time employees with < 4 hours on a working day show brand-colored text
- [x] Weekend cells are NOT highlighted regardless of hours
- [x] Holiday cells are NOT highlighted
- [x] Employee time-off days are NOT highlighted
- [x] Vendors and contractors are never highlighted
- [x] Cells at or above threshold (>=7 FT, >=4 PT) are NOT highlighted
- [x] Zero-hours cells ("—") on working days ARE highlighted for FT/PT employees
- [x] `npx tsc --noEmit` passes
