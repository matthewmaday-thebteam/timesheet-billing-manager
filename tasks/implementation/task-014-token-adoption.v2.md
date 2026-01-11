# Task 014: Design Token Adoption & High-Impact Component Promotion

**Status:** COMPLETE (2026-01-11)

**Depends on:** Task 013 (COMPLETE)

**Priority:** High - Foundation for all subsequent UI work

---

## 0. v2 Amendments (January 11, 2026)

This task is updated to close gaps identified in review:

- **Token/Class Alignment:** All examples and migrations must use **token-derived utilities** (your `@theme` / Tailwind theme tokens), not Tailwind defaults, unless explicitly approved.
- **Expanded Token Scope:** Token adoption includes **typography and spacing/radius/shadow scales**, not only colors.
- **Approved Global Pattern:** Add a reusable **MeshGradientBackground** pattern (token-driven 4-color mesh gradient, blur 60–100px, subtle 15–20s infinite loop). Render **only** in the Style Review Surface for now (no production adoption yet).
- **Dev-only Guardrails:** The Style Review Surface must be **dev-only** (Storybook or an env-gated route) and must not appear in production navigation or builds.


## 1. Problem Statement

The UI audit (Task 013) found that the `@theme` tokens defined in `src/index.css` are **completely unused**. All 500+ color instances are hardcoded as arbitrary Tailwind values. This task extends the token system and promotes the two highest-impact proposed components.

**Current State:**
- 3 tokens defined, 0 used
- 500+ hardcoded color values
- 61 raw button patterns
- 12+ raw spinner patterns

**Target State:**
- All colors defined as tokens
- `Button` component promoted and available
- `Spinner` component promoted and available
- New UI work uses tokens exclusively

---

## 2. OBJECTIVES

1. **Extend `@theme` tokens** with all colors identified in the audit
2. **Promote `ProposedButton`** to official `Button` component
3. **Promote `ProposedSpinner`** to official `Spinner` component
4. **Update documentation** to reflect new components

---

## 3. CONFIRM MODIFICATIONS WITH ME

Before making changes, confirm:
- The complete color token list matches the audit findings
- Button variant names are appropriate (primary, secondary, ghost, danger)
- Spinner sizes are appropriate (sm, md, lg)
- No breaking changes to existing components

---

## 4. DEVELOP A PLAN IF THE CHANGES ARE OKAY

### Step 1: Extend Design Tokens

Update `src/index.css` with the full color palette:

```css
@theme {
  /* Existing Vercel Grays */
  --color-vercel-gray-50: #fafafa;
  --color-vercel-gray-100: #eaeaea;
  --color-vercel-gray-200: #999999;

  /* Extended Grays */
  --color-gray-400: #666666;
  --color-gray-500: #333333;
  --color-gray-300: #888888;

  /* Semantic - Error */
  --color-error: #EE0000;
  --color-error-hover: #CC0000;
  --color-error-light: #FEF2F2;
  --color-error-border: #FECACA;
  --color-error-text: #DC2626;

  /* Semantic - Success */
  --color-success: #50E3C2;
  --color-success-light: #F0FDF4;
  --color-success-border: #BBF7D0;
  --color-success-text: #166534;

  /* Semantic - Warning */
  --color-warning: #F5A623;
  --color-warning-alt: #F97316;
  --color-warning-light: #FFF7ED;
  --color-warning-border: #FFEDD5;
  --color-warning-text: #9A3412;
  --color-warning-text-dark: #C2410C;

  /* Semantic - Info */
  --color-info: #4338CA;
  --color-info-light: #EEF2FF;
  --color-info-border: #C7D2FE;

  /* Brand */
  --color-brand-indigo: #667eea;
  --color-brand-purple: #764ba2;

  /* Shadows */
  --shadow-vercel-dropdown: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05);
  --shadow-modal: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  --shadow-elevated: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
}
```

### Step 2: Promote Button Component

1. Move `src/design-system/proposed-variants/ProposedButton.tsx` to `src/components/Button.tsx`
2. Rename `ProposedButton` to `Button`
3. Update to use token classes instead of arbitrary values
4. Export from component index

### Step 3: Promote Spinner Component

1. Move `src/design-system/proposed-variants/ProposedSpinner.tsx` to `src/components/Spinner.tsx`
2. Rename `ProposedSpinner` to `Spinner`
3. Update to use token classes
4. Export from component index

### Step 4: Update Documentation

1. Update `/docs/STYLEGUIDE.md` - Move Button/Spinner to Official Atoms
2. Update `/CLAUDE.md` - Reference new components
3. Update Style Review Surface to show promoted components

---

## 5. SAFETY

- **DO NOT** refactor existing button/spinner usage yet (that's Task 016)
- **DO NOT** remove proposed variants until Task 016 completes
- **DO** ensure new components work alongside existing patterns
- **DO** run TypeScript validation before completing

---

## 6. EXECUTE

### Agent assignments

Use **elite-code-architect** to:
- Extend the `@theme` token system
- Ensure token naming follows conventions
- Update components to use tokens

Use **react-nextjs-reviewer** to:
- Promote Button and Spinner components
- Verify component API is complete
- Update Style Review Surface

### Acceptance criteria

- [ ] All colors from audit are defined as tokens in `@theme`
- [ ] `Button` component exists at `src/components/Button.tsx`
- [ ] `Spinner` component exists at `src/components/Spinner.tsx`
- [ ] Both components use token classes (no arbitrary values)
- [ ] TypeScript validation passes
- [ ] Style Review Surface shows promoted components
- [ ] STYLEGUIDE.md updated

### Files to create/modify

**Create:**
- `src/components/Button.tsx`
- `src/components/Spinner.tsx`

**Modify:**
- `src/index.css` (extend @theme)
- `docs/STYLEGUIDE.md`
- `CLAUDE.md`
- `src/design-system/style-review/StyleReviewPage.tsx`

---

## 7. IMPLEMENTATION NOTES

### Button API

```tsx
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

// Usage
<Button variant="primary" size="md">Save</Button>
<Button variant="danger">Delete</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

### Spinner API

```tsx
interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
  color?: 'default' | 'white';
}

// Usage
<Spinner />
<Spinner size="lg" />
<Spinner color="white" /> // For dark backgrounds
```

### Token Usage in Components

```tsx
// Before (arbitrary values)
className="bg-[#000000] text-white hover:bg-[#333333]"

// After (token classes)
className="bg-vercel-gray-950 text-vercel-gray-50 hover:bg-vercel-gray-800"  // token-derived utilities
```

---

## Metrics to Track

After completion, measure:
- Token coverage: Should be 100% of identified colors
- New component availability: Button + Spinner ready for use
- No regression in existing UI