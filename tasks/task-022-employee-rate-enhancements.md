# Task 022: Employee Rate & Expected Hours Enhancements

**Status:** COMPLETE (Deployed 2026-01-15)

**Priority:** Medium - Enables accurate profitability calculations for all employee types

**Reviewed by:** elite-code-architect, database-architect (2026-01-15)

---

## 1. Problem Statement

Currently, all employees are listed at their monthly cost. When calculating profitability, the system divides monthly cost by hours committed to timesheets. This approach has limitations:

1. **Full-time assumption**: The calculation assumes all employees work full-time hours (typically 160-176 hours/month). Part-time employees are not accurately reflected.
2. **Contractor/Vendor billing**: Contractors and vendors often bill hourly, not monthly. The current schema only supports monthly cost.
3. **UI clutter**: The Teams Account column is shown in the table but is secondary information that clutters the view.

---

## 2. Clarifications (Resolved)

| Question | Answer |
|----------|--------|
| Expected hours default | NULL defaults to **160** (full-time) in application logic |
| Employment types | "Contractor" and "Vendor" **already exist** in `employment_types` table |
| Hourly Rate column | **Always show** in table |
| Modal behavior | All fields shown. Changes only saved on "Save" button. Cancel/close discards changes. |
| Billing mode switching | When switching modes, **clear opposite fields** |
| Effective Rate display | For monthly employees: show `monthly_cost / expected_hours` |

---

## 3. Database Schema Changes

### New Columns on `resources` Table

```sql
billing_mode TEXT DEFAULT 'monthly' NOT NULL CHECK (billing_mode IN ('monthly', 'hourly'))
expected_hours DECIMAL(5,2) DEFAULT NULL
hourly_rate DECIMAL(10,2) DEFAULT NULL
```

### Constraints (Database-Level Enforcement)

```sql
-- Hourly billing requires hourly_rate
CONSTRAINT chk_hourly_requires_rate
CHECK (billing_mode != 'hourly' OR hourly_rate IS NOT NULL)

-- Hourly billing should not have monthly-specific fields
CONSTRAINT chk_hourly_no_monthly_data
CHECK (billing_mode != 'hourly' OR (monthly_cost IS NULL AND expected_hours IS NULL))
```

### Migration File

`supabase/migrations/013_add_billing_mode_expected_hours_hourly_rate.sql`

See Section 10 for full migration SQL.

---

## 4. TypeScript Type Changes

### Update `src/types/index.ts`

```typescript
export type BillingMode = 'monthly' | 'hourly';

export interface Resource {
  id: string;
  user_id: string | null;
  external_label: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  teams_account: string | null;
  employment_type_id: string;
  employment_type?: EmploymentType;
  billing_mode: BillingMode;           // NEW
  expected_hours: number | null;        // NEW
  hourly_rate: number | null;           // NEW
  monthly_cost: number | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceFormData {
  first_name: string;
  last_name: string;
  email: string;
  teams_account: string;
  employment_type_id: string;
  billing_mode: BillingMode;           // NEW
  expected_hours: number | null;        // NEW
  hourly_rate: number | null;           // NEW
  monthly_cost: number | null;
}
```

---

## 5. UI Changes - Design System Compliance

### CRITICAL: Use Existing Atoms/Tokens Only

All UI changes MUST use the existing design system components and color tokens. **No hex codes, no arbitrary Tailwind values.**

### Available Components to Use

| Component | File | Usage |
|-----------|------|-------|
| `Input` | `src/components/Input.tsx` | Text/number inputs with label, error, helperText |
| `Select` | `src/components/Select.tsx` | Dropdown for billing mode selection |
| `Toggle` | `src/components/Toggle.tsx` | Alternative for billing mode (if preferred) |
| `Button` | `src/components/Button.tsx` | Save/Cancel buttons |
| `Badge` | `src/components/Badge.tsx` | Status indicators |
| `Modal` | `src/components/Modal.tsx` | Editor modal wrapper |

### Typography Tokens to Use

| Style | Classes | Usage |
|-------|---------|-------|
| `label-form` | `text-xs font-medium text-vercel-gray-400 uppercase tracking-wider` | Form field labels |
| `body-sm` | `text-sm text-vercel-gray-600` | Table cells, form values |
| `mono-sm` | `text-sm font-mono text-vercel-gray-400` | Currency values, IDs |
| `body-xs` | `text-xs text-vercel-gray-400` | Helper text, captions |

