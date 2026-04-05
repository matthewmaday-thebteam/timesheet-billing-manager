# Implementation Plan: Billing Minimums, Maximums, Carry-Over, and Project Active Status

**Status:** Completed
**Created:** 2026-01-24
**Last Updated:** 2026-01-24

## Additional Features Implemented

### Company Canonical Mapping
- Added `useCanonicalCompanyMapping` hook for mapping companies to their canonical (primary) group
- Updated all CSV exports (Revenue, Rates, Projects) to use canonical company names
- Updated Revenue table, Rates table, and Projects table to group by canonical company
- Fixed Supabase view join issue - now fetches companies separately and joins in JavaScript

### UI Fixes
- Fixed AccordionFlat to properly expand all groups when loaded asynchronously
- Fixed RateEditModal validation to properly handle empty max hours (no maximum)
- Changed "Rate ($USD/hr)" column header to "Rate" in Rates page

---

## Overview

Add monthly billing rules to support:
- **Minimum billing** - Retainer-style billing (hours)
- **Maximum billing** - Cap on billable hours per month
- **Carry-over** - Excess hours roll to next month (or marked unbillable)
- **Active status** - Controls whether minimum billing applies

All values are configurable per-project, per-month, following the same pattern as rates and rounding.

---

## Architecture Decisions

### Decision 1: Table Structure
**Three separate tables** (following existing pattern):
1. `project_monthly_billing_limits` - min/max hours, carry-over flag
2. `project_monthly_active_status` - active boolean (controls minimum billing)
3. `project_carryover_hours` - stored carryover values with audit trail

### Decision 2: Minimum Billing Type
**Hours-based only**:
- `minimum_hours` - Minimum hours billed (e.g., 10h minimum)
- NULL = no minimum

### Decision 3: Carry-Over Storage
**Stored value** in `project_carryover_hours` table:
- Allows auditing and manual adjustments
- Tracks source month for transparency
- **Updated per DBA review**: Supports multiple source months per destination

### Decision 4: Active Status
**Per-month boolean** controlling minimum billing application:
- `is_active = true` → Minimum hours billed even if actual hours are lower
- `is_active = false` → Only bill actual/carryover hours (no minimum padding)
- Projects always appear in reports regardless of status
- Carryover and actual hours are ALWAYS billed regardless of status

---

## Phase 1: Database Schema

### File: `supabase/migrations/028_create_billing_rules.sql`

#### Table 1: Billing Limits
```sql
CREATE TABLE project_monthly_billing_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    limits_month DATE NOT NULL,

    minimum_hours NUMERIC(10, 2) DEFAULT NULL,  -- NULL = no minimum
    maximum_hours NUMERIC(10, 2) DEFAULT NULL,  -- NULL = unlimited
    carryover_enabled BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_project_monthly_limits UNIQUE (project_id, limits_month),
    CONSTRAINT chk_limits_month_first CHECK (EXTRACT(DAY FROM limits_month) = 1),
    CONSTRAINT chk_min_non_negative CHECK (minimum_hours IS NULL OR minimum_hours >= 0),
    CONSTRAINT chk_max_non_negative CHECK (maximum_hours IS NULL OR maximum_hours >= 0),
    CONSTRAINT chk_min_le_max CHECK (
        minimum_hours IS NULL OR maximum_hours IS NULL OR minimum_hours <= maximum_hours
    ),
    -- DBA Addition: Reasonable upper bounds
    CONSTRAINT chk_min_reasonable CHECK (minimum_hours IS NULL OR minimum_hours <= 744),
    CONSTRAINT chk_max_reasonable CHECK (maximum_hours IS NULL OR maximum_hours <= 744)
);

-- DBA Addition: Indexes
CREATE INDEX idx_billing_limits_project ON project_monthly_billing_limits(project_id);
CREATE INDEX idx_billing_limits_month ON project_monthly_billing_limits(limits_month);
CREATE INDEX idx_billing_limits_project_month ON project_monthly_billing_limits(project_id, limits_month DESC);
```

#### Table 2: Active Status
```sql
CREATE TABLE project_monthly_active_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status_month DATE NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_project_monthly_status UNIQUE (project_id, status_month),
    CONSTRAINT chk_status_month_first CHECK (EXTRACT(DAY FROM status_month) = 1)
);

-- DBA Addition: Indexes
CREATE INDEX idx_active_status_project ON project_monthly_active_status(project_id);
CREATE INDEX idx_active_status_month ON project_monthly_active_status(status_month);
```

#### Table 3: Carry-Over Tracking (Updated per DBA Review)
```sql
CREATE TABLE project_carryover_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    carryover_month DATE NOT NULL,  -- Month hours carry INTO
    source_month DATE NOT NULL,     -- Month excess hours came FROM

    carryover_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,

    -- DBA Addition: Audit trail for carryover calculation
    actual_hours_worked NUMERIC(10, 2) NOT NULL,
    maximum_applied NUMERIC(10, 2) NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- DBA Fix: Allow multiple source months per destination
    CONSTRAINT uq_project_carryover UNIQUE (project_id, carryover_month, source_month),
    CONSTRAINT chk_carryover_month_first CHECK (EXTRACT(DAY FROM carryover_month) = 1),
    -- DBA Addition: Source month validation
    CONSTRAINT chk_source_month_first CHECK (EXTRACT(DAY FROM source_month) = 1),
    CONSTRAINT chk_source_before_target CHECK (source_month < carryover_month),
    -- DBA Addition: Value constraints
    CONSTRAINT chk_carryover_non_negative CHECK (carryover_hours >= 0),
    CONSTRAINT chk_carryover_reasonable CHECK (carryover_hours <= 744)
);

-- DBA Addition: Indexes
CREATE INDEX idx_carryover_project ON project_carryover_hours(project_id);
CREATE INDEX idx_carryover_source ON project_carryover_hours(project_id, source_month);
CREATE INDEX idx_carryover_month ON project_carryover_hours(carryover_month);
```

#### Table 4: Billing Month Status (DBA Addition - Race Condition Prevention)
```sql
CREATE TABLE billing_month_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    billing_month DATE NOT NULL,

    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'calculating', 'closed', 'reopened')),

    -- Snapshot of calculated values at close time
    total_hours_worked NUMERIC(10, 2),
    total_billed_hours NUMERIC(10, 2),
    carryover_generated NUMERIC(10, 2),

    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES auth.users(id),
    reopened_at TIMESTAMPTZ,
    reopened_by UUID REFERENCES auth.users(id),
    reopen_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_project_billing_month UNIQUE (project_id, billing_month),
    CONSTRAINT chk_billing_month_first CHECK (EXTRACT(DAY FROM billing_month) = 1)
);

CREATE INDEX idx_billing_status_project ON billing_month_status(project_id);
CREATE INDEX idx_billing_status_month ON billing_month_status(billing_month);
```

#### Table 5: Billing Audit Log (DBA Addition)
```sql
CREATE TABLE billing_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data JSONB,
    new_data JSONB,
    changed_by UUID REFERENCES auth.users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_table_record ON billing_audit_log(table_name, record_id);
CREATE INDEX idx_audit_changed_at ON billing_audit_log(changed_at);
```

#### RPC Functions
- `get_effective_project_billing_limits(project_id, month)` - Returns limits with source tracking
- `get_effective_project_active_status(project_id, month)` - Returns status with source tracking
- `set_project_billing_limits_for_month(project_id, month, ...)` - Upsert limits
- `set_project_active_status_for_month(project_id, month, is_active)` - Upsert status
- `get_project_carryover_available(project_id, month)` - Get total carryover available for a month
- Update `get_all_project_rates_for_month()` to include all new fields

---

## Phase 2: TypeScript Types

### File: `src/types/index.ts`

