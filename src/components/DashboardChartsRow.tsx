/**
 * DashboardChartsRow - Molecule Component
 *
 * Displays charts in a two-row layout:
 * - Row 1: 12-Month Revenue Trend (full width)
 * - Row 2: Hours by Resource (pie) | Top 5 By Hours (list) | Top 5 By Revenue (list)
 *
 * @official 2026-01-22
 * @category Molecule
 *
 * Token Usage:
 * - Layout: Full width for revenue, grid-cols-3 for resource charts
 * - Spacing: gap-4
 * - Uses Card atom with padding="lg"
 */

import { useMemo } from 'react';
import { Card } from './Card';
import { Spinner } from './Spinner';
import { PieChartAtom } from './atoms/charts/PieChartAtom';
import { LineGraphAtom } from './atoms/charts/LineGraphAtom';
import { BarChartAtom } from './atoms/charts/BarChartAtom';
import { CAGRChartAtom } from './atoms/charts/CAGRChartAtom';
import {
  transformResourcesToPieData,
  transformToLineChartData,
  transformToMoMGrowthData,
  transformToCAGRProjectionData,
  calculateGrowthStats,
} from '../utils/chartTransforms';
import { formatCurrency } from '../utils/billing';
import type { ResourceSummary, TimesheetEntry } from '../types';
import type { MonthlyAggregate } from '../types/charts';

/** Data for top resources list display */
interface TopResourceItem {
  name: string;
  hours: number;
  revenue: number;
}

export interface DashboardChartsRowProps {
  /** Resource summaries for pie chart (monthly data) */
  resources: ResourceSummary[];
  /** Raw timesheet entries for daily filtering */
  entries: TimesheetEntry[];
  /** Monthly aggregates for line chart */
  monthlyAggregates: MonthlyAggregate[];
  /** Project rates lookup by project name */
  projectRates: Map<string, number>;
  /** Loading state */
  loading?: boolean;
}

/**
 * Transform timesheet entries into top N resource list with hours and revenue.
 * @param sortBy - 'hours' or 'revenue' - determines sort order
 */
function transformEntriesToTopList(
  entries: TimesheetEntry[],
  projectRates: Map<string, number>,
  topN: number = 5,
  sortBy: 'hours' | 'revenue' = 'hours'
): TopResourceItem[] {
  // Aggregate minutes and revenue by user
  const userStats = new Map<string, { minutes: number; revenue: number }>();

  for (const entry of entries) {
    const userName = entry.user_name;
    const current = userStats.get(userName) || { minutes: 0, revenue: 0 };
    const rate = projectRates.get(entry.project_name) ?? 0;
    const hours = entry.total_minutes / 60;

    userStats.set(userName, {
      minutes: current.minutes + entry.total_minutes,
      revenue: current.revenue + (hours * rate),
    });
  }

  // Convert to list format
  const listData: TopResourceItem[] = Array.from(userStats.entries()).map(
    ([name, stats]) => ({
      name,
      hours: stats.minutes / 60,
      revenue: stats.revenue,
    })
  );

  // Sort by specified field descending and take top N
  if (sortBy === 'revenue') {
    listData.sort((a, b) => b.revenue - a.revenue);
  } else {
    listData.sort((a, b) => b.hours - a.hours);
  }
  return listData.slice(0, topN);
}

