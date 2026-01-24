/**
 * CAGRChartAtom - Official Design System Atom
 *
 * Displays CAGR (Compound Annual Growth Rate) projection chart.
 * Shows actual cumulative revenue and projected revenue based on growth rate.
 * Presentational only - receives data via props.
 *
 * @official 2026-01-24
 * @category Atom
 *
 * Token Usage:
 * - Font: font-mono for axes, tooltips, legend
 * - Colors: bteam-brand (actual), vercel-gray (projected)
 */

import { forwardRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { CAGRProjectionDataPoint } from '../../../types/charts';
import { CHART_HEIGHT } from '../../../config/chartConfig';
import {
  axisTickStyle,
  axisLineStyle,
  tooltipStyle,
  legendWrapperStyle,
  chartColors,
  chartFontFamily,
  formatChartCurrency,
} from './chartTheme';
import type { HTMLAttributes } from 'react';

export interface CAGRChartAtomProps extends HTMLAttributes<HTMLDivElement> {
  /** Array of data points to display */
  data: CAGRProjectionDataPoint[];
  /** Chart height in pixels */
  height?: number;
  /** Whether to show legend */
  showLegend?: boolean;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Whether to show grid lines */
  showGrid?: boolean;
}

// Formatter functions
const tooltipFormatter = (value: number | undefined, name: string | undefined) => [
  formatChartCurrency(value ?? 0),
  name ?? '',
];

const legendFormatter = (value: string) => (
  <span style={{ fontFamily: chartFontFamily, color: chartColors.axisText }}>
    {value}
  </span>
);

const yAxisFormatter = (value: number) => formatChartCurrency(value);

// Chart margin configuration
const chartMargin = { top: 5, right: 30, left: 20, bottom: 5 };

// Shared line configuration
const activeDotConfig = { r: 4, stroke: 'none' };

export const CAGRChartAtom = forwardRef<HTMLDivElement, CAGRChartAtomProps>(
  (
    {
      data,
      height = CHART_HEIGHT,
      showLegend = true,
      showTooltip = true,
      showGrid = true,
      className = '',
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={`w-full ${className}`}
        role="img"
        aria-label={`CAGR projection chart showing ${data.length} months`}
        {...props}
      >
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={chartMargin}>
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
              tickFormatter={yAxisFormatter}
            />
            {showTooltip && (
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={tooltipFormatter}
                labelStyle={{ fontFamily: chartFontFamily }}
              />
            )}
            {showLegend && (
              <Legend
                wrapperStyle={legendWrapperStyle}
                formatter={legendFormatter}
              />
            )}
            {/* Actual Revenue Line */}
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke={chartColors.bteamBrand}
              strokeWidth={2}
              dot={false}
              activeDot={activeDotConfig}
              connectNulls={false}
            />
            {/* Projected Revenue Line */}
            <Line
              type="monotone"
              dataKey="projected"
              name="CAGR Projection"
              stroke={chartColors.axisText}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              activeDot={activeDotConfig}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
);

CAGRChartAtom.displayName = 'CAGRChartAtom';

export default CAGRChartAtom;
