# Task 041: Checkbox Atom — MUI-Inspired, with Label Variants

**Status:** Complete
**Stack:** React, TypeScript, Tailwind CSS
**Date:** 2026-02-12

## Scope

Create a reusable Checkbox atom inspired by Material UI's visual design (clean filled box with SVG check/indeterminate marks, smooth transitions) but implemented in pure Tailwind — no MUI dependency. Replace all inline checkboxes in RevenuePage modals with the new atom.

## Files Changed

1. **Created** `src/components/Checkbox.tsx` — New atom component
2. **Modified** `src/design-system/style-review/StyleReviewPage.tsx` — Added Checkbox preview in Atoms tab
3. **Modified** `src/components/pages/RevenuePage.tsx` — Replaced inline checkboxes in both modals

## Design

- **Box**: 18px x 18px, 3px border-radius, 2px border
- **Unchecked**: vercel-gray-200 border, white background
- **Checked**: vercel-gray-600 fill, white SVG checkmark
- **Indeterminate**: vercel-gray-600 fill, white horizontal dash
- **Disabled**: 50% opacity, cursor-not-allowed
- **Focus**: ring-1 ring-black (matches Button/Toggle)
- **Hover**: border darkens to vercel-gray-400
- **Transition**: 150ms ease on background-color and border-color

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| checked | boolean | required | Whether checked |
| onChange | (checked: boolean) => void | required | Change callback |
| label | string | — | Label text |
| description | string | — | Secondary text below label |
| indeterminate | boolean | false | Show dash instead of check |
| disabled | boolean | false | Disable interaction |
| className | string | '' | Additional wrapper classes |
| endContent | ReactNode | — | Right-aligned content slot |

## Verification

- [x] Checkbox renders correct visual states: unchecked, checked, indeterminate, disabled
- [x] Label click toggles the checkbox (native label wraps input)
- [x] endContent renders right-aligned (revenue amounts)
- [x] Focus ring appears on keyboard tab (peer-focus-visible)
- [x] Hover state visible on unchecked checkbox
- [x] Transitions are smooth (150ms)
- [x] Both modals in RevenuePage use the new Checkbox atom
- [x] Checkbox section appears in StyleReviewPage Atoms tab
- [x] `npx tsc --noEmit` passes