### Color Tokens (from tailwind.config.js)

| Token | Usage |
|-------|-------|
| `text-vercel-gray-600` | Primary text |
| `text-vercel-gray-400` | Secondary text, labels |
| `text-vercel-gray-300` | Placeholder, hints |
| `text-vercel-gray-200` | Disabled text |
| `border-vercel-gray-100` | Default borders |
| `bg-vercel-gray-50` | Disabled backgrounds |

---

## 6. Component Changes

### 6.1 ResourceTable.tsx

**Remove:**
- Teams Account column

**Add:**
- Expected Hours column
- Hourly Rate column (always visible)

**Column Order:**
```
System ID | Name | Email | Type | Expected Hours | Monthly Cost | Hourly Rate | Status
```

**Display Logic:**

| Billing Mode | Expected Hours | Monthly Cost | Hourly Rate |
|--------------|----------------|--------------|-------------|
| `monthly` | Value (or 160 if null) | $X,XXX.XX | $XX.XX (calculated: monthly/hours) |
| `hourly` | — | — | $XX.XX (actual rate) |

**Calculated Rate Styling:**
- Use `text-vercel-gray-300` for calculated rates to distinguish from actual rates
- Actual rates use `text-vercel-gray-400` (standard mono-sm)

**Code Pattern for Hourly Rate Cell:**
```tsx
<td className="px-4 py-3 text-right">
  {resource.billing_mode === 'hourly' ? (
    <span className="text-sm text-vercel-gray-600 font-mono">
      ${resource.hourly_rate?.toFixed(2)}
    </span>
  ) : (
    <span className="text-sm text-vercel-gray-300 font-mono">
      {resource.monthly_cost && (resource.expected_hours || 160) > 0
        ? `$${(resource.monthly_cost / (resource.expected_hours || 160)).toFixed(2)}`
        : '—'}
    </span>
  )}
</td>
```

### 6.2 EmployeeEditorModal.tsx

**New Fields to Add:**

1. **Billing Mode** - Use `<Select>` component
   - Options: `[{ value: 'monthly', label: 'Monthly' }, { value: 'hourly', label: 'Hourly' }]`
   - Place after Employment Type field

2. **Expected Hours** - Use existing Input pattern
   - Label: "Expected Hours"
   - Type: number, step="0.01", min="0"
   - Disabled when `billing_mode === 'hourly'`
   - Placeholder: "160"

3. **Hourly Rate** - Use existing currency input pattern (match Monthly Cost)
   - Label: "Hourly Rate"
   - Type: number, step="0.01", min="0"
   - Disabled when `billing_mode === 'monthly'`
   - With $ prefix

**Field Visibility (All Always Shown, Some Disabled):**

| Field | Monthly Mode | Hourly Mode |
|-------|--------------|-------------|
| Billing Mode | Enabled | Enabled |
| Expected Hours | Enabled | **Disabled** |
| Monthly Cost | Enabled | **Disabled** |
| Hourly Rate | **Disabled** | Enabled |

**Billing Mode Switch Behavior:**
```typescript
const handleBillingModeChange = (newMode: BillingMode) => {
  if (newMode === 'hourly') {
    // Clear monthly-specific fields
    setFormData(prev => ({
      ...prev,
      billing_mode: 'hourly',
      monthly_cost: null,
      expected_hours: null,
    }));
  } else {
    // Clear hourly field, set default expected hours
    setFormData(prev => ({
      ...prev,
      billing_mode: 'monthly',
      hourly_rate: null,
      expected_hours: 160,
    }));
  }
};
```

**Validation Updates:**
```typescript
interface FormErrors {
  email?: string;
  expected_hours?: string;
  monthly_cost?: string;
  hourly_rate?: string;
}

const validateForm = (): boolean => {
  const newErrors: FormErrors = {};

  // Email validation (existing)
  if (formData.email && !validateEmail(formData.email)) {
    newErrors.email = 'Please enter a valid email address';
  }

  // Billing mode specific validation
  if (formData.billing_mode === 'monthly') {
    if (formData.expected_hours !== null && formData.expected_hours <= 0) {
      newErrors.expected_hours = 'Expected hours must be greater than 0';
    }
  } else {
    if (formData.hourly_rate === null || formData.hourly_rate <= 0) {
      newErrors.hourly_rate = 'Hourly rate is required and must be greater than 0';
    }
  }

  setErrors(newErrors);
  return Object.keys(newErrors).length === 0;
};
```

