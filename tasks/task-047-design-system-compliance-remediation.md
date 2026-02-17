# Task 047: Design System Compliance Remediation

## Status: Pending

## Stack
- React (TypeScript)
- Tailwind CSS 4.1

## Context

A comprehensive three-axis design system compliance audit was performed on 2026-02-17. The audit covered:
1. **Component Reuse** — snowflake components, raw HTML elements, duplicated patterns
2. **Color & Typography** — hard-coded colors, inline styles, typography pattern violations
3. **Spacing & Responsive** — non-registry spacing values, missing mobile-first patterns

**Total violations found: 125** (Blocker 21 / Major 61 / Minor 43)

This task remediates those violations across 6 phases, ordered to minimize churn — foundational infrastructure first, then bulk page-by-page cleanup.

---

## Phase 1: Extend Existing Atoms

### 1A. Alert atom — add `variant="success"` and `onDismiss` prop

**File:** `src/components/Alert.tsx`

- Add `variant="success"` with `bg-success-light border-success` styling and a green checkmark icon, matching the error/info pattern.
- Add optional `onDismiss?: () => void` prop. When provided, render a ghost close button (X icon) on the right side.
- These two additions unblock replacing hand-rolled alerts in 10+ pages.

**Acceptance:**
- [ ] Alert renders correctly with `variant="success"`
- [ ] Alert renders a dismiss button when `onDismiss` is provided
- [ ] Existing `variant="error"` and `icon="info"` still work unchanged

### 1B. Select atom — add `label` prop

**File:** `src/components/Select.tsx`

- Add optional `label?: string` prop that renders a `<label>` above the select using the same styling as Input's label (`text-xs font-medium text-vercel-gray-400 uppercase tracking-wider`).
- This unblocks removing raw `<label>` elements from BillingsPage and other modal forms.

**Acceptance:**
- [ ] Select renders a label when `label` prop is provided
- [ ] Select renders without a label when prop is omitted (backwards-compatible)

### 1C. Replace inline shadow styles with existing tokens

**Files:** `DropdownMenu.tsx`, `Modal.tsx`, `MainHeader.tsx`, `Select.tsx`, `MultiSelect.tsx`, `AIChatButton.tsx`

Shadow tokens `--shadow-vercel-dropdown` and `--shadow-modal` are already defined in `index.css` but these 6 components inline the same rgba() boxShadow strings.

| Component | Replace inline `style={{ boxShadow }}` with |
|---|---|
| DropdownMenu.tsx:114 | `shadow-vercel-dropdown` class |
| Modal.tsx:67 | `shadow-modal` class |
| MainHeader.tsx:139 | `shadow-vercel-dropdown` class |
| Select.tsx:105 | `shadow-vercel-dropdown` class |
| MultiSelect.tsx:131 | `shadow-vercel-dropdown` class |
| AIChatButton.tsx:22 | `shadow-elevated` class (or define `--shadow-fab`) |

**Acceptance:**
- [ ] No remaining inline `boxShadow` styles in any component
- [ ] Visual appearance is identical (shadows match the existing rgba values)

---

## Phase 2: Create New Atoms & Molecules

### 2A. `LoadingState` molecule

**Create:** `src/components/molecules/LoadingState.tsx`

Encapsulates the Spinner + centered text pattern repeated in **11 pages**: EmployeesPage, RatesPage, BurnPage, CompaniesPage, ProjectManagementPage, BillingsPage, RevenuePage, DiagnosticsPage, LegalPage, InvestorDashboardPage, Dashboard.

```tsx
interface LoadingStateProps {
  message?: string;   // default: "Loading..."
  size?: 'sm' | 'md' | 'lg';  // Spinner size, default 'md'
}
```

Renders: `<div className="flex items-center justify-center py-12"><Spinner size={size} /><span className="ml-3 text-sm text-vercel-gray-400">{message}</span></div>`

**Acceptance:**
- [ ] Component created and registered in molecules registry
- [ ] All 11 pages updated to use `<LoadingState>` instead of inline spinner patterns

### 2B. `ConfirmModal` molecule

**Create:** `src/components/molecules/ConfirmModal.tsx`

Encapsulates the Modal + warning icon + message + Cancel/Confirm buttons pattern used in HolidaysPage and UsersPage (delete confirmations, password reset confirmations).

```tsx
interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;      // default: "Delete"
  confirmVariant?: 'danger' | 'primary';  // default: 'danger'
  loading?: boolean;
}
```

**Acceptance:**
- [ ] Component created and registered in molecules registry
- [ ] HolidaysPage delete confirmation uses ConfirmModal
- [ ] UsersPage delete and password-reset confirmations use ConfirmModal

### 2C. `TabGroup` atom

**Create:** `src/components/TabGroup.tsx`

LegalPage currently hand-rolls a tab UI with raw `<button>` elements. Extract a reusable tab component.

```tsx
interface Tab {
  id: string;
  label: string;
}

interface TabGroupProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}
```

