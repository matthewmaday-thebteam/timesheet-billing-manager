# Task 022 Implementation: Employee Rate & Expected Hours Enhancements

**Implemented:** 2026-01-15
**Status:** DEPLOYED

**Production URL:** https://timesheet-billing-manager.vercel.app

---

## Summary

Added billing mode support (monthly vs hourly), expected hours tracking, and hourly rate fields to the employee/resource management system. This enables accurate profitability calculations for part-time employees and contractors who bill hourly.

---

## Changes Made

### 1. Database Migration

**File:** `supabase/migrations/013_add_billing_mode_expected_hours_hourly_rate.sql`

Added three new columns to the `resources` table:

```sql
billing_mode TEXT DEFAULT 'monthly' NOT NULL CHECK (billing_mode IN ('monthly', 'hourly'))
expected_hours DECIMAL(5,2) DEFAULT NULL
hourly_rate DECIMAL(10,2) DEFAULT NULL
```

**Constraints:**
- `chk_billing_mode_values` - Ensures billing_mode is 'monthly' or 'hourly'
- `chk_hourly_requires_rate` - Hourly billing requires hourly_rate to be set
- `chk_hourly_no_monthly_data` - Hourly billing clears monthly_cost and expected_hours

**Index:**
- `idx_resources_billing_mode` - For filtering by billing mode

---

### 2. TypeScript Types

**File:** `src/types/index.ts`

```typescript
// Added
export type BillingMode = 'monthly' | 'hourly';

// Updated Resource interface
export interface Resource {
  // ... existing fields
  billing_mode: BillingMode;
  expected_hours: number | null;
  hourly_rate: number | null;
  // ...
}

// Updated ResourceFormData interface
export interface ResourceFormData {
  // ... existing fields
  billing_mode: BillingMode;
  expected_hours: number | null;
  hourly_rate: number | null;
  // ...
}
```

---

### 3. Billing Utilities

**File:** `src/utils/billing.ts`

Added employee billing functions:

```typescript
export const DEFAULT_EXPECTED_HOURS = 160;

export function getEffectiveHourlyRate(
  billingMode: BillingMode,
  hourlyRate: number | null,
  monthlyCost: number | null,
  expectedHours: number | null
): number | null;

export function formatHours(value: number | null): string;
```

---

### 4. ResourceTable Component

**File:** `src/components/ResourceTable.tsx`

**Removed:**
- Teams Account column

**Added:**
- Expected Hours column
- Hourly Rate column

**Column Order:**
```
System ID | Name | Email | Type | Expected Hours | Monthly Cost | Hourly Rate | Status
```

**Display Logic:**
| Billing Mode | Expected Hours | Monthly Cost | Hourly Rate |
|--------------|----------------|--------------|-------------|
| monthly | Value (or 160) | $X,XXX.XX | Calculated (lighter color) |
| hourly | — | — | Actual rate (normal color) |

**Token Usage:**
- Actual hourly rate: `text-vercel-gray-600`
- Calculated rate: `text-vercel-gray-300`
- Currency values: `font-mono`

---

### 5. EmployeeEditorModal Component

**File:** `src/components/EmployeeEditorModal.tsx`

**New Fields:**
1. **Billing Mode** - Select dropdown (Monthly / Hourly)
2. **Expected Hours** - Number input (disabled for hourly)
3. **Hourly Rate** - Currency input (disabled for monthly)

**Billing Mode Switch Behavior:**
- Switch to Hourly: Clears monthly_cost, expected_hours
- Switch to Monthly: Clears hourly_rate, sets expected_hours to 160

**Validation:**
- Monthly mode: expected_hours must be > 0 if set
- Hourly mode: hourly_rate is required and must be > 0

**Token Usage:**
- Labels: `text-xs font-medium text-vercel-gray-400 uppercase tracking-wider`
- Enabled inputs: `bg-white text-vercel-gray-600 border-vercel-gray-100`
- Disabled inputs: `bg-vercel-gray-50 text-vercel-gray-200 cursor-not-allowed`
- Error text: `text-bteam-brand`

---

### 6. useResources Hook

**File:** `src/hooks/useResources.ts`

Updated `updateResource` function to handle new fields:
- billing_mode
- expected_hours
- hourly_rate

