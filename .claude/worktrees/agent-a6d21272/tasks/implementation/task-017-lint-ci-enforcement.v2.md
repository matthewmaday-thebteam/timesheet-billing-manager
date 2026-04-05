# Task 017: Lint Rules & CI Enforcement for Style Consistency

**Status:** PENDING

**Depends on:** Task 016 (Drift Cleanup)

**Priority:** Low - Prevention layer after cleanup is complete

---

## 0. v2 Amendments (January 11, 2026)

This task is updated to reduce tooling risk and improve enforceability:

- **Tailwind Version Check:** Before implementing rules, confirm the project’s Tailwind major version and choose the enforcement approach accordingly (plugin vs custom rules).
- **Explicit Exceptions Mechanism:** Introduce an allowlist/escape hatch that requires a short justification (e.g., `/* style-exception: reason */`) and is tracked in `STYLEGUIDE.md`.
- **CI Enforcement:** CI must fail on new drift unless explicitly allowlisted, and should report violations with file paths and counts.


## 1. Problem Statement

After Tasks 014-016 clean up the codebase, we need automated enforcement to prevent style drift from returning. Without lint rules and CI checks, developers (including Claude Code) may reintroduce arbitrary values.

**Current State (post Task 016):**
- Clean codebase using design system
- No automated enforcement
- STYLEGUIDE.md and CLAUDE.md provide guidance but not enforcement
- Risk of drift returning over time

**Target State:**
- ESLint rules prevent arbitrary Tailwind values
- CI pipeline fails on style violations
- Automated warnings for raw HTML atoms
- Self-documenting enforcement

---

## 2. OBJECTIVES

1. **Configure ESLint rules** for Tailwind arbitrary value detection
2. **Add CI check** that fails builds with style violations
3. **Create custom rule** for raw HTML atom detection (optional)
4. **Document exception process** for approved overrides

---

## 3. CONFIRM MODIFICATIONS WITH ME

Before implementing, confirm:
- ESLint is preferred over Stylelint for this codebase
- CI environment (GitHub Actions, Vercel checks, etc.)
- Severity levels (error vs warning)
- Exception handling approach (eslint-disable comments vs config)

### Rule Severity Options

**Option A: Strict (Recommended)**
- Arbitrary colors: ERROR
- Arbitrary spacing: WARNING
- Raw HTML atoms: WARNING

**Option B: Gradual**
- All violations: WARNING initially
- Upgrade to ERROR after stabilization

---

## 4. DEVELOP A PLAN IF THE CHANGES ARE OKAY

### Step 1: Install Dependencies

```bash
npm install -D eslint-plugin-tailwindcss
```

### Step 2: Configure ESLint

Update `eslint.config.js`:

```javascript
import tailwindcss from 'eslint-plugin-tailwindcss';

export default [
  // ... existing config
  {
    plugins: {
      tailwindcss,
    },
    rules: {
      // Enforce class order for consistency
      'tailwindcss/classnames-order': 'warn',

      // Warn on arbitrary values (we'll customize this)
      'tailwindcss/no-arbitrary-value': ['error', {
        // Allow specific exceptions
        allow: [
          'bottom-\\[9px\\]',   // NavItem indicator
          'h-\\[2px\\]',        // NavItem indicator
          'max-h-\\[90vh\\]',   // Modal height
          'max-h-\\[500px\\]',  // UnderHoursModal
          'max-w-\\[200px\\]',  // Task name truncation
          'min-w-\\[120px\\]',  // Month label
        ],
      }],

      // Enforce consistent negative values
      'tailwindcss/enforces-negative-arbitrary-values': 'warn',

      // Enforce shorthand
      'tailwindcss/enforces-shorthand': 'warn',

      // No contradicting classes
      'tailwindcss/no-contradicting-classname': 'error',
    },
  },
];
```

### Step 3: Create Custom Rule for Raw HTML Atoms (Optional)

Create `eslint-rules/no-raw-atoms.js`:

