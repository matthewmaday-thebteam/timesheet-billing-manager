# Task 046: Design System Architecture — Atoms, Molecules, Organisms, Animations, Patterns, Spacing

## Status: Complete

## Stack
- React (TypeScript)
- Tailwind CSS

## Scope

Introduce a mature, multi-tier design system architecture to the codebase. This task establishes the **backend classification system only** — folder structure, type definitions, registry files, and documentation. **No frontend/UI changes.** A future task will audit existing components, reclassify them into the new tiers, and build out the style-review preview page.

---

## Taxonomy

### 1. Atoms
The smallest, indivisible UI elements. Rarely displayed independently on a page — they exist to be composed into higher-level constructs.

**Examples:** Button, Input, Select, Toggle, Spinner, Badge, ChevronIcon, Avatar

### 2. Molecules
Collections of atoms organized with a specific intent. A molecule has a single, focused responsibility that emerges from the combination of its parts.

**Examples:** DateCycle (chevron + label + chevron), RangeSelector (buttons + date display + export dropdown), MetricCard (title text + value text + optional dot + optional button)

### 3. Organisms
Collections of molecules (and possibly atoms) composed for a specific on-screen purpose. Organisms are what users actually see and interact with as coherent sections of a page.

**Examples:**
- **HolidayTable organism** — headline ("Country and Company Holidays") + subhead + column header row + data rows
- **StatsOverview organism** — a row of MetricCard molecules
- **EmployeePerformance organism** — header + filters + accordion list of employee data
- **BillingRatesTable organism** — header + column headers + editable rate rows

### 4. Animations
Reusable animation definitions (keyframes, transitions, timing functions) used across the system. Centralized so motion is consistent and predictable.

**Examples:** fade-in, slide-up, skeleton pulse, spinner rotation, accordion expand/collapse, tooltip appear

### 5. Design Patterns
Rules and conventions that dictate how elements are composed visually. These are not components themselves but the standards components must follow.

**Covers:**
- **Typography patterns** — Which font weight, size, and color token to use for page headings, section headings, subheads, body text, captions, labels
- **Spacing patterns** — Consistent gaps between heading and content, between sections, between cards in a grid, inside cards
- **Color patterns** — When to use brand color vs. gray-600 vs. gray-400; status color rules (success, warning, error)
- **Layout patterns** — Max-width containers, grid column conventions, responsive breakpoints

### 6. Spacing
A reference of all allowed spacing values (horizontal and vertical) used throughout the application. This becomes the single source of truth so arbitrary spacing doesn't creep in.

**Covers:**
- Horizontal spacing (padding, gaps, margins)
- Vertical spacing (section gaps, element gaps, internal padding)
- Responsive spacing adjustments

---

## Deliverables

### A. Folder Structure

Create the following directory structure under `src/design-system/`:

```
src/design-system/
  registry/
    atoms.ts          # Registry of all atom components with metadata
    molecules.ts      # Registry of all molecule components with metadata
    organisms.ts      # Registry of all organism components with metadata
    animations.ts     # Registry of all animation definitions
    patterns.ts       # Registry of design pattern rules
    spacing.ts        # Registry of allowed spacing values
    index.ts          # Barrel export
  types.ts            # TypeScript types for the registry system
```

### B. Type Definitions (`types.ts`)

Define TypeScript interfaces for each registry entry:

```ts
interface DesignSystemEntry {
  name: string;
  description: string;
  tier: 'atom' | 'molecule' | 'organism';
  filePath: string;           // relative path to component file
  composedOf?: string[];      // names of lower-tier components it uses
  usedIn?: string[];          // names of higher-tier components or pages that use it
}

interface AnimationEntry {
  name: string;
  description: string;
  cssClass?: string;          // Tailwind class or custom class
  keyframes?: string;         // keyframe definition reference
  duration: string;           // e.g. "200ms", "300ms"
  easing: string;             // e.g. "ease-out", "ease-in-out"
}

interface PatternEntry {
  name: string;
  category: 'typography' | 'spacing' | 'color' | 'layout';
  description: string;
  rules: string[];            // human-readable rules
  tokens: string[];           // associated design token classes
}

interface SpacingValue {
  name: string;               // e.g. "section-gap", "card-padding"
  value: string;              // e.g. "24px", "1.5rem"
  tailwindClass: string;      // e.g. "gap-6", "p-6", "space-y-6"
  usage: string;              // description of when to use
}
```

### C. Registry Files

Populate each registry with the **current** components/patterns already in the codebase. This is a cataloging exercise — documenting what exists today under the new taxonomy.

**atoms.ts** — Catalog all current atoms: Button, Input, Select, Toggle, Spinner, Badge, Card, ChevronIcon, Avatar, Modal

**molecules.ts** — Catalog current molecules: DateCycle, RangeSelector, MetricCard

**organisms.ts** — Catalog current organisms (these are currently unclassified page-section components): StatsOverview, EmployeePerformance, BillingRatesTable, HolidayTable, HolidayCalendar, ResourceTable, UserTable, BurnGrid, DashboardChartsRow, etc.

**animations.ts** — Catalog any existing animations/transitions (spinner rotation, modal fade, tooltip transitions, accordion expand)

**patterns.ts** — Document the current de facto patterns observed in the codebase (page heading typography, section spacing, card grid layouts, status color usage)

**spacing.ts** — Extract all spacing values currently used and catalog them as the allowed set

### D. Documentation

Update `docs/STYLEGUIDE.md` with a new section documenting the tier system (Atoms -> Molecules -> Organisms) and the new categories (Animations, Design Patterns, Spacing). Reference the registry files as the authoritative source.

---

## Steps

1. Create `src/design-system/types.ts` with all TypeScript interfaces
2. Create `src/design-system/registry/` directory
3. Create `atoms.ts` — audit `src/components/` and catalog all atomic components
4. Create `molecules.ts` — audit `src/components/molecules/` and any other molecule-level components
5. Create `organisms.ts` — audit page-section components and catalog as organisms
6. Create `animations.ts` — audit CSS/Tailwind for existing animation usage
7. Create `patterns.ts` — document current typography, spacing, color, and layout conventions
8. Create `spacing.ts` — extract and catalog all spacing values in use
9. Create `index.ts` barrel export
10. Update `docs/STYLEGUIDE.md` with tier system documentation
11. `npx tsc --noEmit` passes

## Constraints

- **NO frontend/UI code changes** — Do not modify any existing component, page, or style
- **NO component file moves or renames** — Physical file reorganization is a separate future task
- **Registry only** — This is a cataloging and type-definition exercise
- Backend system files only — the style-review preview page will be updated in a future task to render these registries

## Verification

- [ ] `src/design-system/types.ts` exists with all interfaces
- [ ] `src/design-system/registry/` contains all 7 files (atoms, molecules, organisms, animations, patterns, spacing, index)
- [ ] Every existing component in `src/components/` is cataloged in the appropriate registry
- [ ] Spacing registry covers all spacing values currently in use
- [ ] Animation registry covers all transitions/keyframes currently in use
- [ ] Pattern registry documents current typography, color, spacing, and layout conventions
- [ ] `docs/STYLEGUIDE.md` updated with tier system section
- [ ] No existing component, page, or style files were modified
- [ ] `npx tsc --noEmit` passes
