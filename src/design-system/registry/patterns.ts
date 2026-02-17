import type { PatternEntry } from '../types';

/**
 * Design Pattern Registry
 *
 * Rules and conventions that dictate how elements are composed visually.
 * These are not components — they are the standards components must follow.
 */
export const patterns: PatternEntry[] = [
  // ---------------------------------------------------------------------------
  // Typography patterns
  // ---------------------------------------------------------------------------
  {
    name: 'page-heading',
    category: 'typography',
    description: 'Primary heading displayed at the top of each page.',
    rules: [
      'Use text-xl font-semibold for standard pages',
      'Use text-2xl font-bold for hero/dashboard greeting',
      'Color: text-vercel-gray-600 (black)',
      'Always paired with a subtitle below',
    ],
    tokens: ['text-xl', 'font-semibold', 'text-vercel-gray-600'],
  },
  {
    name: 'page-subtitle',
    category: 'typography',
    description: 'Secondary text below a page heading describing the page purpose.',
    rules: [
      'Use text-sm text-vercel-gray-400',
      'Spacing: mt-1 below heading',
      'May include brand-colored spans for emphasis',
    ],
    tokens: ['text-sm', 'text-vercel-gray-400', 'mt-1'],
  },
  {
    name: 'section-heading',
    category: 'typography',
    description: 'Heading for a section within a page (e.g., card titles, chart titles).',
    rules: [
      'Use text-lg font-semibold text-vercel-gray-600',
      'Spacing: mb-4 below before content',
    ],
    tokens: ['text-lg', 'font-semibold', 'text-vercel-gray-600', 'mb-4'],
  },
  {
    name: 'form-label',
    category: 'typography',
    description: 'Labels for form fields and table column headers.',
    rules: [
      'Use text-xs font-medium text-vercel-gray-400 uppercase tracking-wider',
      'Consistent across all modal forms, table headers, and calendar headers',
    ],
    tokens: ['text-xs', 'font-medium', 'text-vercel-gray-400', 'uppercase', 'tracking-wider'],
  },
  {
    name: 'body-text',
    category: 'typography',
    description: 'Default body text for content areas.',
    rules: [
      'Primary body: text-sm text-vercel-gray-600',
      'Secondary body: text-sm text-vercel-gray-400',
      'Small text: text-xs text-vercel-gray-400',
    ],
    tokens: ['text-sm', 'text-vercel-gray-600', 'text-vercel-gray-400'],
  },
  {
    name: 'monospace-text',
    category: 'typography',
    description: 'Monospace text for IDs, emails, technical values, and metric labels.',
    rules: [
      'Use font-mono with appropriate size',
      'Standard: text-sm font-mono text-vercel-gray-400',
      'Small: text-xs font-mono text-vercel-gray-400',
      'MetricCard labels use mono-xs style',
    ],
    tokens: ['font-mono', 'text-sm', 'text-xs', 'text-vercel-gray-400'],
  },
  {
    name: 'metric-value',
    category: 'typography',
    description: 'Large numeric values displayed in MetricCards and hero headings.',
    rules: [
      'Use text-2xl font-semibold',
      'Default color: text-vercel-gray-600',
      'Warning state: text-warning',
      'Alert state: text-white',
    ],
    tokens: ['text-2xl', 'font-semibold', 'text-vercel-gray-600'],
  },

  // ---------------------------------------------------------------------------
  // Spacing patterns
  // ---------------------------------------------------------------------------
  {
    name: 'page-layout',
    category: 'spacing',
    description: 'Standard page-level spacing and container width.',
    rules: [
      'Container: max-w-7xl mx-auto',
      'Horizontal padding: px-6',
      'Vertical padding: py-8',
      'Section gap: space-y-6 (standard) or space-y-8 (dashboard)',
    ],
    tokens: ['max-w-7xl', 'mx-auto', 'px-6', 'py-8', 'space-y-6'],
  },
  {
    name: 'card-grid',
    category: 'spacing',
    description: 'Grid layout for MetricCard rows and stat displays.',
    rules: [
      'Gap: gap-4 between cards',
      'Columns: grid-cols-2 on mobile, md:grid-cols-4 or md:grid-cols-5 or md:grid-cols-6 depending on count',
      'Cards are equal height within a row',
    ],
    tokens: ['grid', 'grid-cols-2', 'gap-4'],
  },
  {
    name: 'card-internal',
    category: 'spacing',
    description: 'Internal padding within cards and containers.',
    rules: [
      'MetricCard: p-6',
      'Card component: none | p-3 (sm) | p-4 (md) | p-6 (lg)',
      'Accordion headers: p-6',
      'Table cells: px-4 py-3 or px-6 py-4',
    ],
    tokens: ['p-6', 'p-4', 'p-3', 'px-4', 'py-3', 'px-6', 'py-4'],
  },
  {
    name: 'form-spacing',
    category: 'spacing',
    description: 'Spacing within modal forms and input groups.',
    rules: [
      'Field gap: space-y-4 between form fields',
      'Label to input: mb-1',
      'Helper text: mt-1',
      'Modal footer: gap-3 between buttons',
    ],
    tokens: ['space-y-4', 'mb-1', 'mt-1', 'gap-3'],
  },
  {
    name: 'heading-to-content',
    category: 'spacing',
    description: 'Space between a heading and its following content.',
    rules: [
      'Page heading to subtitle: mt-1',
      'Section heading to content: mb-4',
      'MetricCard title to value: mt-1',
    ],
    tokens: ['mt-1', 'mb-4'],
  },

  // ---------------------------------------------------------------------------
  // Color patterns
  // ---------------------------------------------------------------------------
  {
    name: 'status-colors',
    category: 'color',
    description: 'Color conventions for status indicators across the application.',
    rules: [
      'Success: bg-success / text-success / border-success-border',
      'Warning: bg-warning / text-warning / border-warning-border',
      'Error: bg-error / text-error / border-error-border',
      'Info: bg-info / text-info / border-info-border',
      'Light backgrounds for banners: bg-success-light, bg-warning-light, bg-error-light, bg-info-light',
    ],
    tokens: [
      'bg-success', 'text-success', 'bg-success-light',
      'bg-warning', 'text-warning', 'bg-warning-light',
      'bg-error', 'text-error', 'bg-error-light',
      'bg-info', 'text-info', 'bg-info-light',
    ],
  },
  {
    name: 'interactive-states',
    category: 'color',
    description: 'Color transitions for interactive elements (hover, focus, disabled).',
    rules: [
      'Table row hover: hover:bg-vercel-gray-50',
      'Button/link hover: darker shade of base color',
      'Focus: focus:ring-1 focus:ring-black',
      'Disabled: opacity reduction or bg-vercel-gray-50 + text-vercel-gray-200',
    ],
    tokens: [
      'hover:bg-vercel-gray-50', 'hover:bg-vercel-gray-100',
      'focus:ring-1', 'focus:ring-black',
      'disabled:opacity-50', 'disabled:cursor-not-allowed',
    ],
  },
  {
    name: 'border-colors',
    category: 'color',
    description: 'Border color conventions for containers and dividers.',
    rules: [
      'Primary border: border-vercel-gray-100 (most containers, inputs, cards)',
      'Hover border: border-vercel-gray-200',
      'Focus border: border-vercel-gray-600 (black)',
      'Divider lines: border-vercel-gray-100',
    ],
    tokens: ['border-vercel-gray-100', 'border-vercel-gray-200', 'border-vercel-gray-600'],
  },
  {
    name: 'text-hierarchy',
    category: 'color',
    description: 'Text color conventions establishing visual hierarchy.',
    rules: [
      'Primary text: text-vercel-gray-600 (black) — headings, values, important content',
      'Secondary text: text-vercel-gray-400 (#666) — labels, descriptions, meta text',
      'Tertiary text: text-vercel-gray-200 (#999) — placeholders, disabled, loading states',
      'Brand accent: text-bteam-brand — links, highlights, emphasis',
    ],
    tokens: ['text-vercel-gray-600', 'text-vercel-gray-400', 'text-vercel-gray-200', 'text-bteam-brand'],
  },

  // ---------------------------------------------------------------------------
  // Layout patterns
  // ---------------------------------------------------------------------------
  {
    name: 'page-header',
    category: 'layout',
    description: 'Standard page header layout with title/subtitle and optional action buttons.',
    rules: [
      'Container: flex items-center justify-between',
      'Left side: heading + subtitle stacked',
      'Right side: action buttons with gap-3',
    ],
    tokens: ['flex', 'items-center', 'justify-between', 'gap-3'],
  },
  {
    name: 'responsive-grid',
    category: 'layout',
    description: 'Responsive column layouts for content grids.',
    rules: [
      'Default 2 columns on mobile, scale up at md: and lg: breakpoints',
      'Stats: grid-cols-2 md:grid-cols-4',
      'Content: grid-cols-1 lg:grid-cols-3',
      'Gap: gap-4 for tight grids, gap-6 for content grids',
    ],
    tokens: ['grid', 'grid-cols-1', 'grid-cols-2', 'gap-4', 'gap-6'],
  },
  {
    name: 'table-layout',
    category: 'layout',
    description: 'Standard table structure with header, body, and optional footer.',
    rules: [
      'Container: bg-white border border-vercel-gray-100 rounded-lg overflow-hidden',
      'Header row: bg-vercel-gray-50 with uppercase label-form text style',
      'Body rows: hover:bg-vercel-gray-50 transition-colors',
      'Cell padding: px-4 py-3 (compact) or px-6 py-4 (standard)',
    ],
    tokens: [
      'bg-white', 'border', 'border-vercel-gray-100', 'rounded-lg',
      'overflow-hidden', 'bg-vercel-gray-50',
    ],
  },
  {
    name: 'modal-layout',
    category: 'layout',
    description: 'Standard modal structure and sizing conventions.',
    rules: [
      'Backdrop: bg-black/40 backdrop-blur-md',
      'Width: max-w-lg (default), max-w-sm (confirm), max-w-3xl (large)',
      'Height: max-h-[90vh] with overflow-y-auto',
      'Header: sticky top with title and close button',
      'Footer: sticky bottom with action buttons right-aligned',
    ],
    tokens: ['max-w-lg', 'max-w-sm', 'max-w-3xl', 'max-h-[90vh]'],
  },
];
