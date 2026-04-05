# Atomic Consistency Report

**Generated:** 2026-01-11
**Task:** 015 Component Promotion
**Status:** Post-Promotion Audit

---

## Executive Summary

This report documents the atomic design system state after Task 015 component promotion. It identifies remaining consolidation candidates and molecules using raw HTML atoms.

### Promoted Components (Tasks 014-015)

| Component | File | Consolidates | Task |
|-----------|------|--------------|------|
| Button | `src/components/Button.tsx` | 61 raw button patterns | 014 |
| Spinner | `src/components/Spinner.tsx` | 12+ spinner patterns | 014 |
| Input | `src/components/Input.tsx` | 17 raw input patterns | 015 |
| Card | `src/components/Card.tsx` | 44+ card patterns | 015 |
| Badge | `src/components/Badge.tsx` | 20+ badge patterns | 015 |

---

## Duplicate Atom Map

### 1. Button Intent

**Official Component:** `Button` (`src/components/Button.tsx`)

| Pattern | Usage Count | Files |
|---------|-------------|-------|
| Raw `<button>` elements | 67 | 26 files |
| ProposedButton (legacy) | 1 | `src/design-system/proposed-variants/ProposedButton.tsx` |

**Top Files for Consolidation (Task 016):**
- `src/components/DatePicker.tsx` - 6 occurrences
- `src/components/pages/UsersPage.tsx` - 6 occurrences
- `src/components/DateRangeFilter.tsx` - 5 occurrences
- `src/components/MainHeader.tsx` - 4 occurrences
- `src/components/pages/HolidaysPage.tsx` - 4 occurrences
- `src/components/UserEditorModal.tsx` - 4 occurrences

### 2. Input Intent

**Official Component:** `Input` (`src/components/Input.tsx`)

| Pattern | Usage Count | Files |
|---------|-------------|-------|
| Raw `<input>` elements | 19 | 11 files |
| ProposedInput (legacy) | 1 | `src/design-system/proposed-variants/ProposedInput.tsx` |

**Top Files for Consolidation (Task 016):**
- `src/components/EmployeeEditorModal.tsx` - 4 occurrences
- `src/components/UserEditorModal.tsx` - 3 occurrences
- `src/components/DateRangeFilter.tsx` - 2 occurrences
- `src/components/pages/LoginPage.tsx` - 2 occurrences
- `src/components/pages/ResetPasswordPage.tsx` - 2 occurrences

### 3. Card Intent

**Official Component:** `Card` (`src/components/Card.tsx`)

| Pattern | Usage Count | Files (estimated) |
|---------|-------------|-------------------|
| `bg-white rounded-lg` div patterns | 44+ | Various page/modal files |
| ProposedCard (legacy) | 1 | `src/design-system/proposed-variants/ProposedCard.tsx` |

### 4. Badge Intent

**Official Component:** `Badge` (`src/components/Badge.tsx`)

| Pattern | Usage Count | Files (estimated) |
|---------|-------------|-------------------|
| Status indicator spans | 20+ | Table and card components |
| ProposedBadge (legacy) | 1 | `src/design-system/proposed-variants/ProposedBadge.tsx` |

---

## Hardcoded Color Audit

### Remaining Arbitrary Colors

| Pattern | Occurrences | Files |
|---------|-------------|-------|
| `bg-[#RRGGBB]` | 218 | 37 files |

**Top Offenders (for Task 016 Drift Cleanup):**
- `src/components/pages/UsersPage.tsx` - 11 occurrences
- `src/components/UserTable.tsx` - 10 occurrences
- `src/design-system/proposed-variants/ProposedBadge.tsx` - 10 occurrences
- `src/components/pages/HolidaysPage.tsx` - 10 occurrences
- `src/components/pages/EmployeesPage.tsx` - 9 occurrences
- `src/components/UnderHoursModal.tsx` - 9 occurrences
- `src/design-system/proposed-variants/ProposedButton.tsx` - 9 occurrences
- `src/components/UserEditorModal.tsx` - 9 occurrences

---

## Molecules Using Raw HTML Atoms

These molecules should be refactored in Task 016 to use official design system atoms.

### HIGH PRIORITY (Multiple Raw Atoms)