**Acceptance:**
- [ ] Component created and registered in atoms registry
- [ ] LegalPage updated to use TabGroup instead of raw buttons

### 2D. `Textarea` atom

**Create:** `src/components/Textarea.tsx`

Mirrors the Input atom API for multi-line text. LegalPage currently uses a raw `<textarea>`.

```tsx
interface TextareaProps {
  label?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
  helperText?: string;
  disabled?: boolean;
}
```

**Acceptance:**
- [ ] Component created and registered in atoms registry
- [ ] LegalPage updated to use Textarea instead of raw `<textarea>`

### 2E. `FileInput` atom

**Create:** `src/components/FileInput.tsx`

DiagnosticsPage has two raw `<input type="file">` elements with custom-styled label wrappers.

```tsx
interface FileInputProps {
  label: string;
  accept?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}
```

**Acceptance:**
- [ ] Component created and registered in atoms registry
- [ ] DiagnosticsPage updated to use FileInput instead of raw file inputs

---

## Phase 3: Replace `text-black` and Fix Color Violations

### 3A. Replace `text-black` with `text-vercel-gray-600`

Both resolve to #000000 but `text-vercel-gray-600` is the design token. **15 instances across 6 files:**

| File | Lines | Count |
|---|---|---|
| BillingsPage.tsx | 487, 493 | 2 |
| RevenueTable.tsx | 199, 206, 211, 214, 232 | 5 |
| ProjectHierarchyTable.tsx | 123, 127, 130 | 3 |
| EmployeePerformance.tsx | 415, 426, 429 | 3 |
| AccordionFlat.tsx | 221 | 1 |
| AccordionNested.tsx | 122 | 1 |

**Acceptance:**
- [ ] Zero instances of `text-black` remain in the codebase
- [ ] Visual appearance is unchanged

### 3B. Fix non-token color classes

| File | Line | Violation | Fix |
|---|---|---|---|
| FormulasPage.tsx | 108 | `text-green-400` | Replace with `text-success` |
| ProjectEditorModal.tsx | 162 | `focus:ring-vercel-blue` | Replace with `focus:ring-black` |
| DatePicker.tsx | 194 | `text-[11px]` (arbitrary) | Replace with `text-2xs` |
| AccordionNested.tsx | 122 | `mr-[10px]` (arbitrary) | Replace with `mr-2.5` |

### 3C. Formalize `text-vercel-gray-300` in pattern registry

**File:** `src/design-system/registry/patterns.ts`

Update the `text-hierarchy` pattern entry to add gray-300 as a recognized level:

> "Sub-content text: text-vercel-gray-300 (#888) -- for expandable row details, chevron icons, dash placeholders, secondary metadata"

This legitimizes 80+ existing usages.

### 3D. Fix scrollbar and autofill hex values in index.css

**File:** `src/index.css`

| Line | Violation | Fix |
|---|---|---|
| 114, 127, 132 | `#D4D4D4`, `#A3A3A3` raw hex for scrollbar | Add `--color-scrollbar-thumb` and `--color-scrollbar-thumb-hover` tokens to `@theme`, then use `var()` |
| 154 | `-webkit-text-fill-color: #000000` | Replace with `var(--color-vercel-gray-600)` |

---

## Phase 4: Fix Spacing Violations

### 4A. Non-registry spacing values

| File | Line | Violation | Fix |
|---|---|---|---|
| BillingsPage.tsx | 454 | `p-8` | Change to `p-6` |
| ProjectsPage.tsx | 154 | `p-8` | Change to `p-6` |
| RevenuePage.tsx | 724 | `space-y-5` | Change to `space-y-4` |
| BillingsPage.tsx | 613, 713, 781, 884 | `space-y-6` on modal forms | Change to `space-y-4` (form-spacing pattern) |
| ForgotPasswordPage.tsx | 40 | `mb-8` | Restructure with `space-y-6` parent flow |
| ResetPasswordPage.tsx | 58 | `mb-8` | Same restructure |
| LoginPage.tsx | 45 | `mb-8` | Change to `mb-4` |
| ResetPasswordPage.tsx | 97, 132 | `mb-2` on labels | Change to `mb-1` |
| Footer.tsx | 55 | `gap-8` | Change to `gap-6` |
| Footer.tsx | 55 | `mb-8` | Restructure with `space-y-6` |
| Footer.tsx | 58 | `mb-3` | Change to `mb-4` |
| RevenuePage.tsx | 650-662 | `gap-6` in header flex | Change to `gap-3` (page-header pattern) |
| EOMReportsPage.tsx | 5 | Missing `space-y-6` | Add to container |

### 4B. Subtitle mt-2 to mt-1

| File | Line | Fix |
|---|---|---|
| LoginPage.tsx | 54 | `mt-2` -> `mt-1` |
| ForgotPasswordPage.tsx | 44 | `mt-2` -> `mt-1` |
| ResetPasswordPage.tsx | 60 | `mt-2` -> `mt-1` |

### 4C. FormulasPage sub-labels

| Line | Fix |
|---|---|
| 61, 88, 106, 114 | `mb-2` -> `mb-1` |