Both optimistic update and database update now include the new fields.

---

## Design System Compliance

### Components Used
- `Select` - For billing mode dropdown
- `Input` - For text fields
- `Modal` - For editor modal wrapper
- `Badge` - For status indicators
- `Button` - For save/cancel actions

### Color Tokens Used
| Token | Usage |
|-------|-------|
| `text-vercel-gray-600` | Primary text, actual hourly rate |
| `text-vercel-gray-400` | Secondary text, labels |
| `text-vercel-gray-300` | Calculated rates, placeholders |
| `text-vercel-gray-200` | Disabled text |
| `bg-vercel-gray-50` | Disabled backgrounds |
| `border-vercel-gray-100` | Default borders |
| `text-bteam-brand` | Error messages |

### Typography Tokens Used
| Style | Classes |
|-------|---------|
| label-form | `text-xs font-medium text-vercel-gray-400 uppercase tracking-wider` |
| body-sm | `text-sm text-vercel-gray-600` |
| mono-sm | `text-sm font-mono text-vercel-gray-400` |

---

## Files Modified

| File | Type | Changes |
|------|------|---------|
| `supabase/migrations/013_*.sql` | New | Database migration |
| `src/types/index.ts` | Modified | Added BillingMode, updated interfaces |
| `src/utils/billing.ts` | Modified | Added employee billing utilities |
| `src/components/ResourceTable.tsx` | Modified | Removed Teams Account, added new columns |
| `src/components/EmployeeEditorModal.tsx` | Modified | Added billing mode, expected hours, hourly rate fields |
| `src/hooks/useResources.ts` | Modified | Handle new fields in CRUD |

---

## Business Logic

### Effective Hourly Rate Calculation

```typescript
if (billing_mode === 'hourly') {
  return hourly_rate;
} else {
  const hours = expected_hours ?? 160;
  return monthly_cost / hours;
}
```

### Default Values

| Field | Default |
|-------|---------|
| billing_mode | 'monthly' |
| expected_hours | NULL (treated as 160 in calculations) |
| hourly_rate | NULL |
| monthly_cost | NULL |

---

## Deployment Steps

1. Run database migration:
   ```bash
   # Apply via Supabase dashboard or CLI
   psql -f supabase/migrations/013_add_billing_mode_expected_hours_hourly_rate.sql
   ```

2. Verify TypeScript:
   ```bash
   npx tsc --noEmit
   ```

3. Deploy to Vercel:
   ```bash
   vercel --prod
   ```

---

## Testing Checklist

- [ ] New employees default to monthly billing
- [ ] Existing employees retain monthly billing
- [ ] Switching to hourly clears monthly fields
- [ ] Switching to monthly clears hourly fields and sets expected_hours to 160
- [ ] Hourly rate required validation works
- [ ] Expected hours > 0 validation works
- [ ] Table displays calculated rate in lighter color
- [ ] Table displays actual rate in normal color
- [ ] Cancel/Close discards unsaved changes
- [ ] Save commits all changes

---

## Code Review (2026-01-15)

**Reviewer:** react-nextjs-reviewer

### Issues Found & Fixed

| Priority | Issue | Status |
|----------|-------|--------|
| Critical | `formatCurrency(null)` would display `$NaN` | **FIXED** - Updated to handle null values |
| Medium | Raw inputs instead of design system Input | **FIXED** - Added `getNumberInputClasses` helper |
| Medium | Inconsistent focus ring styling (`focus:ring-1` vs `focus:ring-2`) | **FIXED** - Updated to `focus:ring-2` |

### Changes Made After Review

1. **`src/utils/billing.ts`** - Updated `formatCurrency` signature to `(amount: number | null | undefined): string`
2. **`src/components/EmployeeEditorModal.tsx`** - Added `getNumberInputClasses` helper function for consistent styling

### Acknowledged (Not Fixed)

| Priority | Issue | Notes |
|----------|-------|-------|
| Low | Form state reset could use key prop | Current pattern works, deferring refactor |
| Low | Missing monthly_cost validation | Null monthly_cost is acceptable (cost not entered yet) |

### Good Practices Noted

- Clean type definitions
- Proper utility function design with edge case handling
- Design system token compliance (no hex codes)
- Optimistic updates with proper rollback
- Well-structured database migration
