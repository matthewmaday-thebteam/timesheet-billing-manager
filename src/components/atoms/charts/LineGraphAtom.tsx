/**
 * LineGraphAtom - Official Design System Atom
 *
 * Displays monthly time series with Target, Budget, and Revenue lines.
 * Presentational only - receives data via props.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Font: font-mono for axes, tooltips, legend
 * - Colors: brand-indigo (target), brand-purple (budget), success (revenue)
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
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { LineGraphAtomProps } from '../../../types/charts';
import { CHART_HEIGHT } from '../../../config/chartConfig';
import {
  lineGraphLines,
  axisTickStyle,
  axisLineStyle,
  tooltipStyle,
  legendWrapperStyle,
  chartColors,
  chartFontFamily,
  referenceLineDefaults,
  formatChartCurrency,
} from './chartTheme';

// Formatter functions extracted outside component (no props dependencies)
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

// Prior year label (e.g., "2025" when current year is 2026)
const priorYearLabel = String(new Date().getFullYear() - 1);

// Chart margin configuration
const chartMargin = { top: 5, right: 30, left: 20, bottom: 5 };

// Shared line configuration - no stroke on active dot
const activeDotConfig = { r: 4, stroke: 'none' };

export const LineGraphAtom = forwardRef<HTMLDivElement, LineGraphAtomProps>(
  (
    {
      data,
      height = CHART_HEIGHT,
      showLegend = true,
      showTooltip = true,
      showGrid = true,
      referenceLines = [],
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
        aria-label={`Line chart showing ${data.length} months of revenue data`}
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
            {/* Target Line */}
            <Line
              type="monotone"
              dataKey={lineGraphLines.target.dataKey}
              name={lineGraphLines.target.name}
              stroke={lineGraphLines.target.color}
              strokeWidth={lineGraphLines.target.strokeWidth}
              dot={false}
              activeDot={activeDotConfig}
            />
            {/* Budget Line (dashed) */}
            <Line
              type="monotone"
              dataKey={lineGraphLines.budget.dataKey}
              name={lineGraphLines.budget.name}
              stroke={lineGraphLines.budget.color}
              strokeWidth={lineGraphLines.budget.strokeWidth}
              strokeDasharray={lineGraphLines.budget.strokeDasharray}
              dot={false}
              activeDot={activeDotConfig}
            />
            {/* Revenue Line */}
            <Line
              type="monotone"
              dataKey={lineGraphLines.revenue.dataKey}
              name={lineGraphLines.revenue.name}
              stroke={lineGraphLines.revenue.color}
              strokeWidth={lineGraphLines.revenue.strokeWidth}
              dot={false}
              activeDot={activeDotConfig}
            />
            {/* Best Case Projection Line */}
            <Line
              type="monotone"
              dataKey={lineGraphLines.bestCase.dataKey}
              name={lineGraphLines.bestCase.name}
              stroke={lineGraphLines.bestCase.color}
              strokeWidth={lineGraphLines.bestCase.strokeWidth}
              strokeDasharray={lineGraphLines.bestCase.strokeDasharray}
              dot={false}
              activeDot={activeDotConfig}
              connectNulls={false}
            />
            {/* Worst Case Projection Line */}
            <Line
              type="monotone"
              dataKey={lineGraphLines.worstCase.dataKey}
              name={lineGraphLines.worstCase.name}
              stroke={lineGraphLines.worstCase.color}
              strokeWidth={lineGraphLines.worstCase.strokeWidth}
              strokeDasharray={lineGraphLines.worstCase.strokeDasharray}
              dot={false}
              activeDot={activeDotConfig}
              connectNulls={false}
            />
            {/* Prior Year Cumulative Revenue Line (dashed benchmark) */}
            <Line
              type="monotone"
              dataKey={lineGraphLines.priorYear.dataKey}
              name={priorYearLabel}
              stroke={lineGraphLines.priorYear.color}
              strokeWidth={lineGraphLines.priorYear.strokeWidth}
              strokeDasharray={lineGraphLines.priorYear.strokeDasharray}
              dot={false}
              activeDot={activeDotConfig}
              connectNulls={true}
            />
            {/* Reference Lines (e.g., flat benchmarks) */}
            {referenceLines.map((refLine) => (
              <ReferenceLine
                key={refLine.label}
                y={refLine.y}
                stroke={refLine.stroke ?? referenceLineDefaults.stroke}
                strokeDasharray={refLine.strokeDasharray ?? referenceLineDefaults.strokeDasharray}
                strokeWidth={refLine.strokeWidth ?? referenceLineDefaults.strokeWidth}
                label={{
                  value: refLine.label,
                  position: 'right',
                  fill: refLine.stroke ?? referenceLineDefaults.stroke,
                  fontSize: referenceLineDefaults.labelFontSize,
                  fontFamily: chartFontFamily,
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
);

LineGraphAtom.displayName = 'LineGraphAtom';

export default LineGraphAtom;