```typescript
export interface ProjectBillingLimits {
  minimumHours: number | null;      // NULL = no minimum
  maximumHours: number | null;      // NULL = unlimited
  carryoverEnabled: boolean;
}

export interface BillingMonthStatus {
  status: 'open' | 'calculating' | 'closed' | 'reopened';
  closedAt: string | null;
  closedBy: string | null;
}

// Extend ProjectRateDisplay with:
// - minimumHours, maximumHours, carryoverEnabled
// - limitsSource, limitsSourceMonth, hasExplicitLimitsThisMonth
// - isActive (controls whether minimum applies)
// - activeSource, activeSourceMonth, hasExplicitActiveThisMonth
// - carryoverHoursIn (accumulated from previous months)
```

---

## Phase 3: Hooks

### File: `src/hooks/useMonthlyRates.ts`

Add new update functions:
- `updateBillingLimits(projectId, month, limits)` - Save billing limits
- `updateActiveStatus(projectId, month, isActive)` - Save active status

### New Files:
- `src/hooks/useBillingLimitsHistory.ts` - Fetch limits history
- `src/hooks/useActiveStatusHistory.ts` - Fetch status history

---

## Phase 4: Billing Calculation

### File: `src/utils/billing.ts`

```typescript
export interface BilledHoursResult {
  actualHours: number;      // Raw hours worked
  roundedHours: number;     // After per-task rounding
  adjustedHours: number;    // After carryover applied
  billedHours: number;      // After min/max applied
  carryoverOut: number;     // Hours to carry to next month
  unbillableHours: number;  // Hours that won't be billed
  minimumApplied: boolean;
  maximumApplied: boolean;
}

export function calculateBilledHours(
  actualMinutes: number,
  roundingIncrement: RoundingIncrement,
  limits: ProjectBillingLimits,
  carryoverIn: number,
  rate: number,
  isActive: boolean
): BilledHoursResult;
```

**Calculation Flow:**
```
Actual Minutes
    | [Per-task rounding]
    v
Rounded Hours
    | [+ Carryover from previous months (stacks)]
    v
Adjusted Hours
    | [Apply minimum threshold IF isActive=true]
    | [Apply maximum cap]
    v
Billed Hours x Rate = Revenue

Excess hours -> Carryover (cascades to next month) OR Unbillable
```

**DBA Note - Application-Level Validation:**
- Validate inherited min <= inherited max before calculation
- Use precise arithmetic (round to 2 decimals at final calculation)

---

## Phase 5: UI Updates

### File: `src/components/RateEditModal.tsx`

Add new form sections:
1. **Billing Limits** (collapsible)
   - Minimum Hours: Input (optional, null = no minimum)
   - Maximum Hours: Input (optional, null = unlimited)
   - Carry-Over Toggle: Switch (enabled only when max hours set)
   - Billing Limits History toggle

2. **Minimum Billing Status**
   - Apply Minimum Toggle: Switch (when OFF, minimum hours not billed)
   - Label: "Apply minimum billing for this project"
   - Status History toggle

### File: `src/components/BillingRatesTable.tsx`

Add columns:
- **Min** - Shows minimum hours (e.g., "10h" or "—")
- **Max** - Shows max hours (e.g., "40h" or "—")
- **C/O** - Carry-over indicator (checkmark or dash)
- **Min Active** - Badge showing if minimum billing applies

### File: `src/components/atoms/RevenueTable.tsx`

Add/update columns:
- **Adjusted** - Hours after carryover applied
- **Billed** - Hours after min/max applied
- **Unbillable** - Hours that won't be billed (when max exceeded without carryover)
- Visual indicators when minimum was applied
- Visual indicators when maximum was applied

---

## Phase 6: CSV Export Updates

### File: `src/components/pages/RevenuePage.tsx`

Add columns to CSV export:
- Actual Hours
- Carryover In
- Adjusted Hours
- Billed Hours
- Unbillable Hours
- Revenue

---

## Phase 7: Employee Performance

**No changes** to EmployeePerformance component.
Uses actual hours (not billed hours) to fairly represent employee work output.

---

## DBA Review Findings (2026-01-24)

### Priority 1 - Fixed in Schema Above
| Issue | Resolution |
|-------|------------|
| Carryover unique constraint too restrictive | Changed to `UNIQUE (project_id, carryover_month, source_month)` |
| Missing `source_month < carryover_month` check | Added constraint |
| Missing indexes | Added comprehensive indexes |
| Race condition on carryover | Added `billing_month_status` table |

### Priority 2 - Included in Schema
| Issue | Resolution |
|-------|------------|
| Reasonable upper bounds | Added 744 hour max constraints |
| Non-negative carryover | Added constraint |
| Audit logging | Added `billing_audit_log` table |

### Priority 3 - Documentation Required

#### Carryover Chain Behavior
**Decision needed:** When carryover cascades across months, does it stack?

Example:
- October: 120h worked, 100h max → 20h carries to November
- November: 115h worked, 100h max → What happens?

Options:
- **A) Stacking**: November has 20 + 115 = 135h, bills 100h, carries 35h to December
- **B) Reset**: Only November's 15h excess carries (loses October's carryover)
- **C) FIFO**: Use oldest carryover first, then new hours

**Current assumption:** Option A (Stacking)

#### Retroactive Change Handling
If someone edits October's maximum AFTER November carryover was calculated:
- Mark affected carryover records as stale
- Require recalculation before month can be closed

#### Mid-Month Project Creation
- Projects bill only from their creation date
- No proration in first month (document this decision)

---

## Open Questions for Review

1. **Carryover stacking behavior** - Confirm Option A is correct
2. **Month closing workflow** - Who can close/reopen months?
3. **Retroactive edits** - Auto-recalculate or require manual trigger?
4. **Audit log retention** - How long to keep audit records?

---

## Critical Files Summary

| File | Action |
|------|--------|
| `supabase/migrations/028_create_billing_rules.sql` | Create (new) |
| `src/types/index.ts` | Modify (add types) |
| `src/hooks/useMonthlyRates.ts` | Modify (add update functions) |
| `src/hooks/useBillingLimitsHistory.ts` | Create (new) |
| `src/hooks/useActiveStatusHistory.ts` | Create (new) |
| `src/components/RateEditModal.tsx` | Modify (add sections) |
| `src/components/BillingRatesTable.tsx` | Modify (add columns) |
| `src/utils/billing.ts` | Modify (add calculation) |
| `src/components/atoms/RevenueTable.tsx` | Modify (add columns) |
| `src/components/pages/RevenuePage.tsx` | Modify (CSV export) |

---

## Verification Plan

1. **Database**: Run migration, verify tables with constraints
2. **Inheritance**: Set limits for Jan, verify Feb inherits them
3. **Minimum Billing**: Set 10h minimum, work 5h, verify billed = 10h
4. **Maximum Billing**: Set 40h max, work 50h, verify carryover OR unbillable
5. **Active Status**: Mark project inactive, verify billing minimum not applied
6. **Carryover Stacking**: Verify multi-month cascade works correctly
7. **Revenue Page**: Verify adjusted/billed columns display correctly
8. **CSV Export**: Verify all columns appear in export
9. **Employee Performance**: Verify still shows actual hours
10. **TypeScript**: Run `npx tsc --noEmit`
11. **Deploy**: `vercel --prod` and test

---

## Agent Reviews

| Agent | Status | Date |
|-------|--------|------|
| Database Architect | Complete | 2026-01-24 |
| Financial Audit | Complete | 2026-01-24 |
| React/Next.js | Complete | 2026-01-24 |
| Elite Code Architect | Complete | 2026-01-24 |

---

## React/Next.js Architecture Review

**Reviewer:** React/Next.js Architect
**Date:** 2026-01-24
**Status:** Complete with Required Changes

---

### Summary

