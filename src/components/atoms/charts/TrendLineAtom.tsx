/**
 * TrendLineAtom - Official Design System Atom
 *
 * Generic multi-series line chart over time. Supports an optional right Y axis
 * so mixed-unit series (e.g. percentage on the left, currency on the right) can
 * be displayed together. Presentational only - receives data and series config
 * via props; performs no calculations.
 *
 * @official 2026-06-04
 * @category Atom
 *
 * Token Usage:
 * - Font: font-mono for axes, tooltips, legend (chartFontFamily)
 * - Colors: caller supplies colors from chartColors only (never hex literals)
 * - Grays: vercel-gray-* via axisTickStyle / axisLineStyle / tooltipStyle
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
 * Configuration for a single line series rendered by TrendLineAtom.
 */
export interface TrendLineSeries {
  /** Key in each data row holding this series' numeric value */
  dataKey: string;
  /** Display name for legend and tooltip */
  name: string;
  /** Stroke color — must be a chartColors token reference, never a hex literal */
  color: string;
  /** Optional dash pattern (e.g. "5 5") */
  strokeDasharray?: string;
  /** Which Y axis this series binds to (default: 'left') */
  yAxisId?: 'left' | 'right';
}

export interface TrendLineAtomProps extends HTMLAttributes<HTMLDivElement> {
  /** Rows of data keyed by series dataKey + the xKey */
  data: Array<Record<string, number | string | null>>;
  /** Series definitions */
  series: TrendLineSeries[];
  /** Key used for the X axis category (default: 'month') */
  xKey?: string;
  /** Formatter for left Y axis ticks and left-series tooltip values */
  leftFormatter?: (value: number) => string;
  /** Formatter for right Y axis ticks and right-series tooltip values */
  rightFormatter?: (value: number) => string;
  /** Chart height in pixels */
  height?: number;
  /** Whether to show the legend */
  showLegend?: boolean;
  /** Whether to show the tooltip on hover */
  showTooltip?: boolean;
  /** Whether to show grid lines */
  showGrid?: boolean;
}

// Chart margin configuration (matches existing atoms)
const chartMargin = { top: 5, right: 30, left: 20, bottom: 5 };

// Shared active dot configuration (matches LineGraphAtom)
const activeDotConfig = { r: 4, stroke: 'none' };

const legendFormatter = (value: string) => (
  <span style={{ fontFamily: chartFontFamily, color: chartColors.axisText }}>
    {value}
  </span>
);

const identityFormatter = (value: number) => String(value);

export const TrendLineAtom = forwardRef<HTMLDivElement, TrendLineAtomProps>(
  (
    {
      data,
      series,
      xKey = 'month',
      leftFormatter,
      rightFormatter,
      height = CHART_HEIGHT,
      showLegend = true,
      showTooltip = true,
      showGrid = true,
      className = '',
      ...props
    },
    ref
  ) => {
    const hasRightAxis = series.some((s) => s.yAxisId === 'right');
    const leftFmt = leftFormatter ?? identityFormatter;
    const rightFmt = rightFormatter ?? identityFormatter;

    // Map each series' display name to its axis-appropriate formatter so the
    // tooltip renders mixed-unit values correctly per series.
    const formatterByName = new Map<string, (value: number) => string>();
    for (const s of series) {
      formatterByName.set(s.name, s.yAxisId === 'right' ? rightFmt : leftFmt);
    }

    const tooltipFormatter = (value: number | undefined, name: string | undefined) => {
      const fmt = formatterByName.get(name ?? '') ?? leftFmt;
      return [value == null ? '—' : fmt(value), name ?? ''];
    };

    return (
      <div
        ref={ref}
        className={`w-full ${className}`}
        role="img"
        aria-label={`Line chart showing ${series.length} series over ${data.length} periods`}
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
              dataKey={xKey}
              tick={axisTickStyle}
              axisLine={axisLineStyle}
              tickLine={axisLineStyle}
            />
            <YAxis
              yAxisId="left"
              tick={axisTickStyle}
              axisLine={axisLineStyle}
              tickLine={axisLineStyle}
              tickFormatter={leftFmt}
            />
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={axisTickStyle}
                axisLine={axisLineStyle}
                tickLine={axisLineStyle}
                tickFormatter={rightFmt}
              />
            )}
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
              <Line
                key={s.dataKey}
                yAxisId={s.yAxisId ?? 'left'}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.strokeDasharray}
                dot={false}
                activeDot={activeDotConfig}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
);

TrendLineAtom.displayName = 'TrendLineAtom';

export default TrendLineAtom;
