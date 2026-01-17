# Task 026: Group Projects by Company in Rates Tab

**Status:** COMPLETE

## 1. Problem Statement

The Rates tab currently shows a flat list of projects. To support the Company => Project hierarchy, projects should be grouped under their parent company/client with collapsible sections.

**Current:** Flat list of projects
```
Project A | Hours | Rate | Revenue
Project B | Hours | Rate | Revenue
```

**Target:** Grouped by company
```
▼ Company X (subtotal)
   Project A | Hours | Rate | Revenue
   Project B | Hours | Rate | Revenue
▼ Company Y (subtotal)
   Project C | Hours | Rate | Revenue
```

## 2. Approach

**Option A: Extend AccordionFlat with row grouping**
- Add `groupBy` prop to AccordionFlat component
- Group rows under collapsible sub-headers
- Minimal changes, reuses existing component

## 3. Implementation Plan

### Step 1: Database - Update View
**File:** `supabase/migrations/018_update_view_with_client.sql`
- Add `client_id`, `client_name` to `v_timesheet_entries` view

### Step 2: TypeScript Types
**File:** `src/types/index.ts`
- Add `client_id`, `client_name` to `TimesheetEntry` interface

### Step 3: Aggregation Logic
**File:** `src/utils/calculations.ts`
- Update `aggregateByProject()` to include client info in ProjectSummary
- Or create new `aggregateByCompany()` function

### Step 4: Extend AccordionFlat
**File:** `src/components/AccordionFlat.tsx`
- Add optional `groups` prop for grouped rows
- Render group headers with subtotals
- Make groups collapsible

### Step 5: Update BillingRatesTable
**File:** `src/components/BillingRatesTable.tsx`
- Group projects by client_name
- Pass grouped data to AccordionFlat

## 4. Files to Modify

| File | Action |
|------|--------|
| `supabase/migrations/018_update_view_with_client.sql` | CREATE |
| `src/types/index.ts` | MODIFY - add client fields to TimesheetEntry |
| `src/utils/calculations.ts` | MODIFY - add client to ProjectSummary |
| `src/components/AccordionFlat.tsx` | MODIFY - add grouping support |
| `src/components/BillingRatesTable.tsx` | MODIFY - group by company |

## 5. Dependencies

- **Requires Task 025** - client_id/client_name columns must exist in database
- **Requires n8n sync** - client data must be populated

## 6. Verification

1. Run migration 018
2. Verify client data exists: `SELECT DISTINCT client_name FROM v_timesheet_entries`
3. Check Rates tab groups projects by company
4. Verify subtotals are correct per company
5. Verify total matches previous total

---

## Implementation Notes

**Date:** 2026-01-17

### Files Created
| File | Description |
|------|-------------|
| `supabase/migrations/018_update_view_with_client.sql` | Updates views to include client_id and client_name |
| `supabase/migrations/019_fix_project_auto_creation.sql` | Fixes trigger to auto-create projects on INSERT OR UPDATE |

### Files Modified
| File | Changes |
|------|---------|
| `src/types/index.ts` | Added `client_id`, `client_name` to `TimesheetEntry`; Added `clientId`, `clientName` to `ProjectSummary` |
| `src/utils/calculations.ts` | Updated `aggregateByProject()` to include client info |
| `src/components/AccordionFlat.tsx` | Added `AccordionFlatGroup` type, `groups` prop, spacer for REVENUE column alignment |
| `src/components/BillingRatesTable.tsx` | Groups projects by `clientName`, implements Two-Line Alignment Rule |
| `src/components/pages/RatesPage.tsx` | Replaced flat table with BillingRatesTable accordion, added date filter |
| `src/components/Dashboard.tsx` | Removed BillingRatesTable (now lives on RatesPage only) |

### Two-Line Alignment Rule
Implemented consistent horizontal alignment in the billing rates table:
- **Edge Line:** Header total + 3-dot icons flush with container right padding
- **Financial Line:** REVENUE header + all dollar amounts 16px left of icons

### Bug Fix: Project Auto-Creation
The original trigger `trg_auto_create_project` only fired on INSERT. When n8n does an UPSERT that results in an UPDATE, new projects weren't created. Migration 019 fixes this by:
1. Changing trigger to fire on `INSERT OR UPDATE`
2. Backfilling any missing projects from existing timesheet data

### TypeScript Validation
- Passed with no errors

### Deployment Steps
1. Run migration 017 (add client columns) - from Task 025
2. Run migration 018 (update views)
3. Run migration 019 (fix project auto-creation trigger)
4. Update n8n workflows to include client data - from Task 025
5. Deploy frontend changes to Vercel
6. Trigger sync to populate client data

### Rollback
If issues occur, revert frontend changes. Views can be reverted by re-running migration 006.

