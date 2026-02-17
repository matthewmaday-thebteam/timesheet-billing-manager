import type { SpacingValue } from '../types';

/**
 * Spacing Registry
 *
 * Single source of truth for all allowed spacing values used throughout
 * the application. Any spacing not listed here should not be introduced
 * without updating this registry.
 */

// ---------------------------------------------------------------------------
// Horizontal spacing
// ---------------------------------------------------------------------------

export const horizontalSpacing: SpacingValue[] = [
  {
    name: 'inline-tight',
    value: '4px',
    tailwindClass: 'gap-1',
    axis: 'horizontal',
    usage: 'Tight inline gaps between icons and text (e.g., button icon + label).',
  },
  {
    name: 'inline-icon',
    value: '6px',
    tailwindClass: 'gap-1.5',
    axis: 'horizontal',
    usage: 'Icon-to-text gaps in nav items and small controls.',
  },
  {
    name: 'inline-small',
    value: '8px',
    tailwindClass: 'gap-2',
    axis: 'horizontal',
    usage: 'Small inline gaps between related elements (e.g., badge + text, status dot + value).',
  },
  {
    name: 'inline-medium',
    value: '12px',
    tailwindClass: 'gap-3',
    axis: 'horizontal',
    usage: 'Medium inline gaps between buttons in a group or footer actions.',
  },
  {
    name: 'inline-standard',
    value: '16px',
    tailwindClass: 'gap-4',
    axis: 'horizontal',
    usage: 'Standard gap between cards in a grid row and between form columns.',
  },
  {
    name: 'inline-large',
    value: '24px',
    tailwindClass: 'gap-6',
    axis: 'horizontal',
    usage: 'Large gaps between content grid columns (e.g., table + calendar on HolidaysPage).',
  },
  {
    name: 'padding-small',
    value: '8px',
    tailwindClass: 'px-2',
    axis: 'horizontal',
    usage: 'Tight horizontal padding for pills, small buttons, and compact elements.',
  },
  {
    name: 'padding-input',
    value: '12px',
    tailwindClass: 'px-3',
    axis: 'horizontal',
    usage: 'Standard horizontal padding for inputs, selects, dropdown items, and buttons.',
  },
  {
    name: 'padding-cell',
    value: '16px',
    tailwindClass: 'px-4',
    axis: 'horizontal',
    usage: 'Table cell horizontal padding (compact tables).',
  },
  {
    name: 'padding-container',
    value: '24px',
    tailwindClass: 'px-6',
    axis: 'horizontal',
    usage: 'Page-level horizontal padding and accordion header padding.',
  },
];

// ---------------------------------------------------------------------------
// Vertical spacing
// ---------------------------------------------------------------------------

export const verticalSpacing: SpacingValue[] = [
  {
    name: 'text-gap-tight',
    value: '4px',
    tailwindClass: 'mt-1',
    axis: 'vertical',
    usage: 'Gap between heading and subtitle, label and helper text, title and value in MetricCard.',
  },
  {
    name: 'stack-tight',
    value: '4px',
    tailwindClass: 'space-y-1',
    axis: 'vertical',
    usage: 'Tight vertical stacking of related text lines.',
  },
  {
    name: 'stack-small',
    value: '8px',
    tailwindClass: 'space-y-2',
    axis: 'vertical',
    usage: 'Small vertical spacing between tightly grouped elements.',
  },
  {
    name: 'stack-medium',
    value: '12px',
    tailwindClass: 'space-y-3',
    axis: 'vertical',
    usage: 'Medium vertical spacing for skeleton loaders and form sections.',
  },
  {
    name: 'stack-standard',
    value: '16px',
    tailwindClass: 'space-y-4',
    axis: 'vertical',
    usage: 'Standard vertical spacing between form fields and card sections.',
  },
  {
    name: 'section-gap',
    value: '24px',
    tailwindClass: 'space-y-6',
    axis: 'vertical',
    usage: 'Primary page section gap. Used between header, stats, filters, and content blocks.',
  },
  {
    name: 'section-gap-large',
    value: '32px',
    tailwindClass: 'space-y-8',
    axis: 'vertical',
    usage: 'Dashboard page section gap for more breathing room between major sections.',
  },
  {
    name: 'padding-input',
    value: '8px',
    tailwindClass: 'py-2',
    axis: 'vertical',
    usage: 'Vertical padding for inputs, selects, and dropdown items.',
  },
  {
    name: 'padding-cell-compact',
    value: '12px',
    tailwindClass: 'py-3',
    axis: 'vertical',
    usage: 'Table cell vertical padding (compact).',
  },
  {
    name: 'padding-cell-standard',
    value: '16px',
    tailwindClass: 'py-4',
    axis: 'vertical',
    usage: 'Table cell vertical padding (standard) and modal content areas.',
  },
  {
    name: 'padding-section',
    value: '24px',
    tailwindClass: 'py-6',
    axis: 'vertical',
    usage: 'Accordion header vertical padding.',
  },
  {
    name: 'padding-page',
    value: '32px',
    tailwindClass: 'py-8',
    axis: 'vertical',
    usage: 'Page-level vertical padding (top and bottom of page content).',
  },
  {
    name: 'padding-loading',
    value: '48px',
    tailwindClass: 'py-12',
    axis: 'vertical',
    usage: 'Vertical padding for centered loading spinners and empty states.',
  },
];

// ---------------------------------------------------------------------------
// Combined padding (both axes)
// ---------------------------------------------------------------------------

export const combinedSpacing: SpacingValue[] = [
  {
    name: 'padding-card-sm',
    value: '12px',
    tailwindClass: 'p-3',
    axis: 'both',
    usage: 'Card padding small variant. Compact containers and inline cards.',
  },
  {
    name: 'padding-card-md',
    value: '16px',
    tailwindClass: 'p-4',
    axis: 'both',
    usage: 'Card padding medium variant. Standard cards and info banners.',
  },
  {
    name: 'padding-card-lg',
    value: '24px',
    tailwindClass: 'p-6',
    axis: 'both',
    usage: 'Card padding large variant. MetricCards, accordion headers, chart containers.',
  },
];

/**
 * All spacing values combined for easy iteration.
 */
export const allSpacing: SpacingValue[] = [
  ...horizontalSpacing,
  ...verticalSpacing,
  ...combinedSpacing,
];