---

## 7. Utility Functions

### Create `src/utils/billing.ts`

```typescript
export const DEFAULT_EXPECTED_HOURS = 160;

export type BillingMode = 'monthly' | 'hourly';

/**
 * Calculate effective hourly rate for a resource
 * Returns actual hourly_rate for hourly billing, or calculated rate for monthly
 */
export function getEffectiveHourlyRate(
  billingMode: BillingMode,
  hourlyRate: number | null,
  monthlyCost: number | null,
  expectedHours: number | null
): number | null {
  if (billingMode === 'hourly') {
    return hourlyRate;
  }

  const hours = expectedHours ?? DEFAULT_EXPECTED_HOURS;
  if (hours <= 0 || monthlyCost == null) {
    return null;
  }

  return monthlyCost / hours;
}

/**
 * Format currency value for display
 */
export function formatCurrency(value: number | null): string {
  if (value == null) return '—';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
```

---

## 8. Acceptance Criteria

### Database
- [ ] Migration adds `billing_mode`, `expected_hours`, and `hourly_rate` columns
- [ ] Existing data defaults to `billing_mode = 'monthly'`
- [ ] Constraints enforce data integrity at database level
- [ ] n8n auto-created resources work correctly

### TypeScript
- [ ] `BillingMode` type alias created
- [ ] `Resource` and `ResourceFormData` interfaces updated
- [ ] No TypeScript errors (`npx tsc --noEmit` passes)

### Table (ResourceTable)
- [ ] Teams Account column removed
- [ ] Expected Hours column shows value or "—" (uses `body-sm` or `mono-sm`)
- [ ] Monthly Cost shows value or "—" (uses `mono-sm`)
- [ ] Hourly Rate column shows:
  - Actual rate for hourly billing (`mono-sm`, `text-vercel-gray-400`)
  - Calculated rate for monthly billing (`mono-sm`, `text-vercel-gray-300`)

### Modal (EmployeeEditorModal)
- [ ] Uses existing `<Select>` component for Billing Mode
- [ ] Uses existing `<Input>` component for Expected Hours
- [ ] Uses existing currency input pattern for Hourly Rate
- [ ] All labels use `label-form` typography (`text-xs font-medium text-vercel-gray-400 uppercase tracking-wider`)
- [ ] Disabled fields show disabled state correctly (`bg-vercel-gray-50`, `text-vercel-gray-200`)
- [ ] Switching billing mode clears opposite fields
- [ ] Cancel/Close discards unsaved changes
- [ ] Save commits all changes

### Design System Compliance
- [ ] **NO hex color codes** in new code
- [ ] **NO arbitrary Tailwind values** (no `text-[#xxx]`, no `w-[123px]`)
- [ ] All colors use token classes (`vercel-gray-*`, `error`, `warning`, `success`)
- [ ] All typography matches existing patterns

---

## 9. Files to Modify

| File | Changes |
|------|---------|
| `supabase/migrations/013_*.sql` | New migration file |
| `src/types/index.ts` | Add `BillingMode`, update `Resource`, `ResourceFormData` |
| `src/utils/billing.ts` | New utility file |
| `src/components/ResourceTable.tsx` | Remove Teams Account, add Expected Hours + Hourly Rate columns |
| `src/components/EmployeeEditorModal.tsx` | Add Billing Mode, Expected Hours, Hourly Rate fields |
| `src/hooks/useResources.ts` | Handle new fields in CRUD operations |

---

## 10. Migration SQL

