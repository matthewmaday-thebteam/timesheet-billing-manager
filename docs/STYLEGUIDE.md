# Timesheet Billing Manager - Style Guide

**Version:** 1.4.0
**Last Updated:** 2026-01-11 (Task 018)
**Status:** ENFORCED

This document is the mandatory source of truth for all UI development. Claude Code MUST reference this guide before implementing any UI changes.

---

## Table of Contents

1. [Design Tokens](#design-tokens)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing](#spacing)
5. [Component Library](#component-library)
6. [Approved Global Patterns](#approved-global-patterns)
7. [Enforcement Rules](#enforcement-rules)
8. [Migration Guide](#migration-guide)

---

## Design Tokens

### Token Configuration

Design tokens are defined in `src/index.css` using Tailwind CSS v4's `@theme` directive.

**Full Token Reference (Task 014):**

```css
@theme {
  /* Vercel Gray Scale */
  --color-vercel-gray-50: #fafafa;
  --color-vercel-gray-100: #eaeaea;
  --color-vercel-gray-200: #999999;
  --color-vercel-gray-300: #888888;
  --color-vercel-gray-400: #666666;
  --color-vercel-gray-500: #333333;
  --color-vercel-gray-600: #000000;

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
  --color-warning-light: #FFF7ED;
  --color-warning-border: #FFEDD5;
  --color-warning-text: #9A3412;

  /* Semantic - Info */
  --color-info: #4338CA;
  --color-info-light: #EEF2FF;
  --color-info-border: #C7D2FE;

  /* Brand / Mesh Gradient */
  --color-brand-indigo: #667eea;
  --color-brand-purple: #764ba2;
  --color-mesh-1 through --color-mesh-4

  /* Typography */
  --font-size-2xs: 10px;
  --font-size-xs through --font-size-2xl

  /* Shadows */
  --shadow-vercel-dropdown, --shadow-modal, --shadow-elevated, --shadow-card

  /* Radius */
  --radius-sm through --radius-full
}
```

### Using Tokens

Always use token-based classes instead of arbitrary values:

```tsx
// DO: Use token classes
<div className="bg-vercel-gray-50 border-vercel-gray-100">

// DON'T: Use arbitrary values
<div className="bg-[#FAFAFA] border-[#EAEAEA]">
```

---

## Color System

### Core Palette

| Token | Value | CSS Variable | Tailwind Class | Usage |
|-------|-------|--------------|----------------|-------|
| Black | `#000000` | `--color-black` | `text-black`, `bg-black` | Primary text, buttons |
| White | `#FFFFFF` | `--color-white` | `text-white`, `bg-white` | Backgrounds, inverted text |
| Gray 50 | `#FAFAFA` | `--color-vercel-gray-50` | `bg-vercel-gray-50` | Page backgrounds, hover states |
| Gray 100 | `#EAEAEA` | `--color-vercel-gray-100` | `border-vercel-gray-100` | Borders, dividers |
| Gray 200 | `#999999` | `--color-vercel-gray-200` | `text-vercel-gray-200` | Hover borders |
| Gray 400 | `#666666` | `--color-gray-400` | `text-[#666666]` | Secondary text (TODO: add token) |
| Gray 500 | `#333333` | `--color-gray-500` | `bg-[#333333]` | Button hover (TODO: add token) |

### Semantic Colors

| Intent | Token | Value | Usage |
|--------|-------|-------|-------|
| Error | `--color-error` | `#EE0000` | Error messages, danger buttons |
| Error Hover | `--color-error-hover` | `#CC0000` | Danger button hover |
| Error Light | `--color-error-light` | `#FEF2F2` | Error backgrounds |
| Error Border | `--color-error-border` | `#FECACA` | Error borders |
| Success | `--color-success` | `#50E3C2` | Success indicators |
| Success Light | `--color-success-light` | `#F0FDF4` | Success backgrounds |
| Success Text | `--color-success-text` | `#166534` | Success text |
| Warning | `--color-warning` | `#F5A623` | Warning indicators |
| Warning Light | `--color-warning-light` | `#FFF7ED` | Warning backgrounds |
| Warning Text | `--color-warning-text` | `#9A3412` | Warning text |

### Brand Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-brand-indigo` | `#667eea` | Accent, gradients |
| `--color-brand-purple` | `#764ba2` | Accent, gradients |

### Color Usage Rules

1. **DO** use semantic color names for states (error, success, warning)
2. **DO** use Vercel gray scale for neutrals
3. **DON'T** use raw hex values in component code
4. **DON'T** mix Tailwind default grays with Vercel grays

---

## Typography

### Font Scale

| Name | Size | Tailwind | Usage |
|------|------|----------|-------|
| 2xs | 10px | `text-[10px]` | Fine print, table cells |
| xs | 12px | `text-xs` | Small labels, meta text |
| sm | 14px | `text-sm` | Body text |
| base | 16px | `text-base` | Default |
| lg | 18px | `text-lg` | Section titles |
| xl | 20px | `text-xl` | Page titles |
| 2xl | 24px | `text-2xl` | Large headings |

### Font Weights

| Weight | Tailwind | Usage |
|--------|----------|-------|
| 400 | `font-normal` | Body text |
| 500 | `font-medium` | Labels, buttons |
| 600 | `font-semibold` | Subheadings |
| 700 | `font-bold` | Headings |

### Typography Rules

1. **DO** use `text-sm` for most body content
2. **DO** use `font-medium` for interactive elements
3. **DON'T** use arbitrary font sizes outside the scale
4. **DON'T** mix text sizes inconsistently in the same context

---

## Spacing

### Spacing Scale

Use Tailwind's default spacing scale:

| Value | Pixels | Common Usage |
|-------|--------|--------------|
| 1 | 4px | Tight gaps |
| 2 | 8px | Small padding |
| 3 | 12px | Medium padding |
| 4 | 16px | Standard padding |
| 6 | 24px | Large padding |
| 8 | 32px | Section spacing |

### Spacing Rules

1. **DO** use standard Tailwind spacing values
2. **DO** use consistent spacing within components
3. **DON'T** use arbitrary spacing like `px-[17px]`
4. **EXCEPTION** allowed: Layout-critical positioning (e.g., `bottom-[9px]` for indicators)

---

## Component Library

### Official Atoms

| Component | File | Status | Task |
|-----------|------|--------|------|
| Avatar | `src/components/Avatar.tsx` | Official | - |
| Select | `src/components/Select.tsx` | Official | - |
| Modal | `src/components/Modal.tsx` | Official | - |
| MetricCard | `src/components/MetricCard.tsx` | Official | - |
| DropdownMenu | `src/components/DropdownMenu.tsx` | Official | - |
| NavItem | `src/components/NavItem.tsx` | Official | - |
| **Button** | `src/components/Button.tsx` | **Official** | Task 014 |
| **Spinner** | `src/components/Spinner.tsx` | **Official** | Task 014 |
| **Input** | `src/components/Input.tsx` | **Official** | Task 015 |
| **Card** | `src/components/Card.tsx` | **Official** | Task 015 |
| **Badge** | `src/components/Badge.tsx` | **Official** | Task 015 |
| **DatePicker** | `src/components/DatePicker.tsx` | **Official** | Task 018 |
| **AccordionNested** | `src/components/AccordionNested.tsx` | **Official** | Task 018 |
| **AccordionFlat** | `src/components/AccordionFlat.tsx` | **Official** | Task 018 |

### Button Component

```tsx
import { Button } from '@/components/Button';

// Variants: primary, secondary, ghost, danger
// Sizes: sm, md, lg
<Button variant="primary" size="md">Save</Button>
<Button variant="danger">Delete</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

### Spinner Component

```tsx
import { Spinner } from '@/components/Spinner';

// Sizes: sm, md, lg
// Colors: default, white
<Spinner />
<Spinner size="lg" />
<Spinner color="white" /> // For dark backgrounds
```

### Input Component

```tsx
import { Input } from '@/components/Input';

// Sizes: sm, md, lg
// Features: label, error, helperText, disabled
<Input label="Email" type="email" placeholder="you@example.com" />
<Input label="Password" type="password" error="Password is required" />
<Input label="Name" helperText="Enter your full name" />
<Input size="sm" placeholder="Small input" />
<Input disabled value="Read only" />
```

### Card Component

```tsx
import { Card } from '@/components/Card';

// Variants: default, elevated, bordered, subtle
// Padding: none, sm, md, lg
<Card>Default card content</Card>
<Card variant="elevated" padding="lg">Elevated card</Card>
<Card variant="bordered">Bordered card</Card>
<Card variant="subtle">Subtle background card</Card>
```

### Badge Component

```tsx
import { Badge } from '@/components/Badge';

// Variants: default, success, warning, error, info
// Sizes: sm, md
<Badge>Default</Badge>
<Badge variant="success">Active</Badge>
<Badge variant="error">Failed</Badge>
<Badge variant="warning" size="sm">Pending</Badge>
<Badge variant="info">Holiday</Badge>
```

### DatePicker Component

```tsx
import { DatePicker } from '@/components/DatePicker';

// Standard date input with calendar icon
<DatePicker
  value="2026-01-11"
  onChange={(value) => console.log(value)}
  placeholder="Select date"
/>
```

### AccordionNested Component

```tsx
import { AccordionNested } from '@/components/AccordionNested';
import type { AccordionNestedLevel2Item } from '@/components/AccordionNested';

// 3-level hierarchy: Project → Resource → Task
// Left border line indicates hierarchy depth
const items: AccordionNestedLevel2Item[] = [
  {
    id: 'resource-1',
    label: 'Resource Name',
    value: '40.0h',
    children: [
      {
        id: 'task-1',
        label: 'Task Name',
        value: '8.5h',
        details: ['1/9: 8.5h', '1/8: 7.8h'],
      },
    ],
  },
];

<AccordionNested
  header={<h3>Project Name</h3>}
  headerRight={<span>64.5h total</span>}
  items={items}
  defaultExpanded={false}
/>
```

### AccordionFlat Component

```tsx
import { AccordionFlat } from '@/components/AccordionFlat';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatFooterCell } from '@/components/AccordionFlat';

// 2-level accordion with table content
// Used for billing rates pattern
const columns: AccordionFlatColumn[] = [
  { key: 'project', label: 'Project', width: 'flex-1' },
  { key: 'rate', label: 'Rate', width: 'w-24', align: 'right' },
];

const rows: AccordionFlatRow[] = [
  {
    key: 'row-1',
    cells: [
      { columnKey: 'project', content: 'Project A' },
      { columnKey: 'rate', content: '$125.00' },
    ],
  },
];

<AccordionFlat
  title="Billing Rates"
  columns={columns}
  rows={rows}
  footer={footerCells}
  defaultExpanded={true}
/>
```

### Proposed Atoms (All Promoted)

All proposed atoms have been promoted to official components in Tasks 014-015:

| Original | Promoted To | Task |
|----------|-------------|------|
| ProposedButton | Button | 014 |
| ProposedSpinner | Spinner | 014 |
| ProposedInput | Input | 015 |
| ProposedCard | Card | 015 |
| ProposedBadge | Badge | 015 |

*Legacy proposed variant files in `src/design-system/proposed-variants/` will be removed in Task 016.*

### Component Usage Rules

1. **DO** use existing components from the library
2. **DO** check proposed variants before creating new patterns
3. **DON'T** create inline button/input/card patterns
4. **DON'T** duplicate component functionality with raw HTML

---

## Approved Global Patterns

### MeshGradientBackground

**File:** `src/design-system/patterns/MeshGradientBackground.tsx`

A full-screen animated background with organic mesh gradient.

**Properties:**
- `duration`: Animation duration in seconds (default: 20)
- `blur`: Blur intensity in pixels (default: 80)
- `opacity`: Opacity 0-1 (default: 0.6)

**Usage:**
```tsx
import { MeshGradientBackground } from '@/design-system/patterns/MeshGradientBackground';

function Layout({ children }) {
  return (
    <div className="relative">
      <MeshGradientBackground />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
```

**Rules:**
- DO place as first child of layout container
- DO ensure content above has `position: relative` and `z-index`
- DON'T override colors with raw hex values
- DON'T nest multiple instances
- DON'T use in scrollable containers

---

## Enforcement Rules

### Automated Enforcement (Task 017)

ESLint rules automatically enforce design token compliance:

```bash
# Check for design token violations
npm run lint:tokens

# Full CI check (TypeScript + token linting)
npm run ci:check
```

**CI Pipeline:** Vercel builds automatically run `npm run ci:check` before build. Deployments will **fail** if arbitrary hex colors are detected.

### Mandatory Before UI Work

Claude Code MUST:
1. Read this STYLEGUIDE.md before any UI implementation
2. Use existing components from the library
3. Follow the color and typography tokens
4. Check proposed variants before creating new patterns

### Prohibited Patterns

The following are NOT allowed without explicit approval:

1. **Arbitrary Tailwind Values**
   - `text-[#RRGGBB]`
   - `bg-[#RRGGBB]`
   - `border-[#RRGGBB]`
   - `px-[Npx]` (except documented exceptions)

2. **Inline Styles**
   - `style={{ color: '#...' }}`
   - `style={{ backgroundColor: '#...' }}`
   - Exception: Dynamic positioning (dropdown/modal placement)

3. **Raw HTML Elements**
   - Raw `<button>` where `Button` component exists
   - Raw `<input>` where `Input` component exists
   - Raw "card-like" `<div>` patterns

### Approved Exceptions

| Pattern | Reason | Location |
|---------|--------|----------|
| `bottom-[9px]` | NavItem indicator positioning | NavItem.tsx |
| `h-[2px]` | NavItem indicator height | NavItem.tsx |
| `max-h-[90vh]` | Modal height constraint | Modal.tsx |
| `max-h-[500px]` | UnderHoursModal list height | UnderHoursModal.tsx |
| `max-w-[200px]` | Task name truncation | UnderHoursModal.tsx |
| `min-w-[120px]` | Month label width | DateRangeFilter.tsx |
| `z-[1000]` | Modal z-index stacking | Modal.tsx |
| `border-[3px]` | Spinner border width | Spinner.tsx |
| `text-[10px]`, `text-[11px]` | Fine print text | Various (should use text-2xs) |
| `style={{ position, top, left }}` | Dynamic dropdown positioning | DropdownMenu.tsx, Select.tsx |
| `style={{ boxShadow }}` | Complex shadow values | Modal.tsx, DropdownMenu.tsx |

### Adding New Exceptions

To add a new approved exception:

1. **Justify the need** - Document why a design token cannot be used
2. **Add to ESLint allowlist** - Update `eslint.config.js` header comment
3. **Add to this table** - Document in Approved Exceptions above
4. **Add inline comment** - Explain the exception at the code location:

```tsx
{/* eslint-disable-next-line no-restricted-syntax -- NavItem indicator requires precise positioning */}
<div className="-bottom-[9px]" />
```

### Exception Process for Hex Colors

If you absolutely need an arbitrary hex color (should be rare):

```tsx
// eslint-disable-next-line no-restricted-syntax -- [Your justification here]
<div className="bg-[#SPECIAL_COLOR]" />
```

**Note:** Hex color exceptions require strong justification. In most cases, you should:
1. Add the color to `@theme` in `src/index.css`
2. Use the new token class instead

---

## Migration Guide

### Phase 1: Token Adoption (Current)

Extend `src/index.css` with all colors:

```css
@theme {
  /* Existing */
  --color-vercel-gray-50: #fafafa;
  --color-vercel-gray-100: #eaeaea;
  --color-vercel-gray-200: #999999;

  /* Add these */
  --color-gray-400: #666666;
  --color-gray-500: #333333;
  --color-error: #EE0000;
  --color-error-hover: #CC0000;
  --color-error-light: #FEF2F2;
  --color-success: #50E3C2;
  --color-success-light: #F0FDF4;
  --color-warning: #F5A623;
  --color-warning-light: #FFF7ED;
  --color-brand-indigo: #667eea;
  --color-brand-purple: #764ba2;
}
```

### Phase 2: Component Promotion

After review, promote proposed variants to official components:
1. Move from `src/design-system/proposed-variants/` to `src/components/`
2. Update imports across codebase
3. Remove raw HTML patterns

### Phase 3: Drift Cleanup

Replace hardcoded values with tokens:
1. Search for `bg-[#` and replace with token classes
2. Search for `text-[#` and replace with token classes
3. Search for `border-[#` and replace with token classes

---

## Style Review Surface

Access the Style Review Surface in development mode:

```
http://localhost:5173/?style-review=true
```

This displays:
- Design tokens visualization
- Official component showcase
- Proposed variants comparison
- Global patterns preview

**Note:** This route is disabled in production builds.

---

## Changelog

### v1.4.0 (2026-01-11) - Task 018
- Added AccordionNested component for 3-level project hierarchy
- Added AccordionFlat component for billing rates table pattern
- Dashboard now uses reusable components throughout
- MetricCard updated with mono-xs label typography
- StatsOverview refactored to use MetricCard component
- DateRangeFilter refactored to use Button and DatePicker components
- AccordionNested: border aligned with level 1 title, proper hour colors (black L2, gray-200 L3)

### v1.3.0 (2026-01-11) - Task 017
- Added ESLint rules for design token enforcement
- CI pipeline now fails on arbitrary hex colors
- Added `npm run lint:tokens` and `npm run ci:check` scripts
- Vercel builds enforce token compliance before deployment
- Documented exception process for approved overrides

### v1.2.0 (2026-01-11) - Task 015
- Promoted Input component with label, error, helperText support
- Promoted Card component with 4 variants and padding options
- Promoted Badge component with 5 semantic variants
- Migrated DatePicker to Vercel gray scale
- All proposed variants now promoted to official atoms
- Created Atomic Consistency Report

### v1.1.0 (2026-01-11) - Task 014
- Extended @theme tokens with full color palette
- Promoted Button component with 4 variants
- Promoted Spinner component with 3 sizes
- Updated MeshGradientBackground to use token variables

### v1.0.0 (2026-01-11)
- Initial style guide created from UI audit
- Documented existing token system
- Cataloged component library
- Created proposed variants for missing atoms
- Implemented MeshGradientBackground pattern
- Established enforcement rules
