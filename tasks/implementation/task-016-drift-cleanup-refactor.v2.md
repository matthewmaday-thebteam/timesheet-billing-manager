# Task 016: Style Drift Cleanup & Component Refactoring

**Status:** PENDING

**Depends on:** Task 015 (Component Promotion)

**Priority:** Medium - Consolidates all UI to use design system

---

## 0. v2 Amendments (January 11, 2026)

This task is updated to prioritize **Atomic Consistency** during refactoring:

- **Duplicate Atom Consolidation:** Replace multiple “Button-like” components with a single `Button` plus variants; produce a **Duplicate Atom Map** (intent → components → usage → locations) before changes.
- **Molecule Rebuild Priority:** Molecules that use raw HTML Atoms (raw `<button>`, `<input>`) are **high-priority** refactors—rebuild them using design-system Atoms.
- **Exceptions Process:** Any remaining raw HTML atoms must be treated as **approved exceptions** and documented in `STYLEGUIDE.md` with a reason.
- **Dev-only Guardrails:** Style Review Surface remains dev-only and must not be shipped or linked in production.


## 1. Problem Statement

After Tasks 014 and 015 establish the complete component library, this task refactors existing code to use the new components and eliminates style drift. This is the consolidation phase.

**Current State (post Task 015):**
- Full component library available (Button, Input, Card, Spinner, Badge)
- All tokens defined
- 61 raw button patterns to replace
- 17 raw input patterns to replace
- 44+ raw card patterns to replace
- 12+ raw spinner patterns to replace
- 20+ raw badge patterns to replace
- 500+ hardcoded color values to migrate

**Target State:**
- All UI uses design system components
- Zero arbitrary color values
- Zero raw HTML atoms where components exist
- 100% component adoption rate

---

## 2. OBJECTIVES

1. **Replace raw buttons** with `<Button>` component (61 instances)
2. **Replace raw inputs** with `<Input>` component (17 instances)
3. **Replace raw cards** with `<Card>` component (44+ instances)
4. **Replace raw spinners** with `<Spinner>` component (12+ instances)
5. **Replace raw badges** with `<Badge>` component (20+ instances)
6. **Migrate hardcoded colors** to token classes
7. **Remove proposed variants** folder after migration

---

## 3. CONFIRM MODIFICATIONS WITH ME

Before making changes, confirm:
- All components from Tasks 014-015 are complete and working
- Migration approach (file-by-file or component-by-component)
- Handling of edge cases that don't fit standard variants
- Testing strategy (visual regression, TypeScript, manual)

### Recommended Migration Order

1. **Spinners first** - Smallest scope, quick win
2. **Badges second** - Simple replacements
3. **Buttons third** - Largest impact, most variations
4. **Inputs fourth** - Form-focused, test carefully
5. **Cards fifth** - Structural, may require layout adjustments
6. **Color tokens last** - Sweep remaining arbitrary values

---

## 4. DEVELOP A PLAN IF THE CHANGES ARE OKAY

### Phase 1: Spinner Migration (12+ instances)

Files to update:
- `src/App.tsx` (loading state)
- `src/components/Dashboard.tsx`
- `src/components/pages/HolidaysPage.tsx`
- `src/components/pages/UsersPage.tsx`
- `src/components/pages/EmployeesPage.tsx`
- `src/components/pages/RatesPage.tsx`

Replace:
```tsx
// Before
<div className="animate-spin rounded-full h-6 w-6 border-2 border-[#EAEAEA] border-t-[#000000]" />

// After
<Spinner size="md" />
```

### Phase 2: Badge Migration (20+ instances)

Files to update:
- `src/components/HolidayTable.tsx`
- `src/components/UserTable.tsx`
- `src/components/ResourceTable.tsx`
- Various status indicators

Replace:
```tsx
// Before
<span className="px-2 py-1 text-xs bg-[#F0FDF4] text-[#166534] rounded">Active</span>

// After
<Badge variant="success">Active</Badge>
```

### Phase 3: Button Migration (61 instances)

**High-priority files (most buttons):**
- `src/components/pages/LoginPage.tsx`
- `src/components/pages/HolidaysPage.tsx`
- `src/components/pages/UsersPage.tsx`
- `src/components/pages/EmployeesPage.tsx`
- `src/components/pages/RatesPage.tsx`
- `src/components/Modal.tsx`
- `src/components/*EditorModal.tsx` (all editor modals)
- `src/components/*Table.tsx` (all tables)
- `src/components/DateRangeFilter.tsx`

Replace by variant:
```tsx
// Primary buttons
// Before: bg-[#000000] text-white hover:bg-[#333333]
<Button variant="primary">Save</Button>

// Secondary buttons
// Before: border border-[#EAEAEA] text-[#666666]
<Button variant="secondary">Cancel</Button>

// Ghost buttons
// Before: text-[#666666] hover:bg-[#FAFAFA]
<Button variant="ghost">Edit</Button>

// Danger buttons
// Before: text-[#EE0000] hover:bg-[#FEF2F2]
<Button variant="danger">Delete</Button>
```

### Phase 4: Input Migration (17 instances)

Files to update:
- `src/components/pages/LoginPage.tsx`
- `src/components/pages/ForgotPasswordPage.tsx`
- `src/components/pages/ResetPasswordPage.tsx`
- `src/components/HolidayEditorModal.tsx`
- `src/components/UserEditorModal.tsx`
- `src/components/EmployeeEditorModal.tsx`
- `src/components/ProjectEditorModal.tsx`