```sql
-- ============================================================================
-- 013: Add Billing Mode, Expected Hours, and Hourly Rate to Resources
-- Enables accurate cost tracking for contractors and part-time employees
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add new columns with safe defaults
-- ============================================================================

ALTER TABLE resources
ADD COLUMN IF NOT EXISTS billing_mode TEXT DEFAULT 'monthly';

ALTER TABLE resources
ADD COLUMN IF NOT EXISTS expected_hours DECIMAL(5,2) DEFAULT NULL;

ALTER TABLE resources
ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2) DEFAULT NULL;

-- ============================================================================
-- STEP 2: Backfill existing data
-- ============================================================================

UPDATE resources
SET billing_mode = 'monthly'
WHERE billing_mode IS NULL;

-- ============================================================================
-- STEP 3: Add constraints
-- ============================================================================

ALTER TABLE resources
ADD CONSTRAINT chk_billing_mode_values
CHECK (billing_mode IN ('monthly', 'hourly'));

ALTER TABLE resources
ALTER COLUMN billing_mode SET NOT NULL;

ALTER TABLE resources
ADD CONSTRAINT chk_hourly_requires_rate
CHECK (billing_mode != 'hourly' OR hourly_rate IS NOT NULL);

ALTER TABLE resources
ADD CONSTRAINT chk_hourly_no_monthly_data
CHECK (billing_mode != 'hourly' OR (monthly_cost IS NULL AND expected_hours IS NULL));

-- ============================================================================
-- STEP 4: Add documentation
-- ============================================================================

COMMENT ON COLUMN resources.billing_mode IS
    'Cost calculation mode: "monthly" uses monthly_cost/expected_hours, "hourly" uses hourly_rate';

COMMENT ON COLUMN resources.expected_hours IS
    'Expected monthly hours. NULL defaults to 160 (full-time) in application logic.';

COMMENT ON COLUMN resources.hourly_rate IS
    'Hourly billing rate. Only applicable when billing_mode = "hourly".';

-- ============================================================================
-- STEP 5: Create index (optional, for filtering)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_resources_billing_mode
ON resources(billing_mode);

-- ============================================================================
-- Migration report
-- ============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_monthly INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM resources;
    SELECT COUNT(*) INTO v_monthly FROM resources WHERE billing_mode = 'monthly';

    RAISE NOTICE '013 migration complete:';
    RAISE NOTICE '  - Total resources: %', v_total;
    RAISE NOTICE '  - Monthly billing: %', v_monthly;
    RAISE NOTICE '  - New columns: billing_mode, expected_hours, hourly_rate';
END $$;

COMMIT;
```

---

## 11. Deployment Checklist

- [ ] Run database migration (`013_add_billing_mode_expected_hours_hourly_rate.sql`)
- [ ] Verify migration success in Supabase dashboard
- [ ] Verify TypeScript passes (`npx tsc --noEmit`)
- [ ] Deploy to Vercel production (`vercel --prod`)
- [ ] Test employee edit modal with both billing modes
- [ ] Verify table displays correctly for all employee types

---

## 12. Architect Review Notes

### Elite Code Architect Findings

**Architecture: APPROVED**
- Explicit `billing_mode` field is correct (vs. deriving from populated fields)
- Provides clear intent, simpler validation, future flexibility

**Priority Recommendations:**
| Priority | Item |
|----------|------|
| High | Conditional validation in modal (required fields based on billing mode) |
| High | Handle division by zero when calculating effective rate |
| Medium | Visual distinction between actual vs calculated hourly rates |
| Low | Consider extracting `CurrencyInput` component (deferred) |

### Database Architect Findings

**Schema: APPROVED**
- Column types appropriate
- TEXT + CHECK constraint is correct pattern for `billing_mode`
- Constraints provide database-level enforcement

**n8n Compatibility: VERIFIED**
- Auto-created resources will work (default to monthly billing)
- No function updates required

---

## 13. Implementation Notes

**Implementation Date:** 2026-01-15

### Files Created/Modified

| File | Status | Description |
|------|--------|-------------|
| `supabase/migrations/013_add_billing_mode_expected_hours_hourly_rate.sql` | Created | Database migration |
| `src/types/index.ts` | Modified | Added BillingMode type, updated Resource & ResourceFormData |
| `src/utils/billing.ts` | Modified | Added getEffectiveHourlyRate, formatHours utilities |
| `src/components/ResourceTable.tsx` | Modified | Removed Teams Account, added Expected Hours & Hourly Rate columns |
| `src/components/EmployeeEditorModal.tsx` | Modified | Added Billing Mode, Expected Hours, Hourly Rate fields |
| `src/hooks/useResources.ts` | Modified | Added new fields to optimistic update and database update |
| `tasks/implementation/task-022-employee-rate-enhancements.md` | Created | Serialized implementation documentation |

### TypeScript Validation

```
npx tsc --noEmit
Exit code: 0 (No errors)
```

### Next Steps

1. Run database migration in Supabase
2. Deploy to Vercel production (`vercel --prod`)
3. Test employee edit modal with both billing modes
4. Verify table displays correctly for all employee types