The UI implementation plan is well-structured and follows the correct patterns for extending RateEditModal and BillingRatesTable. However, several opportunities exist to better leverage the existing design system atoms and ensure token compliance. The plan should be updated to explicitly reference existing components and specify design library updates.

---

### Critical Issues

#### 1. Missing Atom Reuse - Input Component

**Location:** Phase 5, RateEditModal.tsx - Billing Limits Section

**Issue:** The plan describes adding "Input (optional)" fields for Minimum Hours and Maximum Hours without specifying that the existing `Input` atom (`/mnt/c/Users/Matthew/Dropbox/Organizations/Concept Companies/timesheet-billing-manager/src/components/Input.tsx`) must be used.

**Current Pattern in RateEditModal (lines 154-164):**
```tsx
<input
  type="text"
  inputMode="decimal"
  value={rateValue}
  onChange={(e) => handleRateChange(e.target.value)}
  className="w-full pl-7 pr-3 py-2 bg-white border border-vercel-gray-100 rounded-md..."
/>
```

**Required Change:** The plan should specify using the `Input` atom with appropriate props:
```tsx
<Input
  label="Minimum Hours"
  helperText="Leave empty for no minimum"
  size="md"
/>
```

**Recommendation:** Update Phase 5 to explicitly state: "Use the `Input` atom from `src/components/Input.tsx` for Minimum Hours and Maximum Hours fields."

---

#### 2. Missing Atom Reuse - Toggle Component

**Location:** Phase 5, RateEditModal.tsx - Carry-Over Toggle and Apply Minimum Toggle

**Issue:** The plan mentions "Switch" components but does not reference the existing `Toggle` atom (`/mnt/c/Users/Matthew/Dropbox/Organizations/Concept Companies/timesheet-billing-manager/src/components/Toggle.tsx`).

**Toggle Atom Signature:**
```tsx
interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}
```

**Recommendation:** Update Phase 5 to specify:
- "Carry-Over Toggle: Use `Toggle` atom with `label='Enable carry-over'` and `description='Excess hours roll to next month'`"
- "Apply Minimum Toggle: Use `Toggle` atom with `label='Apply minimum billing'` and `description='When off, only bill actual hours worked'`"

---

#### 3. Missing Atom Reuse - Badge Component

**Location:** Phase 5, BillingRatesTable.tsx - "Min Active" column

**Issue:** The plan states "Badge showing if minimum billing applies" but does not reference the existing `Badge` atom (`/mnt/c/Users/Matthew/Dropbox/Organizations/Concept Companies/timesheet-billing-manager/src/components/Badge.tsx`).

**Badge Atom Variants:**
- `variant="success"` - For "Active" status
- `variant="default"` - For "Inactive" status

**Recommendation:** Update Phase 5 to specify:
```tsx
// Min Active column
{project.isActive ? (
  <Badge variant="success">Active</Badge>
) : (
  <Badge variant="default">Inactive</Badge>
)}
```

---

### Recommendations

#### 1. Design Token Compliance - History Tables

**Location:** Phase 5, RateEditModal.tsx - Billing Limits History and Status History sections

**Issue:** The plan does not specify styling for the new history tables. The existing pattern in RateEditModal uses hardcoded styles that should be documented for consistency.

**Existing Pattern (lines 199-229):**
```tsx
<table className="w-full text-xs">
  <thead className="bg-vercel-gray-50">
    <tr>
      <th className="px-3 py-2 text-left text-vercel-gray-400 font-medium">Month</th>
      ...
    </tr>
  </thead>
  <tbody className="divide-y divide-vercel-gray-100">
    ...
  </tbody>
</table>
```

**Recommendation:** Add explicit token references to Phase 5:
- Table header: `bg-vercel-gray-50`, `text-vercel-gray-400`, `font-medium`, `text-xs`
- Table rows: `divide-vercel-gray-100`, hover state `hover:bg-vercel-gray-50`
- Table cells: `text-vercel-gray-600` (primary), `text-vercel-gray-400` (secondary)

---

#### 2. Column Layout Consistency - BillingRatesTable

**Location:** Phase 5, BillingRatesTable.tsx

**Issue:** Adding 4 new columns (Min, Max, C/O, Min Active) to BillingRatesTable may create horizontal scroll issues. Current columns are: Project, Rounding, Rate (3 columns).

**Recommendation:**
- Consider combining Min/Max into a single "Limits" column with format: "10h / 40h" or "10-40h"
- Use compact display for C/O column: checkmark icon (use existing SVG pattern) instead of text
- Ensure column widths follow existing patterns from AccordionFlat

**AccordionFlat Column Pattern:**
```tsx
const columns: AccordionFlatColumn[] = [
  { key: 'project', label: 'Project', align: 'left' },
  { key: 'limits', label: 'Limits', align: 'right' },  // Combined
  { key: 'rounding', label: 'Rounding', align: 'right' },
  { key: 'status', label: 'Status', align: 'center' },  // Badge
  { key: 'rate', label: 'Rate ($/hr)', align: 'right' },
];
```

---

#### 3. RevenueTable Column Additions

**Location:** Phase 5, RevenueTable.tsx

**Issue:** The plan adds Adjusted, Billed, and Unbillable columns without specifying visual hierarchy.

**Current Column Pattern (lines 219-238):**
- Header: `text-xs font-medium text-vercel-gray-400 uppercase tracking-wider`
- Values: Primary data uses `text-black`, secondary uses `text-vercel-gray-300`

**Recommendation:** Specify column styling:
| Column | Color | Weight | Purpose |
|--------|-------|--------|---------|
| Actual | `text-vercel-gray-300` | normal | Reference only |
| Hours (rounded) | `text-black` | normal | Existing |
| Adjusted | `text-vercel-gray-300` | normal | Intermediate calc |
| Billed | `text-black` | `font-medium` | Key billing value |
| Unbillable | `text-bteam-brand` | normal | Warning indicator |
| Revenue | `text-black` | `font-medium` | Primary value |

**Visual Indicators for min/max applied:**
- When minimum applied: Consider adding a small up-arrow icon or "min" badge
- When maximum applied: Consider adding a small cap icon or "max" badge
- Use `text-info-text` for informational indicators (not error/warning)

---

#### 4. Form Section Collapsibility Pattern

**Location:** Phase 5, RateEditModal.tsx

**Issue:** The plan mentions "collapsible" sections but doesn't reference the established pattern.

**Existing Expand/Collapse Pattern (lines 172-186):**
```tsx
<button
  type="button"
  className="text-xs text-vercel-gray-400 hover:text-vercel-gray-600 flex items-center gap-1"
  onClick={() => setShowRateHistory(!showRateHistory)}
>
  <svg
    className={`w-3 h-3 transition-transform ${showRateHistory ? 'rotate-90' : ''}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
  {showRateHistory ? 'Hide rate history' : 'Show rate history'}
