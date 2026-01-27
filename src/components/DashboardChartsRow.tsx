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
import type { MonthlyBillingResult } from '../utils/billingCalculations';

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
  /** Project rates lookup by external project_id (fallback) */
  projectRates: Map<string, number>;
  /** Canonical project ID lookup (external project_id -> canonical project_id) */
  projectCanonicalIdLookup?: Map<string, string>;
  /** Unified billing result from useUnifiedBilling */
  billingResult?: MonthlyBillingResult;
  /** Pre-calculated total revenue for the current month (with billing limits applied) */
  currentMonthRevenue?: number;
  /** Loading state */
  loading?: boolean;
  /** Which section to display: 'resources' (pie + top 5), 'trends' (revenue + MoM + CAGR), or 'all' */
  section?: 'resources' | 'trends' | 'all';
}

/**
 * Transform timesheet entries into top N resource list with hours and revenue.
 * Uses the unified billing result for accurate revenue calculations.
 * @param sortBy - 'hours' or 'revenue' - determines sort order
 */
function transformEntriesToTopList(
  entries: TimesheetEntry[],
  billingResult: MonthlyBillingResult | undefined,
  projectRates: Map<string, number>,
  projectCanonicalIdLookup: Map<string, string> | undefined,
  topN: number = 5,
  sortBy: 'hours' | 'revenue' = 'hours'
): TopResourceItem[] {
  // Helper to get canonical project ID
  const getCanonicalProjectId = (projectId: string | null): string => {
    if (!projectId) return '';
    return projectCanonicalIdLookup?.get(projectId) || projectId;
  };

  // Build project revenue lookup from billing result (keyed by canonical project ID)
  const projectRevenues = new Map<string, number>();
  const projectMinutes = new Map<string, number>();

  if (billingResult) {
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        // Key by project ID (canonical), not name
        const projectId = project.projectId || '';
        projectRevenues.set(projectId, project.billedRevenue);
        projectMinutes.set(projectId, project.actualMinutes);
      }
    }
  }

  // If no billing result, fall back to simple calculation using canonical project IDs
  if (!billingResult) {
    for (const entry of entries) {
      const canonicalProjectId = getCanonicalProjectId(entry.project_id);
      const current = projectMinutes.get(canonicalProjectId) || 0;
      projectMinutes.set(canonicalProjectId, current + entry.total_minutes);

      const rate = projectRates.get(canonicalProjectId) ?? 0;
      const currentRevenue = projectRevenues.get(canonicalProjectId) || 0;
      projectRevenues.set(canonicalProjectId, currentRevenue + (entry.total_minutes / 60) * rate);
    }
  }

  // Aggregate by user, distributing project revenue proportionally
  const userStats = new Map<string, { minutes: number; revenue: number }>();

  for (const entry of entries) {
    const userName = entry.user_name;
    const current = userStats.get(userName) || { minutes: 0, revenue: 0 };

    // Calculate user's share of project revenue based on their contribution
    // Always use canonical project ID for lookups
    const canonicalProjectId = getCanonicalProjectId(entry.project_id);
    const totalProjectMinutes = projectMinutes.get(canonicalProjectId) || 1;
    const projectRevenue = projectRevenues.get(canonicalProjectId) || 0;
    const userShare = (entry.total_minutes / totalProjectMinutes) * projectRevenue;

    userStats.set(userName, {
      minutes: current.minutes + entry.total_minutes,
      revenue: current.revenue + userShare,
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
  projectCanonicalIdLookup,
  billingResult,
  currentMonthRevenue,
  loading = false,
  section = 'all',
}: DashboardChartsRowProps) {
  const showResources = section === 'resources' || section === 'all';
  const showTrends = section === 'trends' || section === 'all';
  // Transform data for charts
  const pieData = useMemo(
    () => transformResourcesToPieData(resources),
    [resources]
  );

  // Transform line data, then override current month with accurate revenue if provided
  const lineData = useMemo(() => {
    const baseData = transformToLineChartData(monthlyAggregates);

    // If we have an accurate current month revenue, update the line data
    if (currentMonthRevenue !== undefined && monthlyAggregates.length > 0) {
      const currentMonthIndex = new Date().getMonth(); // 0-11
      const currentYear = new Date().getFullYear();

      // Find the current month in aggregates to calculate cumulative
      let cumulativeBeforeCurrent = 0;
      for (const agg of monthlyAggregates) {
        const [aggYear, aggMonth] = agg.month.split('-').map(Number);
        if (aggYear === currentYear && aggMonth - 1 < currentMonthIndex) {
          cumulativeBeforeCurrent += agg.totalRevenue;
        }
      }

      // Update current month's cumulative revenue
      if (baseData[currentMonthIndex]) {
        const newCumulative = Math.round(cumulativeBeforeCurrent + currentMonthRevenue);
        baseData[currentMonthIndex] = {
          ...baseData[currentMonthIndex],
          revenue: newCumulative,
        };

        // Update future months to extend from the correct base
        for (let i = currentMonthIndex + 1; i < 12; i++) {
          if (baseData[i].bestCase !== null) {
            const monthsAhead = i - currentMonthIndex;
            const avgMonthlyRevenue = currentMonthRevenue; // Use current month as baseline
            baseData[i] = {
              ...baseData[i],
              revenue: newCumulative, // Flat line extends current cumulative
              bestCase: Math.round(newCumulative + (monthsAhead * avgMonthlyRevenue * 1.2)),
              worstCase: Math.round(newCumulative + (monthsAhead * avgMonthlyRevenue * 0.8)),
            };
          }
        }
      }
    }

    return baseData;
  }, [monthlyAggregates, currentMonthRevenue]);

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
    () => transformEntriesToTopList(entries, billingResult, projectRates, projectCanonicalIdLookup, 5, 'hours'),
    [entries, billingResult, projectRates, projectCanonicalIdLookup]
  );

  // Top 5 by revenue for the selected month
  const topFiveByRevenue = useMemo(
    () => transformEntriesToTopList(entries, billingResult, projectRates, projectCanonicalIdLookup, 5, 'revenue'),
    [entries, billingResult, projectRates, projectCanonicalIdLookup]
  );

  // Loading state
  if (loading) {
    return (
      <section className="space-y-4">
        {showResources && (
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
        )}
        {showTrends && (
          <>
            <Card variant="default" padding="lg">
              <div className="flex items-center justify-center h-[250px]">
                <Spinner size="lg" />
              </div>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </>
        )}
      </section>
    );
  }

  // Empty state - no data
  if (resources.length === 0 && monthlyAggregates.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      {/* Resources section: Hours by Resource + Top 5 lists */}
      {showResources && (
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
      )}

      {/* Trends section: 12-Month Revenue Trend + MoM + CAGR */}
      {showTrends && (
        <>
          {/* 12-Month Revenue Trend - Full Width */}
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

          {/* MoM Growth Rate and CAGR Projection - Two columns */}
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
                  Annual Revenue (CAGR)
                </h3>
                {growthStats.cagr !== null && (
                  <span className={`text-sm font-mono ${growthStats.cagr >= 0 ? 'text-success' : 'text-error'}`}>
                    CAGR: {growthStats.cagr >= 0 ? '+' : ''}{growthStats.cagr.toFixed(1)}%
                  </span>
                )}
              </div>
              {cagrData.some(d => d.actual !== null || d.projected !== null) ? (
                <>
                  <CAGRChartAtom data={cagrData} />
                  {/* YoY Growth Rates */}
                  {growthStats.yoyGrowthRates.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-vercel-gray-100">
                      <div className="flex items-center gap-6 justify-center">
                        {growthStats.yoyGrowthRates.map((yoy) => (
                          <div key={`${yoy.fromYear}-${yoy.toYear}`} className="text-center">
                            <div className="text-xs text-vercel-gray-400 mb-1">
                              {yoy.fromYear}→{yoy.toYear}
                            </div>
                            <div className={`text-sm font-mono font-medium ${yoy.rate >= 0 ? 'text-success' : 'text-error'}`}>
                              {yoy.rate >= 0 ? '+' : ''}{yoy.rate.toFixed(1)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                  No data available for projection
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </section>
  );
}

export default DashboardChartsRow;
