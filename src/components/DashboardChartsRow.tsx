/**
 * DashboardChartsRow - Molecule Component
 *
 * Displays pie chart (hours by resource) and line chart (12-month revenue trend)
 * in a responsive grid layout.
 *
 * @official 2026-01-11
 * @category Molecule
 *
 * Token Usage:
 * - Layout: grid-cols-1 md:grid-cols-2
 * - Spacing: gap-4
 * - Uses Card atom with padding="lg"
 */

import { useMemo } from 'react';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { PieChartAtom } from './atoms/charts/PieChartAtom';
import { LineGraphAtom } from './atoms/charts/LineGraphAtom';
import { transformResourcesToPieData, transformToLineChartData } from '../utils/chartTransforms';
import type { ResourceSummary } from '../types';
import type { MonthlyAggregate } from '../types/charts';

export interface DashboardChartsRowProps {
  /** Resource summaries for pie chart */
  resources: ResourceSummary[];
  /** Monthly aggregates for line chart */
  monthlyAggregates: MonthlyAggregate[];
  /** Loading state */
  loading?: boolean;
}

export function DashboardChartsRow({
  resources,
  monthlyAggregates,
  loading = false,
}: DashboardChartsRowProps) {
  // Transform data for charts
  const pieData = useMemo(
    () => transformResourcesToPieData(resources),
    [resources]
  );

  const lineData = useMemo(
    () => transformToLineChartData(monthlyAggregates),
    [monthlyAggregates]
  );

  // Loading state
  if (loading) {
    return (
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card variant="default" padding="lg">
          <div className="flex items-center justify-center h-[250px]">
            <Spinner size="lg" />
          </div>
        </Card>
        <Card variant="default" padding="lg">
          <div className="flex items-center justify-center h-[250px]">
            <Spinner size="lg" />
          </div>
        </Card>
      </section>
    );
  }

  // Empty state - no data
  if (resources.length === 0 && monthlyAggregates.length === 0) {
    return null;
  }

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Hours by Resource - Pie Chart */}
      <Card variant="default" padding="lg">
        <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
          Hours by Resource
        </h3>
        {pieData.length > 0 ? (
          <PieChartAtom data={pieData} />
        ) : (
          <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
            No resource data available
          </div>
        )}
      </Card>

      {/* 12-Month Revenue Trend - Line Chart */}
      <Card variant="default" padding="lg">
        <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
          12-Month Revenue Trend
        </h3>
        {lineData.length > 0 ? (
          <LineGraphAtom data={lineData} />
        ) : (
          <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
            No revenue data available
          </div>
        )}
      </Card>
    </section>
  );
}

export default DashboardChartsRow;
