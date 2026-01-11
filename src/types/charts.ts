/**
 * Chart Type Definitions
 *
 * TypeScript interfaces for chart atom components and data transformations.
 *
 * @official 2026-01-11
 * @category Types
 */

import type { HTMLAttributes } from 'react';

/**
 * Data point for PieChartAtom
 */
export interface PieChartDataPoint {
  /** Display name for the segment */
  name: string;
  /** Numeric value (e.g., hours) */
  value: number;
  /** Optional color token name (e.g., 'brand-indigo', 'success') */
  color?: string;
}

/**
 * Props for PieChartAtom component
 */
export interface PieChartAtomProps extends HTMLAttributes<HTMLDivElement> {
  /** Array of data points to display (pre-processed by caller) */
  data: PieChartDataPoint[];
  /** Chart height in pixels */
  height?: number;
  /** Whether to show legend */
  showLegend?: boolean;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Inner radius for donut variant (0 = pie, >0 = donut) */
  innerRadius?: number;
  /** Outer radius of the chart */
  outerRadius?: number;
}

/**
 * Data point for LineGraphAtom
 */
export interface LineGraphDataPoint {
  /** Month label (e.g., "Jan", "Feb") */
  month: string;
  /** Target line value (budget * ratio) */
  target: number;
  /** Budget line value (monthly budget in dollars) */
  budget: number;
  /** Revenue line value (actual revenue, null for future months) */
  revenue: number | null;
}

/**
 * Props for LineGraphAtom component
 */
export interface LineGraphAtomProps extends HTMLAttributes<HTMLDivElement> {
  /** Array of monthly data points */
  data: LineGraphDataPoint[];
  /** Chart height in pixels */
  height?: number;
  /** Whether to show legend */
  showLegend?: boolean;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Whether to show grid lines */
  showGrid?: boolean;
}

/**
 * Monthly aggregate data for chart transformations
 */
export interface MonthlyAggregate {
  /** Month in 'YYYY-MM' format */
  month: string;
  /** Total minutes worked */
  totalMinutes: number;
  /** Total revenue calculated from hours * rates */
  totalRevenue: number;
}
