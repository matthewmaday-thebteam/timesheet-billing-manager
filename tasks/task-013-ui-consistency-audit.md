# Task 013: UI Consistency Audit, Variant Capture, and Style Review Surface

**Status:** IN-PROGRESS

## 1. Problem Statement

The UI style guide and component library are currently “buried” across the codebase, which makes consistency hard to enforce and makes it difficult to quantify how much of the UI is actually built from reusable components.

We need an audit that:
- Extracts the **real** design system in use (tokens + conventions)
- Finds **style drift** (hardcoded fonts/colors/sizes/spacing)
- Finds **rogue UI elements** (buttons/inputs/cards rebuilt outside the component library)
- Captures drift/rogue patterns as **proposed variants** (for review), without refactoring production UI yet
- Produces a dev-only **Style Review Surface** (Storybook or a gated route) to visually compare official components vs proposed variants
- Creates an enforceable, centralized **STYLEGUIDE.md** that Claude Code must follow going forward

---

## 2. QUESTIONS / OBJECTIVES

1. What is the current “Source of Truth” for styles?
   - Where are tokens defined (Tailwind config, CSS variables, theme provider, component library theme, etc.)?
   - What is the styling strategy (Tailwind, CSS Modules, styled-components, MUI, Chakra, etc.)?

2. What reusable components exist and how widely are they used?
   - Inventory all reusable UI components (especially atoms: Button/Input/Select/Card/Badge/Modal)
   - For each component: primary props, supported variants, and **usage count** across the repo

3. Where is style drift happening?
   - Find fonts, colors, sizes, spacing, radius, shadows that are hardcoded and not derived from tokens

4. Where are “rogue” elements shadowing the component library?
   - Identify repeated JSX structures that mimic existing components but are built from raw HTML/classes
   - Cluster similar patterns and capture them as **Proposed Variants** (do not replace yet)

5. How do we safely visualize everything?
   - Create a **dev-only** Style Review Surface that shows:
     - Official components (all variants)
     - Proposed variants found in the audit, rendered side-by-side with the closest official component

6. How do we enforce this after the audit?
   - Create `/docs/STYLEGUIDE.md` as the mandatory UI source-of-truth
   - Update `CLAUDE.md` so Claude Code must reference STYLEGUIDE.md for any UI work
   - (Optional follow-up) add lint/CI rules to prevent drift from returning

---

## 3. CONFIRM MODIFICATIONS WITH ME

spawn **elite-code-architect** and **react-nextjs-reviewer** to perform the audit first.

If findings seem incomplete, return to **## 2. QUESTIONS / OBJECTIVES** and scan again with improved coverage.

Organize findings for review:
- Provide a summary + metrics
- Provide top drift offenders (file paths + examples)
- Provide top rogue element clusters (grouped)
- Provide a proposed variant map (what should become variants of what)

---

## 4. DEVELOP A PLAN IF THE CHANGES ARE OKAY

### Phase A — Audit Only (NO UI refactors)
- Extract tokens + conventions and document them
- Inventory components and usage counts
- Produce drift report + rogue element clusters
- Create Proposed Variant definitions (code-only additions, no replacements)

### Phase B — Style Review Surface (Dev-only)
Choose ONE approach:
- **Option A: Storybook** (recommended for isolation), OR
- **Option B: Dev-only Route** (guarded, excluded from production builds)

### Phase C — Enforcement
- Finalize `/docs/STYLEGUIDE.md`
- Update `CLAUDE.md` to enforce: “No arbitrary Tailwind values or inline styles except approved exceptions”
- (Optional) Add lint rules / CI checks:
  - Fail on Tailwind arbitrary values (e.g., `text-[#...]`, `px-[...]`)
  - Fail on inline style usage (except explicit allowlist)
  - Warn when raw `<button>` appears outside approved wrappers

### Phase D — Consolidation (Follow-up tasks; NOT in this task)
After review decisions:
- Merge/standardize variants
- Refactor pages to use components
- Remove duplicate “Button-like” implementations

---

## 5. SAFTEY

- This task is **not** a production UI refactor.
- Do **not** delete or replace existing drift/rogue UI in production screens yet.
- Additions must be isolated:
  - Proposed variants live in a dedicated folder
  - Style Review Surface must be dev-only (not navigable in production)
- Work in a branch and keep changes small and reviewable.
- Ensure no routing/nav changes leak into production.

---

## 6. EXECUTE

