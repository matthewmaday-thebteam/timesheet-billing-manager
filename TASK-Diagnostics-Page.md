# Task: Billing Diagnostics Page

## Summary
Create a Diagnostics page accessible from the user avatar menu that validates billing calculations by comparing raw source data (Clockify and ClickUp exports) against the processed billing results.

---

## User Story
As an administrator, I want to upload raw timesheet exports and verify that the billing calculations are correct at each stage, so I can trust the revenue figures displayed in the application.

---

## Requirements

### 1. Menu Integration
- Add "Diagnostics" link to avatar dropdown menu
- Position: Between "Users" and "Sign out"

### 2. Diagnostics Page Features
- **File Upload**: Two file inputs for `clockify.txt` and `clickup.txt`
- **Run Validation** button to process uploaded files
- **Validation Report** showing results per project

### 3. Validation Stages (per project)
| Stage | Description | Formula |
|-------|-------------|---------|
| Raw Minutes | Total minutes from source file | SUM(entry.duration) |
| Actual Hours | Raw minutes converted | rawMinutes / 60 |
| Rounded Hours | Per-task rounding applied | SUM(CEIL(taskMin/rounding) * rounding) / 60 |
| Base Revenue | Before billing limits | roundedHours × rate |
| Billed Revenue | After min/max/carryover | billedHours × rate |

### 4. Report Display
Each project card shows:
- Client / Project name
- Source (Clockify or ClickUp)
- All calculation stages with pass/fail indicators
- Highlight any discrepancies in red

Summary section shows:
- Total projects validated
- Pass/fail counts per stage
- Total billed revenue

---

## Data Formats

### Clockify (clockify.txt)
- Duration in **seconds**
- Has `projectName`, `clientName` directly
- Task name in `description` field

### ClickUp (clickup.txt)
- Duration in **milliseconds** (as string)
- Uses `spaceLookup` for client name
- Uses `folderLookup` for project name
- Task name in `task.name` field

---

## Files to Create

| File | Description |
|------|-------------|
| `src/components/pages/DiagnosticsPage.tsx` | Main page component |
| `src/utils/diagnostics/types.ts` | Type definitions |
| `src/utils/diagnostics/parseRawSources.ts` | File parsers |
| `src/utils/diagnostics/validateBilling.ts` | Validation logic |
| `src/utils/diagnostics/index.ts` | Barrel export |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/MainHeader.tsx` | Add Diagnostics menu item |
| `src/App.tsx` | Add `/diagnostics` route |

---

## Acceptance Criteria

- [ ] Diagnostics link appears in avatar menu between Users and Sign out
- [ ] Page loads at `/diagnostics` route
- [ ] Can upload clockify.txt and clickup.txt files
- [ ] "Run Validation" button triggers validation
- [ ] Report shows each project with all stages
- [ ] Pass/fail indicators are accurate
- [ ] Summary shows total counts
- [ ] Uses existing design tokens and components

---

## Technical Notes

- Reuses `billingCalculations.ts` for calculation functions
- Fetches billing config from `useMonthlyRates` hook
- Uses existing Card, Badge, Button components
- Client-side only (no server changes needed)
