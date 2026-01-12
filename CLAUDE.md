# Claude Code Instructions - Timesheet Billing Manager

## Critical Rules

### UI Development - MANDATORY

Before implementing ANY UI changes:

1. **READ `/docs/STYLEGUIDE.md`** - This is the mandatory source of truth for all UI work
2. **Use existing components** from `src/components/` - Check before creating new patterns
3. **Check proposed variants** in `src/design-system/proposed-variants/` before duplicating patterns
4. **Use design tokens** - No arbitrary Tailwind color/spacing values

### Prohibited Patterns

DO NOT use these without explicit user approval:

```tsx
// PROHIBITED: Arbitrary colors
bg-[#RRGGBB]  text-[#RRGGBB]  border-[#RRGGBB]

// PROHIBITED: Inline color styles
style={{ color: '#...' }}
style={{ backgroundColor: '#...' }}

// PROHIBITED: Raw HTML where components exist
<button className="...">  // Use Button component
<input className="...">   // Use Input component (when promoted in Task 015)
```

### Approved Exceptions

These arbitrary values are pre-approved:
- `bottom-[9px]` - NavItem indicator positioning
- `h-[2px]` - NavItem indicator height
- `max-h-[90vh]` - Modal height constraint
- Dynamic positioning in dropdowns/modals via inline styles

### Color Token Usage

Use the Vercel design system colors from `src/index.css`:

| Intent | Token Class |
|--------|-------------|
| Background | `bg-vercel-gray-50` |
| Border | `border-vercel-gray-100` |
| Secondary border | `border-vercel-gray-200` |

For semantic colors, reference `/docs/STYLEGUIDE.md`.

---

## Development Rules

### Local Development Server
- NEVER start a local dev server (`npm run dev`, localhost) unless explicitly requested
- NEVER build locally (`npm run build`) unless explicitly requested
- TypeScript validation (`npx tsc --noEmit`) CAN be run before deploying

### Starting Development (Windows 11)

**Important:** Run from Windows PowerShell/Command Prompt, NOT from WSL. The WSL → Windows filesystem causes permission issues with Vite's dependency cache.

```powershell
# Navigate to project
cd "C:\Users\Matthew\Dropbox\Organizations\Concept Companies\timesheet-billing-manager"

# Clear Vite cache if needed (fixes white screen issues)
rmdir /s /q node_modules\.vite

# Start development server
npm run dev
```

Local server runs at: http://localhost:5173/

### Deployment
- All testing must be done via Vercel deployments
- Only deploy to Vercel when changes are complete
- NEVER create preview deployments - always deploy to production with `vercel --prod`

---

## Style Review Surface

Access the dev-only style review page:
```
http://localhost:5173/?style-review=true
```

This shows all design tokens, official components, and proposed variants.

---

## Quick Reference

### Official Components
- `Avatar` - User avatars
- `Select` - Dropdown selects
- `Modal` - Modal dialogs
- `MetricCard` - Stat display cards
- `DropdownMenu` - Context menus
- `NavItem` - Navigation items
- **`Button`** - Button variants (primary, secondary, ghost, danger) - Task 014
- **`Spinner`** - Loading spinners (sm, md, lg sizes) - Task 014
- **`Input`** - Form inputs with label, error, helperText - Task 015
- **`Card`** - Card containers (default, elevated, bordered, subtle) - Task 015
- **`Badge`** - Status badges (default, success, warning, error, info) - Task 015

### Legacy Proposed Components (To Remove in Task 016)
- `ProposedInput`, `ProposedCard`, `ProposedBadge` - Now promoted to official components

### Documentation
- `/docs/STYLEGUIDE.md` - Full style guide (MUST READ for UI work)
- `/docs/UI_AUDIT_2026-01-11.md` - Audit findings and metrics
- `/docs/FEATURE_INVENTORY.md` - Feature documentation
- `/docs/USER_MANAGEMENT_ARCHITECTURE.md` - Auth/user system docs