</button>
```

**Recommendation:** Use this exact pattern for:
- "Show/Hide billing limits"
- "Show/Hide limits history"
- "Show/Hide status history"

---

#### 5. New Hook File Patterns

**Location:** Phase 3, new hook files

**Issue:** The plan creates `useBillingLimitsHistory.ts` and `useActiveStatusHistory.ts` without specifying the pattern to follow.

**Existing Pattern Reference:** `/mnt/c/Users/Matthew/Dropbox/Organizations/Concept Companies/timesheet-billing-manager/src/hooks/useRateHistory.ts` and `/mnt/c/Users/Matthew/Dropbox/Organizations/Concept Companies/timesheet-billing-manager/src/hooks/useRoundingHistory.ts`

**Recommendation:** Specify that new hooks should follow these patterns:
- Return `{ history, isLoading, error }`
- Use `useQuery` with proper cache keys
- Include formatting helper functions (e.g., `formatLimitsMonth`)

---

### Good Practices

1. **Following Established Patterns:** The plan correctly identifies extending existing components (RateEditModal, BillingRatesTable) rather than creating new ones.

2. **Separation of Concerns:** New hooks for history data follow the established pattern of separating data fetching from UI components.

3. **CSV Export Updates:** Including new columns in CSV export maintains feature parity between UI and exports.

4. **Employee Performance Unchanged:** Correctly identifies that billing adjustments should not affect actual hours display for employee performance metrics.

5. **Type Extensions:** Extending `ProjectRateDisplay` interface rather than creating parallel types maintains type coherence.

---

### Design Library Updates Required

The following should be added to the StyleReviewPage after implementation:

1. **Toggle Usage Example:** Add example showing Toggle in form context with disabled state based on another toggle's value.

2. **Table with Badges:** Add example showing Badge components within table cells for status indicators.

3. **Compact Column Display:** Document the "10h / 40h" format pattern for combined limit columns.

---

### Code Suggestions

#### RateEditModal - Billing Limits Section Structure

```tsx
{/* Billing Limits Section */}
<div>
  <button
    type="button"
    className="text-xs text-vercel-gray-400 hover:text-vercel-gray-600 flex items-center gap-1"
    onClick={() => setShowBillingLimits(!showBillingLimits)}
  >
    <svg className={`w-3 h-3 transition-transform ${showBillingLimits ? 'rotate-90' : ''}`} ...>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
    {showBillingLimits ? 'Hide billing limits' : 'Show billing limits'}
  </button>

  {showBillingLimits && (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Minimum Hours"
          type="text"
          inputMode="decimal"
          value={minHoursValue}
          onChange={(e) => handleMinHoursChange(e.target.value)}
          helperText="Leave empty for no minimum"
          size="md"
        />
        <Input
          label="Maximum Hours"
          type="text"
          inputMode="decimal"
          value={maxHoursValue}
          onChange={(e) => handleMaxHoursChange(e.target.value)}
          helperText="Leave empty for unlimited"
          size="md"
        />
      </div>

      <Toggle
        label="Enable carry-over"
        description="Excess hours roll to next month when maximum is set"
        checked={carryoverEnabled}
        onChange={setCarryoverEnabled}
        disabled={!maxHoursValue}  // Only enable when max is set
      />
    </div>
  )}
