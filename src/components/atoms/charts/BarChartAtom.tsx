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
import type { ForwardedRef, ReactElement } from 'react';
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
 * Data point for BarChartAtom.
 *
 * Only `value` is required by the component; every other field (the category
 * label such as `month` or a custom `categoryKey` like `company_name`) is
 * supplied by the caller's own concrete type. The component is generic over the
 * data point so callers can pass strongly-typed shapes (e.g. MoMGrowthDataPoint)
 * WITHOUT having to declare an index signature on those types.
 */
export interface BarChartDataPoint {
  /** Value (can be positive or negative) */
  value: number | null;
}

export interface BarChartAtomProps<T extends BarChartDataPoint = BarChartDataPoint>
  extends HTMLAttributes<HTMLDivElement> {
  /** Array of data points to display */
  data: ReadonlyArray<T>;
  /** Chart height in pixels */
  height?: number;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Whether to show grid lines */
  showGrid?: boolean;
  /** Format function for values (default: percentage) */
  valueFormatter?: (value: number) => string;
  /** Format function for Y-axis ticks (default: percentage) */
  yAxisFormatter?: (value: number) => string;
  /** Label for the value in tooltip */
  valueLabel?: string;
  /** Single fill color for all bars (overrides positive/negative coloring) */
  fillColor?: string;
  /**
   * Bar orientation. 'vertical' (default) keeps the original month-on-X behavior.
   * 'horizontal' renders ranked bars with the category on the Y axis — useful for
   * top-N rankings.
   */
  layout?: 'vertical' | 'horizontal';
  /** Key in each data point used for the category axis label (default: 'month') */
  categoryKey?: string;
}

// Default formatter for percentage values
const defaultFormatter = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

// Default Y-axis formatter for percentage values
const defaultYAxisFormatter = (value: number) => `${value}%`;

// Chart margin configuration
const chartMargin = { top: 5, right: 30, left: 20, bottom: 5 };

function BarChartAtomInner<T extends BarChartDataPoint>(
  {
    data,
    height = CHART_HEIGHT,
    showTooltip = true,
    showGrid = true,
    valueFormatter = defaultFormatter,
    yAxisFormatter = defaultYAxisFormatter,
    valueLabel = 'Growth',
    fillColor,
    layout = 'vertical',
    categoryKey = 'month',
    className = '',
    ...props
  }: BarChartAtomProps<T>,
  ref: ForwardedRef<HTMLDivElement>
) {
    // Custom tooltip formatter
    const tooltipFormatter = (value: number | undefined) => [
      valueFormatter(value ?? 0),
      valueLabel,
    ];

    const isHorizontal = layout === 'horizontal';

    // Category axis renders the labels (month or a custom key); value axis is
    // formatted numerically. In horizontal mode these swap orientation so the
    // category sits on the Y axis and values extend along the X axis.
    const categoryAxisProps = {
      type: (isHorizontal ? 'category' : undefined) as 'category' | undefined,
      dataKey: categoryKey,
      tick: axisTickStyle,
      axisLine: axisLineStyle,
      tickLine: axisLineStyle,
    };
    const valueAxisProps = {
      type: (isHorizontal ? 'number' : undefined) as 'number' | undefined,
      tick: axisTickStyle,
      axisLine: axisLineStyle,
      tickLine: axisLineStyle,
      tickFormatter: yAxisFormatter,
    };

    return (
      <div
        ref={ref}
        className={`w-full ${className}`}
        role="img"
        aria-label={`Bar chart showing ${data.length} ${isHorizontal ? 'ranked categories' : 'months'} of data`}
        {...props}
      >
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data as T[]}
            margin={chartMargin}
            layout={isHorizontal ? 'vertical' : 'horizontal'}
          >
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={chartColors.gridLine}
                vertical={isHorizontal}
                horizontal={!isHorizontal}
              />
            )}
            {isHorizontal ? (
              <>
                <XAxis {...valueAxisProps} />
                <YAxis width={120} {...categoryAxisProps} />
              </>
            ) : (
              <>
                <XAxis {...categoryAxisProps} />
                <YAxis {...valueAxisProps} />
              </>
            )}
            {/* Zero reference line (value axis) */}
            {isHorizontal ? (
              <ReferenceLine x={0} stroke={chartColors.axisLine} strokeWidth={1} />
            ) : (
              <ReferenceLine y={0} stroke={chartColors.axisLine} strokeWidth={1} />
            )}
            {showTooltip && (
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={tooltipFormatter}
                labelStyle={{ fontFamily: chartFontFamily }}
              />
            )}
            <Bar
              dataKey="value"
              radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    fillColor
                      ? (entry.value === null ? chartColors.axisLine : fillColor)
                      : entry.value === null
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

/**
 * Generic forwardRef wrapper. `forwardRef` erases generics, so we cast the
 * result back to a callable that preserves the `<T>` data-point type parameter.
 * This lets callers pass strongly-typed data (e.g. MoMGrowthDataPoint[],
 * concentration rank rows) without declaring an index signature on those types.
 */
export const BarChartAtom = forwardRef(BarChartAtomInner) as <
  T extends BarChartDataPoint = BarChartDataPoint
>(
  props: BarChartAtomProps<T> & { ref?: ForwardedRef<HTMLDivElement> }
) => ReactElement;

(BarChartAtom as { displayName?: string }).displayName = 'BarChartAtom';

export default BarChartAtom;