### 4D. Registry gap closure

**File:** `src/design-system/registry/spacing.ts`

Evaluate and register directional padding tokens that are legitimately needed:
- `pt-4`, `pt-6` — separator/border-top patterns
- `pl-10`, `pl-16` — table indentation (BillingsPage)
- `mt-4` — separator/divider contexts

---

## Phase 5: Add Responsive Handling

### 5A. MainHeader mobile navigation

**File:** `src/components/MainHeader.tsx`

The 9 nav items overflow on small screens. Options:
- **Minimum:** Add `overflow-x-auto scrollbar-none` to the nav container
- **Better:** Implement a hamburger menu at `md:` breakpoint with a slide-out drawer

### 5B. Table overflow wrappers

Add `<div className="overflow-x-auto">` wrapper around tables in:
- BillingsPage.tsx (lines 460-582)
- CompaniesPage.tsx (lines 123-180)
- ProjectManagementPage.tsx (lines 130-198)

### 5C. InvestorDashboardPage grid

**File:** `src/components/pages/InvestorDashboardPage.tsx` line 337

Replace `grid-cols-[2fr_1fr]` with `lg:grid-cols-3` and `lg:col-span-2` on the first child.

---

## Phase 6: Extract Page-Local Components & Replace Patterns

### 6A. Extract page-local components

| Current Location | Extract To | Type |
|---|---|---|
| DiagnosticsPage.tsx (lines 50-243) | `src/components/diagnostics/ProjectValidationCard.tsx` | molecule |
| DiagnosticsPage.tsx (lines 248-304) | `src/components/diagnostics/ValidationSummary.tsx` | molecule |
| DiagnosticsPage.tsx (lines 310-358) | Replace with existing `DateCycle` molecule | (delete) |
| FormulasPage.tsx (lines 19-135) | `src/components/molecules/FormulaCard.tsx` | molecule |
| BillingsPage.tsx (lines 459-583) | `src/components/BillingsTable.tsx` | organism |

### 6B. Create shared `EntityTable` organism

**Create:** `src/components/EntityTable.tsx`

CompaniesPage and ProjectManagementPage have nearly identical 60-70 line inline `<table>` constructions. Extract a reusable organism that accepts column definitions, row data, and action menu configuration.

### 6C. Replace hand-rolled alerts with Alert atom

Replace inline error divs in **8 files**:
- EmployeesPage.tsx
- EmployeeManagementPage.tsx
- HolidaysPage.tsx
- UsersPage.tsx
- CompaniesPage.tsx
- ProjectManagementPage.tsx
- BurnPage.tsx
- Dashboard.tsx

Replace inline success divs in **2 files** (after Phase 1A):
- HolidaysPage.tsx
- UsersPage.tsx

### 6D. Replace raw HTML elements

- **ResetPasswordPage** — replace raw `<input>` and `<label>` with Input atom
- **LoginPage** — replace raw `<button>` with Button atom
- **DiagnosticsPage** — replace raw `<button>` with Button atom (covered by DateCycle swap)
- **LegalPage** — replace raw `<button>` tabs with TabGroup atom, raw `<textarea>` with Textarea atom, hand-rolled "Active" pill with `<Badge variant="brand">`
- **UsersPage** — replace raw dismiss `<button>` with Button ghost iconOnly

### 6E. Replace loading state patterns

Replace inline Spinner + text patterns with `<LoadingState>` molecule in **11 pages**:
EmployeesPage, RatesPage, BurnPage, CompaniesPage, ProjectManagementPage, BillingsPage, RevenuePage, DiagnosticsPage, LegalPage, InvestorDashboardPage, Dashboard

---

## Constraints

- Each phase should be a separate commit
- No visual regressions — every change should produce identical rendered output
- Registry files (`atoms.ts`, `molecules.ts`, `organisms.ts`) must be updated when new components are created
- `npx tsc --noEmit` must pass after each phase
- Do not modify the design system Style Review page in this task

## Verification

- [ ] Zero inline `boxShadow` styles remain
- [ ] Zero `text-black` instances remain
- [ ] Zero raw Tailwind palette colors (green-400, blue-500, etc.)
- [ ] Zero arbitrary font-size values (`text-[11px]`)
- [ ] Zero non-registry spacing values (p-8, space-y-5, gap-8, mb-8, mb-2)
- [ ] All error displays use Alert atom
- [ ] All success displays use Alert atom
- [ ] All loading states use LoadingState molecule
- [ ] All confirmation dialogs use ConfirmModal molecule
- [ ] All form inputs use Input/Select/Textarea atoms
- [ ] All interactive buttons use Button atom
- [ ] Tab interfaces use TabGroup atom
- [ ] Tables have `overflow-x-auto` wrappers
- [ ] MainHeader handles mobile viewports
- [ ] All new components registered in design system registry
- [ ] `text-hierarchy` pattern includes `text-vercel-gray-300`
- [ ] `npx tsc --noEmit` passes
- [ ] No visual regressions on any page
