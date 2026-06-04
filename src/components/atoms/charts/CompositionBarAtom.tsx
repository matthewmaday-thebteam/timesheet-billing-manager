/**
 * CompositionBarAtom - Official Design System Atom
 *
 * Generic stacked bar chart over time, used to show how a total decomposes into
 * its constituent parts per period (e.g. revenue mix by stream). Presentational
 * only - receives data and series config via props; performs no calculations.
 *
 * @official 2026-06-04
 * @category Atom
 *
 * Token Usage:
 * - Font: font-mono for axes, tooltips, legend (chartFontFamily)
 * - Colors: caller supplies colors from chartColors / pieChartColorSequence only
 * - Grays: vercel-gray-* via axisTickStyle / axisLineStyle / tooltipStyle
 */

import { forwardRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CHART_HEIGHT } from '../../../config/chartConfig';
import {
  axisTickStyle,
  axisLineStyle,
  tooltipStyle,
  legendWrapperStyle,
  chartColors,
  chartFontFamily,
} from './chartTheme';
import type { HTMLAttributes } from 'react';

/**
 * Configuration for a single stacked segment rendered by CompositionBarAtom.
 */
export interface CompositionBarSeries {
  /** Key in each data row holding this segment's numeric value */
  dataKey: string;
  /** Display name for legend and tooltip */
  name: string;
  /** Fill color — must be a chartColors / pieChartColorSequence token reference */
  color: string;
}

export interface CompositionBarAtomProps extends HTMLAttributes<HTMLDivElement> {
  /** Rows of data keyed by each series dataKey + the xKey */
  data: Array<Record<string, number | string | null>>;
  /** Stacked segment definitions */
  series: CompositionBarSeries[];
  /** Key used for the X axis category (default: 'month') */
  xKey?: string;
  /** Formatter for Y axis ticks and tooltip values */
  yAxisFormatter?: (value: number) => string;
  /** Chart height in pixels */
  height?: number;
  /** Whether to show the legend */
  showLegend?: boolean;
  /** Whether to show the tooltip on hover */
  showTooltip?: boolean;
}

// Single stack id — all segments stack into one bar per period
const STACK_ID = 'composition';

// Chart margin configuration (matches existing atoms)
const chartMargin = { top: 5, right: 30, left: 20, bottom: 5 };

const legendFormatter = (value: string) => (
  <span style={{ fontFamily: chartFontFamily, color: chartColors.axisText }}>
    {value}
  </span>
);

const identityFormatter = (value: number) => String(value);

export const CompositionBarAtom = forwardRef<HTMLDivElement, CompositionBarAtomProps>(
  (
    {
      data,
      series,
      xKey = 'month',
      yAxisFormatter,
      height = CHART_HEIGHT,
      showLegend = true,
      showTooltip = true,
      className = '',
      ...props
    },
    ref
  ) => {
    const valueFmt = yAxisFormatter ?? identityFormatter;

    const tooltipFormatter = (value: number | undefined, name: string | undefined) => [
      value == null ? '—' : valueFmt(value),
      name ?? '',
    ];

    return (
      <div
        ref={ref}
        className={`w-full ${className}`}
        role="img"
        aria-label={`Stacked bar chart showing ${series.length} segments over ${data.length} periods`}
        {...props}
      >
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={chartMargin}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartColors.gridLine}
              vertical={false}
            />
            <XAxis
              dataKey={xKey}
              tick={axisTickStyle}
              axisLine={axisLineStyle}
              tickLine={axisLineStyle}
            />
            <YAxis
              tick={axisTickStyle}
              axisLine={axisLineStyle}
              tickLine={axisLineStyle}
              tickFormatter={valueFmt}
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
            {series.map((s) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.name}
                stackId={STACK_ID}
                fill={s.color}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
);

CompositionBarAtom.displayName = 'CompositionBarAtom';

export default CompositionBarAtom;
