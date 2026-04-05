# Task 015: Component Promotion & Gray Scale Standardization

**Status:** COMPLETE (2026-01-11)

**Depends on:** Task 014 (Token Adoption)

**Priority:** Medium - Completes the component library foundation

---

## 0. v2 Amendments (January 11, 2026)

This task is updated to include an explicit **Atomic Consistency** audit requirement:

- **Atomic Design Categorization:** Inventory must categorize components as **Atoms → Molecules → Organisms → Templates → Pages**.
- **Atomic Consistency:** Detect multiple components that implement the same Atom under different names (e.g., `PrimaryButton`, `BlueButton`, `ActionBtn`) and report them as consolidation candidates with usage counts and file paths. Do not refactor yet—capture as candidates.
- **Molecule Integrity:** Flag Molecules (e.g., `SearchBar`) composed of raw HTML Atoms (`<button>`, `<input>`) instead of design-system Atoms as **high-priority consolidation** areas.
- **Dev-only Guardrails:** Any Style Review Surface updates remain dev-only and must not leak to production routes/nav.


## 1. Problem Statement

After Task 014 establishes the token system and promotes Button/Spinner, this task promotes the remaining proposed components and resolves the gray scale inconsistency.

**Current State (post Task 014):**
- Button and Spinner promoted
- 17 raw input patterns remain
- 44+ raw card patterns remain
- 20+ raw badge patterns remain
- Two inconsistent gray scales in use (Vercel-style vs Tailwind defaults in DatePicker)

**Target State:**
- `Input`, `Card`, and `Badge` components promoted
- Single consistent gray scale across all components
- DatePicker updated to use Vercel gray scale
- Full atomic component library available

---

## 2. OBJECTIVES

1. **Promote `ProposedInput`** to official `Input` component
2. **Promote `ProposedCard`** to official `Card` component
3. **Promote `ProposedBadge`** to official `Badge` component
4. **Standardize gray scale** - Migrate DatePicker to Vercel grays
5. **Update documentation** with complete component library

---

## 3. CONFIRM MODIFICATIONS WITH ME

Before making changes, confirm:
- Input component supports all form field types needed
- Card variants cover all use cases
- Badge semantic colors are appropriate
- DatePicker gray migration approach is acceptable

### Gray Scale Decision Required

**Option A: Keep Vercel Grays (Recommended)**
- `#FAFAFA`, `#EAEAEA`, `#999999`, `#666666`, `#333333`, `#000000`
- Matches existing app aesthetic
- Requires DatePicker migration

**Option B: Switch to Tailwind Defaults**
- `#F9FAFB`, `#F3F4F6`, `#E5E7EB`, etc.
- More granular scale
- Requires full app migration

---

## 4. DEVELOP A PLAN IF THE CHANGES ARE OKAY

### Step 1: Promote Input Component

1. Move `src/design-system/proposed-variants/ProposedInput.tsx` to `src/components/Input.tsx`
2. Rename `ProposedInput` to `Input`
3. Update to use token classes
4. Add support for:
   - Text, email, password, number types
   - Label and helper text
   - Error states
   - Disabled state

### Step 2: Promote Card Component

1. Move `src/design-system/proposed-variants/ProposedCard.tsx` to `src/components/Card.tsx`
2. Rename `ProposedCard` to `Card`
3. Variants: default, elevated, bordered, subtle
4. Padding options: none, sm, md, lg

### Step 3: Promote Badge Component

1. Move `src/design-system/proposed-variants/ProposedBadge.tsx` to `src/components/Badge.tsx`
2. Rename `ProposedBadge` to `Badge`
3. Variants: default, success, warning, error, info
4. Sizes: sm, md

### Step 4: Standardize DatePicker Grays

Update `src/components/DatePicker.tsx` to replace Tailwind default grays:

| Tailwind Default | Replace With |
|------------------|--------------|
| `#F9FAFB` (gray-50) | `#FAFAFA` (vercel-gray-50) |
| `#F3F4F6` (gray-100) | `#FAFAFA` (vercel-gray-50) |
| `#E5E7EB` (gray-200) | `#EAEAEA` (vercel-gray-100) |
| `#D1D5DB` (gray-300) | `#EAEAEA` (vercel-gray-100) |
| `#9CA3AF` (gray-400) | `#999999` (vercel-gray-200) |
| `#6B7280` (gray-500) | `#666666` (gray-400) |
| `#111827` (gray-900) | `#000000` (black) |

### Step 5: Update Documentation

1. Update `/docs/STYLEGUIDE.md`:
   - Move Input/Card/Badge to Official Atoms
   - Document gray scale decision
   - Remove from Proposed Variants section
2. Update Style Review Surface

---

## 5. SAFETY

- **DO NOT** refactor existing input/card/badge usage yet (that's Task 016)
- **DO NOT** change DatePicker functionality, only colors
- **DO** test DatePicker visually after gray migration
- **DO** ensure new components maintain accessibility
- **DO** run TypeScript validation

---

## 6. EXECUTE

### Agent assignments

Use **elite-code-architect** to:
- Review component APIs for completeness
- Ensure token usage is consistent
- Verify gray scale migration in DatePicker

Use **react-nextjs-reviewer** to:
- Promote Input, Card, Badge components
- Update DatePicker colors
- Update Style Review Surface
- Verify accessibility (focus states, contrast)

### Acceptance criteria

- [x] `Input` component exists at `src/components/Input.tsx`
- [x] `Card` component exists at `src/components/Card.tsx`
- [x] `Badge` component exists at `src/components/Badge.tsx`
- [x] All components use token classes
- [x] DatePicker uses Vercel gray scale exclusively
- [ ] No Tailwind default grays remain in codebase (deferred to Task 016)
- [x] TypeScript validation passes
- [x] STYLEGUIDE.md updated
- [x] Atomic Consistency Report produced

### Files to create/modify

**Create:**
- `src/components/Input.tsx`
- `src/components/Card.tsx`
- `src/components/Badge.tsx`

**Modify:**
- `src/components/DatePicker.tsx` (gray scale)
- `docs/STYLEGUIDE.md`
- `src/design-system/style-review/StyleReviewPage.tsx`

---

## 7. IMPLEMENTATION NOTES

### Input API

```tsx
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  size?: 'sm' | 'md' | 'lg';
}

// Usage
<Input label="Email" type="email" placeholder="you@example.com" />
<Input label="Password" type="password" error="Password is required" />
<Input disabled value="Read only" />
```

### Card API

```tsx
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'bordered' | 'subtle';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

// Usage
<Card>Default card content</Card>
<Card variant="elevated" padding="lg">Elevated card</Card>
<Card variant="subtle">Subtle background card</Card>
```

### Badge API

```tsx
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
}

// Usage
<Badge>Default</Badge>
<Badge variant="success">Active</Badge>
<Badge variant="error" size="sm">Failed</Badge>
```

### DatePicker Gray Migration

Search and replace in `DatePicker.tsx`:
```
bg-[#F9FAFB] → bg-vercel-gray-50
bg-[#F3F4F6] → bg-vercel-gray-50
border-[#E5E7EB] → border-vercel-gray-100
text-[#6B7280] → text-gray-400
text-[#111827] → text-black
```

---

## Metrics to Track

After completion:
- Component library completeness: 5 atoms promoted
- Gray scale consistency: 100% Vercel grays
- DatePicker visual regression: None

## Added Deliverable (v2): Atomic Consistency Report

- Produce a **Duplicate Atom Map**: intent → components → usage counts → locations (file paths).
- Identify Molecules built from raw HTML Atoms as top consolidation candidates.