### Agent assignments (must use my agents)
- have **elite-code-architect**:
  - Identify style token sources (Tailwind config, CSS vars, theme providers)
  - Extract palette, typography, spacing/radius/shadow rules
  - Define “approved scales” and “approved exceptions”
  - Draft `/docs/STYLEGUIDE.md` rules for future enforcement

- have **react-nextjs-reviewer**:
  - Build the reusable component inventory and usage counts
  - Detect rogue elements and cluster repeated patterns
  - Map each cluster to a “closest official component”
  - Implement Proposed Variants in an isolated folder
  - Build the Style Review Surface to render official + proposed variants side-by-side

*(Optional)* if theme or UI tokens are stored in Supabase or remote config:
- have **database-architect** document those sources (audit-only)

If an agent cannot be used in the environment, proceed without it and explicitly document what was skipped and why.

### Audit criteria (what “good” looks like)
#### A) Style drift detection (must scan for)
- Tailwind arbitrary values:
  - `text-[#...]`, `bg-[#...]`, `border-[#...]`
  - `px-[...]`, `gap-[...]`, `w-[...]`, `h-[...]`
  - `rounded-[...]`, `leading-[...]`, `shadow-[...]`
- Inline styles:
  - `style={{ ... }}`
- Raw hex colors in CSS:
  - `#RRGGBB`, `rgba(...)` not mapped to tokens
- Off-scale sizes:
  - `13px`, `18px`, `22px` (not tokenized)
- Font usage outside the typography system:
  - ad-hoc `font-family`, inconsistent `font-weight`, unusual line heights

#### B) Rogue element detection (must scan for)
- Raw `<button>` usage where `<Button />` exists
- Raw `<input>`, `<select>`, `<textarea>` where form components exist
- “Card-like” containers repeated via `<div>` + class strings
- Multiple local button components with overlapping intent (`PrimaryButton`, `SubmitButton`, etc.)

#### C) Variant capture (must do this instead of refactoring)
For each rogue cluster:
- Do not replace production usage
- Add a **Proposed Variant** (or a small set) with:
  - Variant name (temporary)
  - Differences vs official
  - Count of occurrences
  - Recommendation: keep / merge / delete (pending human review)

### Required metrics (must report)
- **Component Adoption %**:
  - % of UI atoms (Button/Input/Card/etc.) using design-system components vs raw HTML patterns in key screens
- **Drift Rate**:
  - counts of: arbitrary Tailwind values, inline styles, raw hex values, off-scale px values
- **Duplication Clusters**:
  - number of repeated “button-like”, “input-like”, “card-like” patterns (≥ N occurrences)

---

## 7. IMPLEMENTATION NOTES

**Investigation Date:** 2026-01-11

### Recommended output files
- `/docs/STYLEGUIDE.md` (enforcement reference)
- `/docs/UI_AUDIT_2026-01-11.md` (raw findings + clusters + metrics)
- (Optional) `/docs/STYLE_REVIEW_DECISIONS.md` (your decisions after review)

### Recommended folder structure (choose one)
**Option A: Storybook (preferred)**
- `/.storybook/*`
- `/src/components/ui/*` (official components)
- `/src/design-system/proposed-variants/*`
- `/src/design-system/style-review/*` (stories / renderers)
- `/docs/STYLEGUIDE.md`

**Option B: Dev-only route**
- `/src/app/(dev)/style-review/page.tsx` (or equivalent)
- `/src/design-system/proposed-variants/*`
- Guard route to non-production only; do not add to navigation

---

## Recommended Prompt for Claude Code (copy/paste)

"Enter Plan Mode. I want to use the elite-code-architect and react-nextjs-reviewer agents for this task.

Audit Style Drift: Find every instance of fonts, colors, spacing/sizing, radius, and shadows that are hardcoded and not using our global tokens/theme/Tailwind scales. Include Tailwind arbitrary values (e.g., text-[#...], px-[...]) and inline styles.

Component Inventory: Create an inventory of all reusable UI components (especially Button/Input/Select/Card/Modal/etc.) and include usage counts across the repo.

Find Rogue Elements: Identify repeated UI patterns built with raw HTML/classes that should be components.

Visualize Variants: Do not replace production code yet. Instead, capture rogue patterns as Proposed Variants and build a dev-only Style Review Surface (Storybook or gated dev route) that renders official components next to proposed variants.

Report Metrics: Component Adoption %, Drift Rate counts, Duplication Clusters count.

Documentation: Save `/docs/STYLEGUIDE.md` (enforcement rules) and `/docs/UI_AUDIT_2026-01-11.md` (raw findings + examples). Update `CLAUDE.md` to require consulting STYLEGUIDE.md for UI work."

---
