/**
 * BarChartAtom - Official Design System Atom
 *
 * Displays monthly bar chart for metrics like MoM growth rate.
 * Supports positive/negative values with different colors.
 * Presentational only - receives data via props.
 *
 * @official 2026-01-24
 * @category Atom
 *
 * Token Usage:
 * - Font: font-mono for axes, tooltips, legend
 * - Colors: success (positive), error (negative), vercel-gray (neutral)
 */

import { forwardRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { CHART_HEIGHT } from '../../../config/chartConfig';
import {
  axisTickStyle,
  axisLineStyle,
  tooltipStyle,
  chartColors,
  chartFontFamily,
} from './chartTheme';
import type { HTMLAttributes } from 'react';

/**
 * Data point for BarChartAtom
 */
export interface BarChartDataPoint {
  /** Month label (e.g., "Jan", "Feb") */
  month: string;
  /** Value (can be positive or negative) */
  value: number | null;
}

export interface BarChartAtomProps extends HTMLAttributes<HTMLDivElement> {
  /** Array of data points to display */
  data: BarChartDataPoint[];
  /** Chart height in pixels */
  height?: number;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Whether to show grid lines */
  showGrid?: boolean;
  /** Format function for values (default: percentage) */
  valueFormatter?: (value: number) => string;
  /** Label for the value in tooltip */
  valueLabel?: string;
}

// Default formatter for percentage values
const defaultFormatter = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

// Chart margin configuration
const chartMargin = { top: 5, right: 30, left: 20, bottom: 5 };

export const BarChartAtom = forwardRef<HTMLDivElement, BarChartAtomProps>(
  (
    {
      data,
      height = CHART_HEIGHT,
      showTooltip = true,
      showGrid = true,
      valueFormatter = defaultFormatter,
      valueLabel = 'Growth',
      className = '',
      ...props
    },
    ref
  ) => {
    // Custom tooltip formatter
    const tooltipFormatter = (value: number | undefined) => [
      valueFormatter(value ?? 0),
      valueLabel,
    ];

    return (
      <div
        ref={ref}
        className={`w-full ${className}`}
        role="img"
        aria-label={`Bar chart showing ${data.length} months of data`}
        {...props}
      >
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={chartMargin}>
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={chartColors.gridLine}
                vertical={false}
              />
            )}
            <XAxis
              dataKey="month"
              tick={axisTickStyle}
              axisLine={axisLineStyle}
              tickLine={axisLineStyle}
            />
            <YAxis
              tick={axisTickStyle}
              axisLine={axisLineStyle}
              tickLine={axisLineStyle}
              tickFormatter={(value) => `${value}%`}
            />
            {/* Zero reference line */}
            <ReferenceLine y={0} stroke={chartColors.axisLine} strokeWidth={1} />
            {showTooltip && (
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={tooltipFormatter}
                labelStyle={{ fontFamily: chartFontFamily }}
              />
            )}
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    entry.value === null
                      ? chartColors.axisLine
                      : entry.value >= 0
                        ? chartColors.success
                        : chartColors.error
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
);

BarChartAtom.displayName = 'BarChartAtom';

export default BarChartAtom;