export function DashboardChartsRow({
  resources,
  entries,
  monthlyAggregates,
  projectRates,
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

  // MoM Growth Rate data
  const momGrowthData = useMemo(
    () => transformToMoMGrowthData(monthlyAggregates),
    [monthlyAggregates]
  );

  // CAGR Projection data
  const cagrData = useMemo(
    () => transformToCAGRProjectionData(monthlyAggregates),
    [monthlyAggregates]
  );

  // Growth statistics for display
  const growthStats = useMemo(
    () => calculateGrowthStats(monthlyAggregates),
    [monthlyAggregates]
  );

  // Top 5 by hours for the selected month
  const topFiveByHours = useMemo(
    () => transformEntriesToTopList(entries, projectRates, 5, 'hours'),
    [entries, projectRates]
  );

  // Top 5 by revenue for the selected month
  const topFiveByRevenue = useMemo(
    () => transformEntriesToTopList(entries, projectRates, 5, 'revenue'),
    [entries, projectRates]
  );

  // Loading state
  if (loading) {
    return (
      <section className="space-y-4">
        <Card variant="default" padding="lg">
          <div className="flex items-center justify-center h-[250px]">
            <Spinner size="lg" />
          </div>
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          <Card variant="default" padding="lg">
            <div className="flex items-center justify-center h-[250px]">
              <Spinner size="lg" />
            </div>
          </Card>
        </div>
      </section>
    );
  }

  // Empty state - no data
  if (resources.length === 0 && monthlyAggregates.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      {/* Row 1: 12-Month Revenue Trend - Full Width */}
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

      {/* Row 1.5: MoM Growth Rate and CAGR Projection - Two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* MoM Growth Rate Chart */}
        <Card variant="default" padding="lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-vercel-gray-600">
              MoM Growth Rate
            </h3>
            {growthStats.avgMoMGrowth !== null && (
              <span className={`text-sm font-mono ${growthStats.avgMoMGrowth >= 0 ? 'text-success' : 'text-error'}`}>
                Avg: {growthStats.avgMoMGrowth >= 0 ? '+' : ''}{growthStats.avgMoMGrowth.toFixed(1)}%
              </span>
            )}
          </div>
          {momGrowthData.some(d => d.value !== null) ? (
            <BarChartAtom data={momGrowthData} />
          ) : (
            <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
              Need 2+ months for MoM growth
            </div>
          )}
        </Card>

        {/* CAGR Projection Chart */}
        <Card variant="default" padding="lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-vercel-gray-600">
              CAGR Projection
            </h3>
            {growthStats.projectedAnnualRevenue !== null && (
              <span className="text-sm font-mono text-vercel-gray-600">
                Projected: {formatCurrency(growthStats.projectedAnnualRevenue)}
              </span>
            )}
          </div>
          {cagrData.some(d => d.actual !== null || d.projected !== null) ? (
            <CAGRChartAtom data={cagrData} />
          ) : (
            <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
              No data available for projection
            </div>
          )}
        </Card>
      </div>

      {/* Row 2: Three pie charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        {/* Top 5 By Hours - List */}
        <Card variant="default" padding="lg">
          <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
            Top 5 By Hours
          </h3>
          {topFiveByHours.length > 0 ? (
            <div className="space-y-3">
              {topFiveByHours.map((item, index) => (
                <div key={item.name} className="flex items-center justify-between py-2 border-b border-vercel-gray-100 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-vercel-gray-400 w-5">{index + 1}.</span>
                    <span className="text-sm font-medium text-vercel-gray-600">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <span className="text-sm text-vercel-gray-400 font-mono">{item.hours.toFixed(1)}h</span>
                    <span className="text-sm font-medium text-vercel-gray-600 font-mono w-20 text-right">{formatCurrency(item.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-vercel-gray-400 font-mono text-sm">
              No data for this month
            </div>
          )}
        </Card>

        {/* Top 5 By Revenue - List */}
        <Card variant="default" padding="lg">
          <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
            Top 5 By Revenue
          </h3>
          {topFiveByRevenue.length > 0 ? (
            <div className="space-y-3">
              {topFiveByRevenue.map((item, index) => (
                <div key={item.name} className="flex items-center justify-between py-2 border-b border-vercel-gray-100 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-vercel-gray-400 w-5">{index + 1}.</span>
                    <span className="text-sm font-medium text-vercel-gray-600">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <span className="text-sm text-vercel-gray-400 font-mono">{item.hours.toFixed(1)}h</span>
                    <span className="text-sm font-medium text-vercel-gray-600 font-mono w-20 text-right">{formatCurrency(item.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-vercel-gray-400 font-mono text-sm">
              No data for this month
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

export default DashboardChartsRow;