</div>
```

#### BillingRatesTable - Combined Limits Column Cell

```tsx
// Limits cell content
const limitsContent = (
  <span className="text-sm text-vercel-gray-600">
    {project.minimumHours !== null || project.maximumHours !== null ? (
      <>
        {project.minimumHours !== null ? `${project.minimumHours}h` : '—'}
        {' / '}
        {project.maximumHours !== null ? `${project.maximumHours}h` : '—'}
        {project.carryoverEnabled && (
          <svg className="inline-block w-3 h-3 ml-1 text-vercel-gray-400" ...>
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
      </>
    ) : (
      '—'
    )}
  </span>
);
```

#### RevenueTable - Billed Hours with Indicator

```tsx
// Billed hours cell with min/max indicator
<td className="px-6 py-3 text-right">
  <span className="text-sm font-medium text-black">
    {minutesToHours(row.billedMinutes)}
    {row.minimumApplied && (
      <Badge variant="info" size="sm" className="ml-1">min</Badge>
    )}
    {row.maximumApplied && (
      <Badge variant="warning" size="sm" className="ml-1">cap</Badge>
    )}
  </span>
</td>
```

---

### Pre-Implementation Checklist

Before starting implementation:

- [ ] Confirm Input atom supports `inputMode="decimal"` for numeric entry
- [ ] Confirm Toggle disabled state styling is acceptable
- [ ] Decide on combined "Limits" column vs separate Min/Max columns
- [ ] Confirm carry-over icon design (suggest using refresh/arrow icon)
- [ ] Create Badge variant for "info" style indicators if using min/max badges

---

### Verification Additions

Add to Verification Plan:

11. **Atom Reuse:** Verify all new inputs use `Input` atom
12. **Toggle Usage:** Verify all switches use `Toggle` atom
13. **Badge Usage:** Verify status indicators use `Badge` atom
14. **Token Compliance:** Run visual audit to confirm no hardcoded colors
15. **Responsive Layout:** Verify table columns don't cause horizontal scroll on 1280px viewport

---

## Elite Code Architect Review

**Reviewer:** Elite Code Architect
**Date:** 2026-01-24
**Status:** Complete with Recommendations

---

### Executive Summary

The implementation plan is architecturally sound and follows established codebase patterns. The separation of concerns between database, types, hooks, and UI layers is well-structured. However, several opportunities exist to improve code reuse, type safety, error handling, and testability. This review provides actionable recommendations organized by priority.

---

### 1. Code Organization Assessment

#### Strengths

1. **Consistent Table Patterns**: The three-table approach (`project_monthly_billing_limits`, `project_monthly_active_status`, `project_carryover_hours`) mirrors the existing `project_monthly_rates` and `project_monthly_rounding` patterns, ensuring predictable maintenance.

2. **Clear Separation of Concerns**: The phase structure (Database -> Types -> Hooks -> Utils -> UI) correctly sequences dependencies.

3. **Audit Table Addition**: The `billing_audit_log` table adds important traceability for financial operations.

#### Concerns

1. **File Proliferation**: The plan creates two new hooks (`useBillingLimitsHistory.ts`, `useActiveStatusHistory.ts`) that are nearly identical to existing patterns (`useRateHistory.ts`, `useRoundingHistory.ts`). This creates maintenance overhead.

**Recommendation**: Create a generic `useProjectMonthlyHistory<T>` hook factory:

```typescript
// src/hooks/useProjectMonthlyHistory.ts
interface MonthlyHistoryConfig<T> {
  tableName: string;
  monthColumn: string;
  selectColumns: string;
  mapRow: (row: any) => T;
}

export function createMonthlyHistoryHook<T>(config: MonthlyHistoryConfig<T>) {
  return function useMonthlyHistory(projectId: string | null) {
    // ... shared logic
  };
}

// Usage:
export const useBillingLimitsHistory = createMonthlyHistoryHook<BillingLimitsHistoryEntry>({
  tableName: 'project_monthly_billing_limits',
  monthColumn: 'limits_month',
  selectColumns: 'limits_month, minimum_hours, maximum_hours, carryover_enabled, updated_at',
  mapRow: (row) => ({
    limitsMonth: row.limits_month,
    minimumHours: row.minimum_hours,
    maximumHours: row.maximum_hours,
    carryoverEnabled: row.carryover_enabled,
    updatedAt: row.updated_at,
  }),
});
```

2. **useMonthlyRates Growing Too Large**: Adding `updateBillingLimits` and `updateActiveStatus` to the existing hook will expand its responsibility. The hook already handles rates and rounding.

**Recommendation**: Consider a facade pattern where `useMonthlyRates` composes smaller hooks:

```typescript
// Internal hooks
function useProjectRates(month: MonthSelection) { ... }
function useProjectRounding(month: MonthSelection) { ... }
function useProjectBillingLimits(month: MonthSelection) { ... }
function useProjectActiveStatus(month: MonthSelection) { ... }

// Public facade
export function useMonthlyRates({ selectedMonth }: UseMonthlyRatesOptions) {
  const rates = useProjectRates(selectedMonth);
  const rounding = useProjectRounding(selectedMonth);
  const limits = useProjectBillingLimits(selectedMonth);
  const status = useProjectActiveStatus(selectedMonth);

  return { ...rates, ...rounding, ...limits, ...status };
}
```

---

### 2. Type Safety Assessment

#### Strengths

1. **Well-Defined Core Types**: `ProjectBillingLimits` and `BillingMonthStatus` are appropriately scoped.

2. **Extending Existing Types**: Extending `ProjectRateDisplay` rather than creating parallel types is correct.

#### Concerns

1. **Missing Discriminated Union for Billing Result States**: The `BilledHoursResult` interface returns multiple boolean flags. A discriminated union would provide better type safety:

```typescript
// Current approach (problematic - allows invalid states)
export interface BilledHoursResult {
  minimumApplied: boolean;
  maximumApplied: boolean;
  // ... both could be true, which is invalid
}

// Recommended: Discriminated union
export type BillingAdjustment =
  | { type: 'none' }
  | { type: 'minimum_applied'; minimumHours: number }
  | { type: 'maximum_applied'; maximumHours: number; carryoverOut: number }
  | { type: 'maximum_applied_unbillable'; maximumHours: number; unbillableHours: number };

export interface BilledHoursResult {
  actualHours: number;
  roundedHours: number;
  adjustedHours: number;
  billedHours: number;
  adjustment: BillingAdjustment;
}
```

2. **Null vs Undefined Inconsistency**: The plan uses `null` for optional values in types but the existing codebase mixes `null` and `undefined`. Standardize on `null` for database-sourced optionals.

3. **Missing Branded Types for Hours**: Consider branded types to prevent mixing minutes and hours:

```typescript
type Hours = number & { readonly __brand: 'hours' };
type Minutes = number & { readonly __brand: 'minutes' };

function minutesToHours(minutes: Minutes): Hours {
  return (minutes / 60) as Hours;
}
```

4. **CarryoverHoursIn Type Missing**: The plan mentions `carryoverHoursIn` in `ProjectRateDisplay` comments but does not define the type structure for multiple source months.

**Recommendation**: Add explicit type:

```typescript
export interface CarryoverSource {
  sourceMonth: string;
  hours: number;
  calculatedAt: string;
}

// In ProjectRateDisplay extension:
carryoverHoursIn: CarryoverSource[];
totalCarryoverIn: number;
```

---

### 3. DRY Principles Assessment

#### Code Reuse Opportunities

1. **Date Formatting Functions**: The codebase has `formatRateMonth`, `formatRoundingMonth`, and will need `formatLimitsMonth`, `formatStatusMonth`. These are identical.

**Recommendation**: Consolidate into a single utility:

```typescript
// src/utils/dateFormatters.ts
export function formatMonthDisplay(isoDateString: string, format: 'short' | 'long' = 'short'): string {
  const date = new Date(isoDateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: format === 'short' ? 'short' : 'long',
    year: 'numeric'
  });
}
```

2. **RPC Call Pattern**: Every hook follows the same pattern for Supabase RPC calls with error handling. This should be abstracted:

```typescript
// src/lib/supabaseHelpers.ts
export async function callRpc<TParams, TResult>(
  functionName: string,
  params: TParams
): Promise<{ data: TResult | null; error: Error | null }> {
  const { data, error } = await supabase.rpc(functionName, params);
  if (error) {
    console.error(`RPC error in ${functionName}:`, error);
    return { data: null, error: new Error(error.message) };
  }
  return { data, error: null };
}
```

3. **History Table UI Component**: The rate history and rounding history table UIs in `RateEditModal` are nearly identical. Extract to a reusable component:

```typescript
// src/components/atoms/HistoryTable.tsx
interface HistoryTableProps<T> {
  data: T[];
  isLoading: boolean;
  columns: Array<{
    key: keyof T;
    header: string;
    align: 'left' | 'right';
    format?: (value: T[keyof T]) => string;
  }>;
  emptyMessage: string;
  maxRows?: number;
}

export function HistoryTable<T>({ data, isLoading, columns, emptyMessage, maxRows = 12 }: HistoryTableProps<T>) {
  // ... implementation
}
```

4. **Existing Utilities Not Referenced**: The plan should explicitly reference:
   - `formatHours()` from `billing.ts` for displaying hours
   - `formatCurrency()` from `billing.ts` for revenue displays
   - `minutesToHours()` from `calculations.ts`

---

### 4. Error Handling Assessment

#### Missing Error Scenarios

1. **Carryover Calculation Race Condition**: The `billing_month_status` table is added to prevent race conditions, but the plan lacks detail on:
   - What happens if calculation fails mid-way?
   - How to rollback partial carryover writes?
   - Retry semantics for failed calculations?

**Recommendation**: Add transaction wrapper for carryover calculations:

```typescript
export async function calculateAndStoreCarryover(
  projectId: string,
  sourceMonth: MonthSelection,
  targetMonth: MonthSelection
): Promise<{ success: boolean; error?: string }> {
  // 1. Acquire lock via billing_month_status (status = 'calculating')
  // 2. Perform calculation in transaction
  // 3. Write carryover record
  // 4. Update status to 'closed'
  // 5. If any step fails, rollback and set status back to 'open'
}
```

2. **Validation Errors Not Surfaced to UI**: The plan mentions database constraints but does not specify how constraint violations (e.g., `min > max`) are communicated to users.

**Recommendation**: Add error type mapping:

```typescript
// src/utils/errorHandling.ts
export function mapDatabaseError(error: Error): string {
  if (error.message.includes('chk_min_le_max')) {
    return 'Minimum hours cannot exceed maximum hours';
  }
  if (error.message.includes('chk_source_before_target')) {
    return 'Carryover source month must be before target month';
  }
  // ... other mappings
  return 'An unexpected error occurred';
}
```

3. **Missing Loading States**: The plan adds new data fetching but does not specify loading state handling for:
   - Initial billing limits load
   - Carryover calculation in progress
   - Month status transitions

4. **Stale Data Handling**: When a user has the Rates page open and someone else updates billing limits, there is no refresh mechanism mentioned.

**Recommendation**: Either implement real-time subscriptions or add a manual refresh button with last-updated timestamp display.

---

### 5. Performance Assessment

#### Concerns

1. **N+1 Query Risk in RevenueTable**: The current `RevenueTable` already processes data client-side. Adding billing limits, active status, and carryover lookups per-project will compound this.

**Recommendation**: Ensure the `get_all_project_rates_for_month` RPC is extended to include ALL billing fields in a single query, avoiding additional round-trips:

```sql
-- Extend existing RPC to return billing limits, active status, and carryover
CREATE OR REPLACE FUNCTION get_all_project_rates_for_month(p_month DATE)
RETURNS TABLE (
  -- existing fields
  project_id UUID,
  effective_rate NUMERIC,
  ...
  -- new fields
  minimum_hours NUMERIC,
  maximum_hours NUMERIC,
  carryover_enabled BOOLEAN,
  is_active BOOLEAN,
  carryover_hours_in NUMERIC
) AS $$
  -- Single optimized query
$$ LANGUAGE sql STABLE;
```

2. **Carryover Aggregation Performance**: Summing carryover from multiple source months requires a query for each project. Pre-aggregate in a materialized view or compute during month-close:

```sql
-- Consider a view for carryover totals
CREATE VIEW v_project_carryover_totals AS
SELECT
  project_id,
  carryover_month,
  SUM(carryover_hours) as total_carryover_hours
FROM project_carryover_hours
GROUP BY project_id, carryover_month;
```

3. **RevenueTable Memo Dependencies**: The current `companyData` useMemo has three dependencies: `[entries, dbRateLookup, roundingByProjectId]`. Adding billing limits will increase recalculation frequency.

**Recommendation**: Combine all project config into a single lookup object to minimize dependency changes:

```typescript
interface ProjectBillingConfig {
  rate: number;
  rounding: RoundingIncrement;
  minimumHours: number | null;
  maximumHours: number | null;
  carryoverEnabled: boolean;
  isActive: boolean;
  carryoverIn: number;
}

// Single map dependency
const configByProjectId = useMemo<Map<string, ProjectBillingConfig>>(() => {
  // Build from all sources
}, [ratesData, roundingData, limitsData, statusData, carryoverData]);
```

4. **CSV Export Performance**: Large datasets with complex calculations could freeze the UI. Consider using a Web Worker for CSV generation.

---

### 6. Testing Recommendations

#### Unit Tests Required

1. **`calculateBilledHours` Function** (Priority: Critical)
   - Test: Zero hours with minimum applied
   - Test: Hours exactly at minimum (no adjustment)
   - Test: Hours below minimum, active=true
   - Test: Hours below minimum, active=false
   - Test: Hours exactly at maximum
   - Test: Hours above maximum, carryover enabled
   - Test: Hours above maximum, carryover disabled (unbillable)
   - Test: Carryover stacking (carryoverIn + actual > max)
   - Test: Null minimum (no floor applied)
   - Test: Null maximum (no ceiling applied)
   - Test: Rounding applied before min/max
   - Test: Edge case - 0 rate
   - Test: Edge case - negative inputs (should error or clamp)

2. **`applyRounding` Function** (add edge cases)
   - Test: 0 minutes input
   - Test: Exactly on increment boundary (no rounding needed)
   - Test: Large minute values (regression for overflow)

3. **Type Guards**
   - Test: `isValidRoundingIncrement(value: number)`
   - Test: `isValidBillingStatus(value: string)`

#### Integration Tests Required

1. **Carryover Chain Calculation**
   - Multi-month cascade test (Oct -> Nov -> Dec)
   - Retroactive edit recalculation
   - Carryover with inactive status

2. **RPC Function Tests**
   - `get_effective_project_billing_limits` - inheritance behavior
   - `get_project_carryover_available` - aggregation from multiple sources
   - Month boundary handling (timezone issues)

#### End-to-End Tests Required

1. **Full Billing Workflow**
   - Create project with limits
   - Log hours exceeding maximum
   - Verify carryover generated
   - Next month: verify carryover applied
   - Verify revenue calculations correct

2. **Edge Case Workflows**
   - Toggle active status mid-month
   - Change maximum after carryover generated
   - Multiple time tracking system entries for same project

---

### 7. Additional Recommendations

#### Documentation Gaps

1. **Carryover Stacking Confirmation**: The plan asks about stacking behavior but does not document the final decision. Add a clear statement:

```markdown
**Decision (2026-01-24)**: Carryover stacks. When carryover from Month A cascades to Month B,
and Month B also exceeds its maximum, both Month A's carryover and Month B's excess carry to Month C.
```

2. **Billing Order of Operations**: Document the exact calculation sequence:

```markdown
**Billing Calculation Order:**
1. Sum actual minutes per task
2. Apply per-task rounding (round up to increment)
3. Sum rounded minutes -> roundedHours
4. Add carryoverIn -> adjustedHours
5. Apply minimum (if isActive && adjustedHours < minimum)
6. Apply maximum (if adjustedHours > maximum)
7. Calculate carryoverOut or unbillableHours
8. billedHours * rate = revenue
```

#### Security Considerations

1. **Audit Log Access**: Ensure `billing_audit_log` is read-only for non-admin users via RLS.

2. **Carryover Manipulation**: Add RLS policy preventing direct writes to `project_carryover_hours` except via admin or the calculation RPC.

3. **Rate Visibility**: If rate information is sensitive, consider column-level security on billing tables.

#### Migration Rollback Plan

Add rollback SQL for the migration:

```sql
-- 028_create_billing_rules_rollback.sql
DROP TABLE IF EXISTS billing_audit_log;
DROP TABLE IF EXISTS billing_month_status;
DROP TABLE IF EXISTS project_carryover_hours;
DROP TABLE IF EXISTS project_monthly_active_status;
DROP TABLE IF EXISTS project_monthly_billing_limits;
```

---

### 8. Implementation Priority Adjustments

Based on dependencies and risk, recommend the following implementation order:

| Phase | Priority | Rationale |
|-------|----------|-----------|
| 1. Database Schema | P0 | All other phases depend on this |
| 2. TypeScript Types | P0 | Types must exist before hooks/utils |
| 3. Hooks (basic fetch) | P1 | UI needs data fetching before display |
| 4. Billing Calculation | P1 | Core logic, must be correct before UI integration |
| 5. UI Updates (display only) | P2 | Show data before enabling edits |
| 6. UI Updates (edit capability) | P3 | Enable user modifications |
| 7. CSV Export | P3 | Can ship later as enhancement |

---

### 9. Pre-Implementation Checklist Additions

Add to existing checklist:

- [ ] Create shared `useProjectMonthlyHistory` hook factory before individual history hooks
- [ ] Add `formatMonthDisplay` utility to consolidate date formatting
- [ ] Define `CarryoverSource` type with proper structure
- [ ] Add discriminated union for `BillingAdjustment` type
- [ ] Create database rollback script
- [ ] Document carryover stacking decision
- [ ] Create unit test file structure for `calculateBilledHours`
- [ ] Add RLS policies for audit log table
- [ ] Verify single RPC can return all billing fields (performance)

---

### 10. Summary of Required Changes

| Category | Change | Priority |
|----------|--------|----------|
| Types | Add discriminated union for billing adjustments | High |
| Types | Add `CarryoverSource` interface | High |
| DRY | Extract generic history hook factory | Medium |
| DRY | Consolidate date formatting utilities | Medium |
| DRY | Extract `HistoryTable` component | Medium |
| Error Handling | Add transaction wrapper for carryover calculation | High |
| Error Handling | Add database error message mapping | Medium |
| Performance | Ensure single RPC returns all billing data | High |
| Performance | Consider carryover aggregation view | Medium |
| Testing | Add unit tests for `calculateBilledHours` | Critical |
| Testing | Add integration tests for carryover chains | High |
| Security | Add RLS for audit log and carryover tables | High |
| Documentation | Finalize carryover stacking decision | Medium |
| Documentation | Document calculation order of operations | Medium |

---

### Approval

This implementation plan is **approved with the above recommendations**. The core architecture is solid, and the recommendations will enhance maintainability, type safety, and testability. Prioritize the "High" and "Critical" items before starting implementation.

**Recommended next steps:**
1. Address type safety issues (discriminated unions, `CarryoverSource`)
2. Create shared utility abstractions (hook factory, date formatting)
3. Begin Phase 1 (Database Schema) implementation
4. Write unit tests for `calculateBilledHours` in parallel with development

---

## Financial Audit Review

**Reviewer:** Financial Audit Specialist
**Date:** 2026-01-24
**Status:** Complete with Required Changes

---

### Executive Summary

The billing rules implementation plan demonstrates solid foundational architecture for financial calculations. However, several critical financial edge cases, calculation sequencing issues, and precision concerns require attention before implementation. This review identifies 4 critical issues, 6 high-priority concerns, and 8 recommendations for financial robustness.

---

### Critical Issues (Must Fix Before Implementation)

#### 1. Calculation Order Ambiguity: Minimum vs Maximum Application

**Location:** Phase 4, Calculation Flow

**Issue:** The current flow shows minimum and maximum applied in sequence, but the interaction is not precisely defined. Consider this scenario:

```
Actual hours worked: 5h
Carryover in: 0h
Minimum: 10h
Maximum: 8h
isActive: true
```

**Current ambiguous result:**
- After minimum: 10h (because isActive=true and 5h < 10h)
- After maximum: 8h (because 10h > 8h)
- Billed: 8h

**Financial Problem:** The client paid for a 10h minimum retainer, but the maximum overrides it. This creates a contradiction in billing intent.

**Required Resolution:** Add explicit business rule:
```typescript
// Option A: Minimum takes precedence (retainer protection)
billedHours = Math.max(adjustedHours, minimumHours); // Minimum first
// Maximum only applies when actual+carryover exceeds max, NOT minimum padding

// Option B: Maximum always caps (current implied behavior)
// Document that min > max configurations are logically invalid
// Database constraint already prevents this, but application should validate
```

**Recommendation:** The database constraint `chk_min_le_max` prevents min > max, which is correct. However, the calculation flow should explicitly document that:
1. Minimum is applied first (raises floor)
2. Maximum is applied second (caps ceiling)
3. Since min <= max is enforced, minimum-applied hours will never exceed maximum

---

#### 2. Carryover Stacking Creates Unbounded Liability

**Location:** DBA Review, Priority 3 - Carryover Chain Behavior

**Issue:** Option A (Stacking) can create unbounded carryover accumulation if a client consistently works over maximum.

**Scenario:**
```
October:  120h worked, 100h max -> 20h carries to November
November: 130h worked, 100h max -> 20 + 30 = 50h carries to December
December: 125h worked, 100h max -> 50 + 25 = 75h carries to January
January:  140h worked, 100h max -> 75 + 40 = 115h carries to February
...continues growing indefinitely
```

**Financial Risk:**
- Carryover becomes a hidden liability on your books
- Client may demand all carryover hours be applied eventually
- Creates audit complexity tracking multi-source carryover origins
- No natural mechanism to reduce the balance

**Required Resolution:** Implement carryover limits or expiration:

```sql
-- Add to project_monthly_billing_limits table
carryover_max_hours NUMERIC(10, 2) DEFAULT NULL,  -- Maximum carryover accumulation
carryover_expiry_months INTEGER DEFAULT NULL,     -- Months until carryover expires

CONSTRAINT chk_carryover_max_reasonable CHECK (carryover_max_hours IS NULL OR carryover_max_hours <= 744)
```

**Application Logic:**
```typescript
// Cap total carryover accumulation
const effectiveCarryover = carryoverMax !== null
  ? Math.min(totalCarryoverIn, carryoverMax)
  : totalCarryoverIn;

// Expire old carryover (FIFO - oldest first)
const validCarryoverRecords = carryoverRecords.filter(
  record => monthsDiff(record.source_month, currentMonth) <= carryoverExpiryMonths
);
```

**Minimum Recommendation:** If not implementing expiration, add `carryover_max_hours` constraint to prevent unbounded accumulation.

---

#### 3. Floating-Point Precision Risk in JavaScript

**Location:** Phase 4, `src/utils/billing.ts`

**Issue:** JavaScript's floating-point arithmetic can cause billing calculation errors.

**Example:**
```javascript
const hours = 0.1 + 0.2; // = 0.30000000000000004
const rate = 150.00;
const revenue = hours * rate; // = 45.00000000000001
```

**Financial Impact:** Small errors compound across many invoices. Over 10,000 invoices with $0.01 average error = $100 discrepancy.

**Required Resolution:** Use fixed-point arithmetic for all monetary calculations:

```typescript
// billing.ts - Add precision utilities
const DECIMAL_PLACES = 2;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

// All calculations must use these utilities
export function calculateBilledHours(...): BilledHoursResult {
  // Round at each calculation step, not just at the end
  const roundedHours = roundHours(actualMinutes / 60);
  const adjustedHours = roundHours(roundedHours + carryoverIn);

  let billedHours = adjustedHours;
  if (isActive && minimumHours !== null && adjustedHours < minimumHours) {
    billedHours = minimumHours;
  }
  if (maximumHours !== null && billedHours > maximumHours) {
    billedHours = maximumHours;
  }

  // Final revenue calculation
  const revenue = roundCurrency(billedHours * rate);

  return { ..., revenue };
}
```

**Database Alignment:** NUMERIC(10,2) in PostgreSQL handles decimal precision correctly. Ensure TypeScript calculations match this precision before storage.

---

#### 4. Missing Carryover Consumption Tracking

**Location:** Phase 4, BilledHoursResult interface

**Issue:** The interface tracks `carryoverOut` (excess hours generated) but not `carryoverConsumed` (carryover hours actually used in billing).

**Scenario:**
```
Carryover in: 15h (from October)
Actual hours: 25h
Minimum: 10h
Maximum: 30h

Adjusted hours: 25 + 15 = 40h
Billed hours: 30h (capped by max)
Carryover out: 10h

Question: Of the 30h billed, how much was carryover vs actual work?
```

**Financial Importance:**
- Client may want breakdown: "How much of my carryover was used?"
- Audit trail needs to show carryover consumption
- Revenue recognition may differ between actual work and carryover usage

**Required Resolution:** Add carryover consumption tracking:

```typescript
export interface BilledHoursResult {
  actualHours: number;
  roundedHours: number;
  carryoverIn: number;           // ADD: Input carryover amount
  carryoverConsumed: number;     // ADD: How much carryover was used
  adjustedHours: number;
  billedHours: number;
  carryoverOut: number;
  unbillableHours: number;
  minimumApplied: boolean;
  maximumApplied: boolean;
  minimumPadding: number;        // ADD: Hours added due to minimum (billedHours - adjustedHours when min applied)
}
```

**Calculation Logic (FIFO - use carryover before new hours):**
```typescript
// When max applied, determine carryover consumption
if (maximumApplied) {
  // Use carryover first, then actual hours
  carryoverConsumed = Math.min(carryoverIn, billedHours);
  actualHoursBilled = billedHours - carryoverConsumed;
} else {
  // All carryover consumed, all actual hours used
  carryoverConsumed = carryoverIn;
}
```

---

### High-Priority Concerns

#### 5. Zero and Negative Value Handling

**Location:** Database constraints, calculation logic

**Current State:** Database has `chk_min_non_negative` and `chk_max_non_negative` constraints.

**Missing Validations:**

| Scenario | Current Handling | Required Handling |
|----------|-----------------|-------------------|
| Rate = $0 | Not validated | Warn or block - zero rate means zero revenue regardless of hours |
| Actual hours = 0 | Allowed | If minimum applies and isActive, bill minimum hours |
| Carryover = negative | Prevented by DB | Add application-level validation with user-friendly error |
| Minutes < 0 | Not validated | Prevent negative time entries at source |

**Recommendation:** Add explicit zero-value handling in calculation:
```typescript
if (rate === 0) {
  console.warn(`Project ${projectId}: Zero rate configured, revenue will be $0`);
}

if (actualMinutes === 0 && carryoverIn === 0) {
  if (isActive && minimumHours !== null && minimumHours > 0) {
    // Bill minimum even with no work (retainer behavior)
    billedHours = minimumHours;
    minimumApplied = true;
  } else {
    // No billing this month
    billedHours = 0;
  }
}
```

---

#### 6. Rounding Increment Interaction with Minimums

**Location:** Phase 4, Calculation Flow

**Issue:** Per-task rounding happens BEFORE minimum/maximum application, but the minimum might not align with rounding increments.

**Scenario:**
```
Rounding increment: 15 minutes (0.25 hours)
Task 1: 7 minutes -> 15 minutes (0.25h)
Task 2: 8 minutes -> 15 minutes (0.25h)
Total rounded: 0.50 hours
Minimum: 1 hour

Billed: 1 hour (minimum applied)
```

**Question:** Is 1.00 hour a valid billing amount, or should it be adjusted to the nearest rounding increment?

**Recommendation:** Document the business rule:
- Minimums and maximums are NOT subject to rounding increments
- They represent exact contractual values
- Add clarifying comment in code

---

#### 7. Audit Log Missing Critical Fields

**Location:** Table 5, billing_audit_log

**Current Fields:** table_name, record_id, action, old_data, new_data, changed_by, changed_at

**Missing Financial Audit Fields:**

```sql
ALTER TABLE billing_audit_log ADD COLUMN (
    -- Transaction context
    billing_month DATE,              -- Which billing period affected
    project_id UUID,                 -- Denormalized for faster queries

    -- Change impact
    hours_impact NUMERIC(10, 2),     -- Net change in billed hours
    revenue_impact NUMERIC(12, 2),   -- Net change in revenue (estimated)

    -- Approval tracking
    requires_approval BOOLEAN DEFAULT false,
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,

    -- Reason codes for common adjustments
    adjustment_reason TEXT CHECK (adjustment_reason IN (
        'rate_change', 'time_correction', 'carryover_adjustment',
        'minimum_override', 'maximum_override', 'write_off',
        'client_dispute', 'system_recalculation', 'manual_correction'
    ))
);
```

---

#### 8. Month Boundary Edge Cases

**Location:** Not addressed in current plan

**Issue:** Time entries near month boundaries can be assigned to wrong billing period.

**Scenarios to handle:**

| Scenario | Example | Resolution Required |
|----------|---------|-------------------|
| Entry at midnight | 2026-01-31 23:30 - 2026-02-01 00:30 | Split across months or assign to start date |
| Timezone differences | UTC vs local time | Define authoritative timezone for billing |
| Late entries | Entry for January added in February | Allow with warning, include in correct month |
| Retroactive edits | January entry edited after month closed | Require month reopen, log adjustment |

**Recommendation:** Add to billing logic:
```typescript
function getBillingMonth(entry: TimeEntry): Date {
  // Use entry start time in project's configured timezone
  const entryDate = parseInTimezone(entry.start_time, project.billing_timezone);
  return startOfMonth(entryDate);
}
```

---

#### 9. Partial Payment and Credit Note Handling

**Location:** Not addressed in current plan

**Issue:** The plan covers hour-based billing but not payment application or adjustments.

**Missing Scenarios:**
- Partial payment received (client pays $500 of $1000 invoice)
- Credit note issued (reduce billed amount after invoice)
- Early payment discount (2% if paid within 10 days)
- Late payment penalty (not explicitly mentioned)

**Recommendation for Future Phase:** Add payment tracking or note integration requirement:
```typescript
export interface BillingMonthSummary {
  // Current fields
  totalBilledHours: number;
  totalRevenue: number;

  // Future: Payment tracking
  invoicedAmount: number;
  paymentsReceived: number;
  creditsApplied: number;
  balanceDue: number;

  // Future: Adjustments
  adjustments: BillingAdjustment[];
}
```

---

#### 10. Multi-Rate Project Scenario

**Location:** Not addressed in current plan

**Issue:** If a project has multiple billing rates (e.g., different rates per employee, or rate changes mid-month), how do minimums and maximums apply?

**Scenario:**
```
Project X, January 2026:
- Employee A: 20h at $100/hr = $2,000
- Employee B: 15h at $150/hr = $2,250
- Total: 35h, $4,250

Minimum: 40h (at what rate?)
Maximum: 50h
```

**Questions:**
1. Is minimum/maximum based on total hours across all rates?
2. If minimum applies (35h < 40h), which rate applies to the 5h padding?
3. Should minimum/maximum be per-rate or per-project?

**Recommendation:** Document assumption:
- Minimum and maximum apply to project-level total hours
- Use the project's base rate (from project settings) for minimum padding calculations
- If no base rate, use weighted average or require configuration

---

### Calculation Verification

#### Verified Correct

1. **NUMERIC(10,2) precision** - Appropriate for hours (max 99,999,999.99 hours, far exceeds 744-hour limit)
2. **744-hour maximum constraint** - Correct (31 days x 24 hours = 744)
3. **min <= max constraint** - Correctly prevents contradictory configurations
4. **Carryover source < target constraint** - Prevents circular carryover references
5. **First-of-month date constraints** - Ensures consistent monthly bucketing

#### Requires Clarification

| Calculation | Current State | Question |
|-------------|---------------|----------|
| Carryover aggregation | SUM of all source months | Confirm: Use simple sum or apply FIFO consumption? |
| Revenue = Billed x Rate | Implied but not shown | Confirm: Revenue calculated per-employee or per-project? |
| Unbillable = Excess - Carryover | Implied | Confirm: Unbillable only when carryover disabled? |

---

### Missing Financial Scenarios

#### Scenarios Not Currently Addressed

1. **Write-off Handling** - How to mark hours as unbillable for business reasons (not just max exceeded)

2. **Disputed Hours** - Client disputes 5h of 40h billed; how to record and resolve

3. **Pro-rated Minimums** - New project starts mid-month; should minimum be prorated?
   ```
   Project starts January 15
   Minimum: 40h/month
   Pro-rated minimum: 40h x (17/31) = 21.9h
   ```

4. **Rate Changes During Period** - Rate increases mid-month; which rate for minimum padding?

5. **Carryover Forfeiture** - Client terminates project; what happens to accumulated carryover?

6. **Inter-Project Carryover** - Can excess from Project A apply to Project B (same client)?

7. **Billing Hold** - Client requests invoicing pause; hours accrue but don't bill

8. **Prepaid Hours** - Client prepays for 100 hours; draw-down tracking needed

---

### Recommendations Summary

| Priority | Recommendation | Impact |
|----------|---------------|--------|
| Critical | Document minimum vs maximum application order explicitly | Prevents billing disputes |
| Critical | Add carryover maximum or expiration mechanism | Prevents unbounded liability |
| Critical | Implement fixed-point arithmetic utilities in TypeScript | Ensures calculation accuracy |
| Critical | Add carryoverConsumed and minimumPadding to result interface | Enables complete audit trail |
| High | Add zero-rate and zero-hours validation with business logic | Prevents unexpected $0 invoices |
| High | Document rounding increment vs minimum/maximum interaction | Clarifies billing behavior |
| High | Enhance audit log with billing context fields | Improves audit capability |
| High | Define timezone handling for month boundaries | Prevents misallocated entries |
| Medium | Add write-off capability for business adjustments | Enables non-technical adjustments |
| Medium | Document multi-rate project handling | Clarifies complex scenarios |
| Low | Consider prorated minimums for partial months | Improves fairness for new projects |
| Low | Plan for future payment tracking integration | Enables complete AR management |

---

### Verification Plan Additions

Add to existing Verification Plan:

16. **Precision Test:** Calculate 0.1 + 0.2 hours and verify result is exactly 0.30, not 0.30000000000000004
17. **Zero Hours + Minimum:** Verify billing when actual=0, carryover=0, minimum=10, isActive=true produces billed=10
18. **Carryover Stacking Limit:** If implementing carryover max, verify accumulation stops at limit
19. **Minimum Padding Tracking:** Verify billedHours - (roundedHours + carryoverIn) equals minimumPadding when minimum applied
20. **Carryover Consumption FIFO:** Verify oldest carryover is consumed first when maximum applied
21. **Multi-Source Carryover:** Verify SUM of carryover from multiple source months works correctly
22. **Audit Log Completeness:** Verify all billing-affecting changes create audit records with old/new values

---

### Conclusion

The billing rules implementation plan provides a solid foundation with good database design and constraint handling. The critical issues identified primarily relate to:

1. **Calculation precision and ordering** - Solvable with explicit documentation and utility functions
2. **Unbounded carryover liability** - Requires business decision on limits/expiration
3. **Audit trail completeness** - Requires additional tracking fields

The plan is **approved for implementation** with the condition that Critical Issues 1-4 are addressed before production deployment. High-priority concerns should be addressed in the initial release where possible, with documentation for any deferred items.

**Estimated Financial Risk if Issues Not Addressed:**
- Calculation precision errors: $0.01-$1.00 per invoice (compounds over volume)
- Unbounded carryover: Potentially thousands of dollars in hidden liability
- Missing carryover consumption tracking: Audit failures, client disputes

---

### Sign-Off

**Financial Audit Review:** Complete
**Reviewer:** Financial Audit Specialist
**Date:** 2026-01-24
**Recommendation:** Approved with Required Changes (Critical Issues 1-4)
