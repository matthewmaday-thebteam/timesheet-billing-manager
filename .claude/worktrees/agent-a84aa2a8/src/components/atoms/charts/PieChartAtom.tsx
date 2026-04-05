/**
 * PieChartAtom - Official Design System Atom
 *
 * Displays data distribution as a pie/donut chart.
 * Presentational only - receives pre-processed data via props.
 * Data transformation (grouping into "Other") should be done by caller.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Font: font-mono for labels, tooltips, legend
 * - Colors: brand-indigo, brand-purple, success, warning, info
 */

import { forwardRef, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { PieChartAtomProps, PieChartDataPoint } from '../../../types/charts';
import { CHART_HEIGHT } from '../../../config/chartConfig';
import {
  pieChartColorSequence,
  tooltipStyle,
  legendWrapperStyle,
  chartFontFamily,
  chartColors,
  getColorToken,
  formatChartHours,
} from './chartTheme';

// Formatter functions extracted outside component (no props dependencies)
const tooltipFormatter = (value: number | undefined) => [formatChartHours(value ?? 0), 'Hours'];

const legendFormatter = (value: string) => (
  <span style={{ fontFamily: chartFontFamily, color: chartColors.axisText }}>
    {value}
  </span>
);

export const PieChartAtom = forwardRef<HTMLDivElement, PieChartAtomProps>(
  (
    {
      data,
      height = CHART_HEIGHT,
      showLegend = true,
      showTooltip = true,
      innerRadius = 60,
      outerRadius = 80,
      className = '',
      ...props
    },
    ref
  ) => {
    // Get segment color based on data color or sequence
    const getSegmentColor = useCallback(
      (entry: PieChartDataPoint, index: number): string => {
        if (entry.color) {
          return getColorToken(entry.color);
        }
        return pieChartColorSequence[index % pieChartColorSequence.length];
      },
      []
    );

    return (
      <div
        ref={ref}
        className={`w-full ${className}`}
        role="img"
        aria-label={`Pie chart showing distribution of ${data.length} segments`}
        {...props}
      >
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data as unknown as Record<string, unknown>[]}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
              labelLine={false}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${entry.name}-${index}`}
                  fill={getSegmentColor(entry, index)}
                  stroke="none"
                />
              ))}
            </Pie>
            {showTooltip && (
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={tooltipFormatter}
              />
            )}
            {showLegend && (
              <Legend
                wrapperStyle={legendWrapperStyle}
                formatter={legendFormatter}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }
);

PieChartAtom.displayName = 'PieChartAtom';

export default PieChartAtom;