Replace:
```tsx
// Before
<input
  className="w-full px-3 py-2 border border-[#EAEAEA] rounded-md text-sm focus:ring-2 focus:ring-[#000000]"
  type="email"
  placeholder="Email"
/>

// After
<Input type="email" placeholder="Email" />
```

### Phase 5: Card Migration (44+ instances)

Files to update:
- `src/components/Dashboard.tsx`
- `src/components/StatsOverview.tsx`
- `src/components/pages/*.tsx` (all pages)
- `src/components/*EditorModal.tsx` (form sections)

Replace:
```tsx
// Before
<div className="bg-white rounded-lg border border-[#EAEAEA] p-4">

// After
<Card>
```

### Phase 6: Color Token Sweep

After component migration, sweep remaining arbitrary colors:

```bash
# Find remaining arbitrary colors
grep -r "bg-\[#" src/
grep -r "text-\[#" src/
grep -r "border-\[#" src/
```

Replace with token classes as defined in `src/index.css`.

### Phase 7: Cleanup

1. Remove `src/design-system/proposed-variants/` folder
2. Update Style Review Surface to remove proposed section
3. Update STYLEGUIDE.md to reflect completion
4. Archive Task 013 audit report

---

## 5. SAFETY

- **DO** migrate one file at a time
- **DO** run TypeScript validation after each file
- **DO** visually verify each page after migration
- **DO** commit frequently with descriptive messages
- **DON'T** batch too many changes together
- **DON'T** modify component behavior, only replace patterns
- **ROLLBACK** if any page breaks visually

### Testing Checklist Per File

- [ ] TypeScript compiles without errors
- [ ] Page renders correctly
- [ ] All interactive states work (hover, focus, disabled)
- [ ] Form submissions still work
- [ ] Modals open/close correctly
- [ ] No console errors

---

## 6. EXECUTE

### Agent assignments

Use **elite-code-architect** to:
- Plan optimal migration order
- Identify edge cases that need custom handling
- Review final token sweep

Use **react-nextjs-reviewer** to:
- Execute component replacements
- Verify each file after migration
- Update Style Review Surface
- Final documentation updates

### Acceptance criteria

- [ ] Zero raw `<button>` elements (except edge cases)
- [ ] Zero raw `<input>` elements (except edge cases)
- [ ] Zero inline spinner patterns
- [ ] Zero inline badge patterns
- [ ] Zero inline card patterns
- [ ] Minimal arbitrary color values (documented exceptions only)
- [ ] `proposed-variants` folder removed
- [ ] TypeScript validation passes
- [ ] All pages visually verified
- [ ] STYLEGUIDE.md updated to reflect completion

### Migration tracking

Create a checklist of files to track progress:

**Spinner Migration:**
- [ ] App.tsx
- [ ] Dashboard.tsx
- [ ] HolidaysPage.tsx
- [ ] UsersPage.tsx
- [ ] EmployeesPage.tsx
- [ ] RatesPage.tsx

**Badge Migration:**
- [ ] HolidayTable.tsx
- [ ] UserTable.tsx
- [ ] ResourceTable.tsx

**Button Migration:**
- [ ] LoginPage.tsx
- [ ] ForgotPasswordPage.tsx
- [ ] ResetPasswordPage.tsx
- [ ] HolidaysPage.tsx
- [ ] UsersPage.tsx
- [ ] EmployeesPage.tsx
- [ ] RatesPage.tsx
- [ ] Modal.tsx
- [ ] HolidayEditorModal.tsx
- [ ] UserEditorModal.tsx
- [ ] EmployeeEditorModal.tsx
- [ ] ProjectEditorModal.tsx
- [ ] HolidayTable.tsx
- [ ] UserTable.tsx
- [ ] ResourceTable.tsx
- [ ] DateRangeFilter.tsx
- [ ] BillingRatesTable.tsx

**Input Migration:**
- [ ] LoginPage.tsx
- [ ] ForgotPasswordPage.tsx
- [ ] ResetPasswordPage.tsx
- [ ] HolidayEditorModal.tsx
- [ ] UserEditorModal.tsx
- [ ] EmployeeEditorModal.tsx
- [ ] ProjectEditorModal.tsx

**Card Migration:**
- [ ] Dashboard.tsx
- [ ] StatsOverview.tsx
- [ ] HolidaysPage.tsx
- [ ] UsersPage.tsx
- [ ] EmployeesPage.tsx
- [ ] RatesPage.tsx
- [ ] EOMReportsPage.tsx

---

## 7. IMPLEMENTATION NOTES

### Handling Edge Cases

Some buttons may not fit standard variants. Document these as approved exceptions:

```tsx
// Example: Icon-only button
<button className="p-1 rounded hover:bg-vercel-gray-50">
  <ChevronIcon />
</button>
// Decision: Keep as raw button, add to STYLEGUIDE.md exceptions
```

### Import Updates

Each migrated file needs updated imports:

```tsx
// Add to imports
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { Badge } from '../components/Badge';
```

### Form Handling

Ensure `Input` component properly handles:
- `onChange` events
- `value` binding
- Form validation
- `ref` forwarding

---

## Metrics to Track

**Before Migration:**
- Raw buttons: 61
- Raw inputs: 17
- Raw cards: 44+
- Raw spinners: 12+
- Raw badges: 20+
- Arbitrary colors: 500+

**After Migration:**
- Target: 0 raw patterns (except documented exceptions)
- Target: <10 arbitrary colors (approved exceptions only)
- Component adoption rate: 100%