```javascript
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer design system components over raw HTML atoms',
    },
    messages: {
      useButton: 'Prefer <Button> component over raw <button>',
      useInput: 'Prefer <Input> component over raw <input>',
      useSelect: 'Prefer <Select> component over raw <select>',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const tagName = node.name.name;

        if (tagName === 'button') {
          context.report({ node, messageId: 'useButton' });
        }
        if (tagName === 'input') {
          context.report({ node, messageId: 'useInput' });
        }
        if (tagName === 'select' && !isOurSelectComponent(node)) {
          context.report({ node, messageId: 'useSelect' });
        }
      },
    };
  },
};
```

### Step 4: Add CI Script

Update `package.json`:

```json
{
  "scripts": {
    "lint": "eslint src/",
    "lint:styles": "eslint src/ --rule 'tailwindcss/no-arbitrary-value: error'",
    "ci:lint": "npm run lint -- --max-warnings 0"
  }
}
```

### Step 5: GitHub Actions Workflow (if applicable)

Create `.github/workflows/lint.yml`:

```yaml
name: Lint

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
```

### Step 6: Vercel Build Check (Alternative)

If using Vercel, add to `vercel.json`:

```json
{
  "buildCommand": "npm run lint && npm run build",
  ...
}
```

### Step 7: Document Exception Process

Update `STYLEGUIDE.md` with exception process:

```markdown
## Adding Exceptions

To add a new approved exception:

1. Add to `eslint.config.js` allow list
2. Document in STYLEGUIDE.md "Approved Exceptions" section
3. Add code comment explaining why exception is needed

Example:
```tsx
{/* eslint-disable-next-line tailwindcss/no-arbitrary-value --
    NavItem indicator requires precise positioning */}
<div className="bottom-[9px]" />
```
```

---

## 5. SAFETY

- **DO** test ESLint config locally before committing
- **DO** run on full codebase to catch any remaining violations
- **DO** fix violations before enabling CI enforcement
- **DON'T** enable CI checks until codebase passes locally
- **DON'T** set everything to ERROR initially - use warnings first

### Rollout Strategy

1. **Week 1:** Install and configure, run locally
2. **Week 2:** Fix any remaining violations
3. **Week 3:** Enable CI warnings
4. **Week 4:** Upgrade to CI errors

---

## 6. EXECUTE

### Agent assignments

Use **elite-code-architect** to:
- Design ESLint configuration
- Create custom rule if needed
- Configure CI pipeline

Use **react-nextjs-reviewer** to:
- Test rules against codebase
- Fix any violations found
- Update documentation

### Acceptance criteria

- [ ] `eslint-plugin-tailwindcss` installed
- [ ] ESLint config updated with Tailwind rules
- [ ] All approved exceptions documented
- [ ] `npm run lint` passes with 0 errors
- [ ] CI script added to package.json
- [ ] GitHub Actions workflow (or Vercel check) configured
- [ ] STYLEGUIDE.md updated with exception process

### Files to create/modify

**Create:**
- `.github/workflows/lint.yml` (if using GitHub Actions)
- `eslint-rules/no-raw-atoms.js` (optional)

**Modify:**
- `package.json` (scripts)
- `eslint.config.js`
- `vercel.json` (if adding build check)
- `docs/STYLEGUIDE.md`

---

## 7. IMPLEMENTATION NOTES

### ESLint Plugin Options

**eslint-plugin-tailwindcss** provides:
- `classnames-order` - Consistent class ordering
- `no-arbitrary-value` - Prevents `[...]` syntax
- `no-contradicting-classname` - Catches conflicts
- `no-custom-classname` - Enforces Tailwind-only classes

### Alternative: Regex-based Rule

If plugin doesn't work, use regex pattern:

```javascript
{
  'no-restricted-syntax': [
    'error',
    {
      selector: 'Literal[value=/bg-\\[#|text-\\[#|border-\\[#/]',
      message: 'Use design tokens instead of arbitrary color values',
    },
  ],
}
```

### Handling Legacy Code

For files not yet migrated, use file-level disable:

```tsx
/* eslint-disable tailwindcss/no-arbitrary-value */
// TODO: Migrate to design system (Task 016)
```

---

## Metrics to Track

**Lint Metrics:**
- Total violations: Target 0
- Warnings: Target <10 (approved exceptions)
- CI pass rate: Target 100%

**Drift Prevention:**
- New arbitrary values introduced: Target 0 per sprint
- Exception requests: Track frequency

> Note (v2): Any Style Review Surface (Storybook or route) must be dev-only and must not be linked or enabled in production.
