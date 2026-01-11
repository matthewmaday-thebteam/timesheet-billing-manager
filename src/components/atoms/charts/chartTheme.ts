/**
 * Chart Theme Adapter
 *
 * Maps design tokens from @theme to Recharts styling configuration.
 * All colors reference CSS custom properties - no hex codes.
 *
 * @official 2026-01-11
 * @category Theme
 *
 * Token Usage:
 * - Font: font-mono for all text elements
 * - Colors: brand-*, mesh-*, success, warning, semantic colors
 * - Grays: vercel-gray-* for axes, grid, tooltips
 */

import type { CSSProperties } from 'react';

/**
 * CSS variable references for chart colors.
 * These map to --color-* tokens in src/index.css
 */
export const chartColors = {
  // Primary series colors
  brandIndigo: 'var(--color-brand-indigo)',      // #667eea
  brandPurple: 'var(--color-brand-purple)',      // #764ba2
  success: 'var(--color-success)',               // #50E3C2 (mesh-3)
  warning: 'var(--color-warning)',               // #F5A623 (mesh-4)

  // Extended palette for pie chart segments
  info: 'var(--color-info)',                     // #4338CA
  error: 'var(--color-error)',                   // #EE0000

  // Grays for axes, gridlines, backgrounds
  axisLine: 'var(--color-vercel-gray-100)',      // #eaeaea
  axisText: 'var(--color-vercel-gray-400)',      // #666666
  gridLine: 'var(--color-vercel-gray-100)',      // #eaeaea
  tooltipBg: 'var(--color-vercel-gray-50)',      // #fafafa
  tooltipText: 'var(--color-vercel-gray-600)',   // #000000
  tooltipBorder: 'var(--color-vercel-gray-100)', // #eaeaea
  otherSegment: 'var(--color-vercel-gray-200)',  // #999999
} as const;

/**
 * Default color sequence for pie chart segments.
 * Uses brand and semantic colors in a visually balanced order.
 */
export const pieChartColorSequence = [
  chartColors.brandIndigo,
  chartColors.brandPurple,
  chartColors.success,
  chartColors.warning,
  chartColors.info,
] as const;

/**
 * Line configurations for LineGraphAtom.
 * Defines appearance of each line series.
 */
export const lineGraphLines = {
  target: {
    dataKey: 'target' as const,
    name: 'Target (1.8x)',
    color: chartColors.brandIndigo,
    strokeDasharray: undefined,
    strokeWidth: 2,
  },
  budget: {
    dataKey: 'budget' as const,
    name: 'Budget',
    color: chartColors.brandPurple,
    strokeDasharray: '5 5',
    strokeWidth: 2,
  },
  revenue: {
    dataKey: 'revenue' as const,
    name: 'Revenue',
    color: chartColors.success,
    strokeDasharray: undefined,
    strokeWidth: 2,
  },
} as const;

/**
 * Font family for chart text elements.
 * Matches the font-mono token from @theme.
 */
export const chartFontFamily =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * Font sizes for chart elements (pixels)
 */
export const chartFontSizes = {
  tick: 10,        // Axis tick labels (--font-size-2xs)
  label: 12,       // Axis labels (--font-size-xs)
  tooltip: 12,     // Tooltip text (--font-size-xs)
  legend: 12,      // Legend text (--font-size-xs)
} as const;

/**
 * Common axis tick configuration
 */
export const axisTickStyle = {
  fontFamily: chartFontFamily,
  fontSize: chartFontSizes.tick,
  fill: chartColors.axisText,
} as const;

/**
 * Common axis line configuration
 */
export const axisLineStyle = {
  stroke: chartColors.axisLine,
  strokeWidth: 1,
} as const;

/**
 * Tooltip container style
 */
export const tooltipStyle: CSSProperties = {
  backgroundColor: chartColors.tooltipBg,
  border: `1px solid ${chartColors.tooltipBorder}`,
  borderRadius: '6px',
  padding: '8px 12px',
  fontFamily: chartFontFamily,
  fontSize: chartFontSizes.tooltip,
  color: chartColors.tooltipText,
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
};

/**
 * Legend wrapper style
 */
export const legendWrapperStyle: CSSProperties = {
  fontFamily: chartFontFamily,
  fontSize: chartFontSizes.legend,
};

/**
 * Map color token name to CSS variable reference.
 * Used when data specifies a color by token name.
 */
export function getColorToken(tokenName: string): string {
  const tokenMap: Record<string, string> = {
    'brand-indigo': chartColors.brandIndigo,
    'brand-purple': chartColors.brandPurple,
    'success': chartColors.success,
    'warning': chartColors.warning,
    'mesh-3': chartColors.success,
    'mesh-4': chartColors.warning,
    'info': chartColors.info,
    'error': chartColors.error,
    'other': chartColors.otherSegment,
  };
  return tokenMap[tokenName] ?? chartColors.brandIndigo;
}

/**
 * Format currency value for display
 */
export function formatChartCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}k`;
  }
  return `$${value.toFixed(0)}`;
}

/**
 * Format hours value for display
 */
export function formatChartHours(value: number): string {
  return `${value.toFixed(1)}h`;
}