| Molecule | Location | Raw Atoms Used |
|----------|----------|----------------|
| EmployeeEditorModal | `src/components/EmployeeEditorModal.tsx` | 4 inputs, 2 buttons |
| UserEditorModal | `src/components/UserEditorModal.tsx` | 3 inputs, 4 buttons |
| DateRangeFilter | `src/components/DateRangeFilter.tsx` | 2 inputs, 5 buttons |
| ProjectEditorModal | `src/components/ProjectEditorModal.tsx` | 1 input, 3 buttons |
| HolidayEditorModal | `src/components/HolidayEditorModal.tsx` | 1 input, 2 buttons |

### MEDIUM PRIORITY (Single Raw Atom Types)

| Molecule | Location | Raw Atoms Used |
|----------|----------|----------------|
| LoginPage | `src/components/pages/LoginPage.tsx` | 2 inputs, 2 buttons |
| ForgotPasswordPage | `src/components/pages/ForgotPasswordPage.tsx` | 1 input, 3 buttons |
| ResetPasswordPage | `src/components/pages/ResetPasswordPage.tsx` | 2 inputs, 3 buttons |
| UsersPage | `src/components/pages/UsersPage.tsx` | 6 buttons |
| HolidaysPage | `src/components/pages/HolidaysPage.tsx` | 4 buttons |

---

## Atomic Design Hierarchy

### Current Inventory

**Atoms (Official):**
1. Avatar - `src/components/Avatar.tsx`
2. Button - `src/components/Button.tsx` (Task 014)
3. Spinner - `src/components/Spinner.tsx` (Task 014)
4. Input - `src/components/Input.tsx` (Task 015)
5. Card - `src/components/Card.tsx` (Task 015)
6. Badge - `src/components/Badge.tsx` (Task 015)
7. Select - `src/components/Select.tsx`
8. NavItem - `src/components/NavItem.tsx`
9. MetricCard - `src/components/MetricCard.tsx`

**Atoms (Legacy - To Remove):**
- ProposedButton - `src/design-system/proposed-variants/`
- ProposedSpinner - `src/design-system/proposed-variants/`
- ProposedInput - `src/design-system/proposed-variants/`
- ProposedCard - `src/design-system/proposed-variants/`
- ProposedBadge - `src/design-system/proposed-variants/`

**Molecules:**
- Modal - `src/components/Modal.tsx`
- DropdownMenu - `src/components/DropdownMenu.tsx`
- DatePicker - `src/components/DatePicker.tsx`
- DateRangeFilter - `src/components/DateRangeFilter.tsx`
- SubNavbar - `src/components/SubNavbar.tsx`
- MainHeader - `src/components/MainHeader.tsx`
- *EditorModal components

**Organisms:**
- *Table components (UserTable, HolidayTable, ResourceTable)
- StatsOverview
- HolidayCalendar

**Templates:**
- App layout structure

**Pages:**
- LoginPage, ForgotPasswordPage, ResetPasswordPage
- Dashboard, EmployeesPage, HolidaysPage, etc.

---

## Recommendations for Task 016

1. **Refactor Editor Modals** - Replace raw `<input>` and `<button>` with `Input` and `Button` components
2. **Refactor Auth Pages** - Replace form elements in Login, ForgotPassword, ResetPassword pages
3. **Clean Up Drift** - Replace all `bg-[#RRGGBB]` patterns with token classes
4. **Remove Legacy Proposed Variants** - Delete files in `src/design-system/proposed-variants/` after migration
5. **Add ESLint Rule** - Enforce no arbitrary color values in new code

---

## Metrics

| Metric | Before Task 014 | After Task 015 |
|--------|-----------------|----------------|
| Official Atoms | 4 | 9 |
| Proposed Variants | 5 | 0 (all promoted) |
| Raw Button Elements | 61+ | 67 (migration pending) |
| Raw Input Elements | 17 | 19 (migration pending) |
| Hardcoded Colors | 500+ | 218 (partial cleanup) |
| DatePicker Gray Consistency | Mixed | 100% Vercel |

---

**Next Steps:** Execute Task 016 to migrate existing raw HTML patterns to official atoms and complete drift cleanup.
