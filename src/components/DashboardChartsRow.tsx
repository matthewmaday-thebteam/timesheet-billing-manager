/**
 * DashboardChartsRow - Molecule Component
 *
 * Displays charts in a two-row layout:
 * - Row 1: 12-Month Revenue Trend (2/3) | Quarterly Revenue (1/3)
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

import { useMemo, useState } from 'react';
import { Card } from './Card';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { PieChartAtom } from './atoms/charts/PieChartAtom';
import { LineGraphAtom } from './atoms/charts/LineGraphAtom';
import { BarChartAtom } from './atoms/charts/BarChartAtom';
import { CAGRChartAtom } from './atoms/charts/CAGRChartAtom';
import {
  transformResourcesToPieData,
  transformToLineChartData,
  transformToQuarterlyChartData,
  transformToMoMGrowthData,
  transformToCAGRProjectionData,
  calculateGrowthStats,
} from '../utils/chartTransforms';
import { formatCurrency, DEFAULT_ROUNDING_INCREMENT } from '../utils/billing';
import type { ResourceSummary, TimesheetEntry, RoundingIncrement } from '../types';
import type { MonthlyBillingResult } from '../utils/billingCalculations';

/**
 * Round minutes up to the nearest increment (matching billingCalculations.ts)
 */
function roundMinutes(minutes: number, increment: RoundingIncrement): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

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
  /** Project rates lookup by external project_id (fallback) */
  projectRates: Map<string, number>;
  /** Canonical project ID lookup (external project_id -> canonical project_id) */
  projectCanonicalIdLookup?: Map<string, string>;
  /** Canonical user ID to display name lookup (user_id -> canonical display name) */
  userIdToDisplayNameLookup?: Map<string, string>;
  /** Unified billing result from useUnifiedBilling */
  billingResult?: MonthlyBillingResult;
  /** Pre-computed combined revenue by month key (YYYY-MM -> dollars) from billing engine */
  combinedRevenueByMonth: Map<string, number>;
  /** Loading state */
  loading?: boolean;
  /** Which section to display: 'resources' (pie + top 5), 'trends' (revenue + MoM + CAGR), or 'all' */
  section?: 'resources' | 'trends' | 'all';
}

/**
 * Transform timesheet entries into top N resource list with hours and revenue.
 * Uses the unified billing result for accurate revenue calculations.
 * Applies rounding per task to match Employees page calculations.
 * @param sortBy - 'hours' or 'revenue' - determines sort order
 */
function transformEntriesToTopList(
  entries: TimesheetEntry[],
  billingResult: MonthlyBillingResult | undefined,
  projectRates: Map<string, number>,
  projectCanonicalIdLookup: Map<string, string> | undefined,
  userIdToDisplayNameLookup: Map<string, string> | undefined,
  topN: number = 5,
  sortBy: 'hours' | 'revenue' = 'hours'
): TopResourceItem[] {
  // Helper to get canonical project ID
  const getCanonicalProjectId = (projectId: string | null): string => {
    if (!projectId) return '';
    return projectCanonicalIdLookup?.get(projectId) || projectId;
  };

  // Build project lookups from billing result (keyed by canonical project ID)
  const projectRevenues = new Map<string, number>();
  const projectActualMinutes = new Map<string, number>();
  const projectRounding = new Map<string, RoundingIncrement>();

  if (billingResult) {
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        const projectId = project.projectId || '';
        projectRevenues.set(projectId, project.billedRevenue);
        projectActualMinutes.set(projectId, project.actualMinutes);
        projectRounding.set(projectId, project.rounding);
      }
    }
  }

  // If no billing result, fall back to simple calculation using canonical project IDs
  if (!billingResult) {
    for (const entry of entries) {
      const canonicalProjectId = getCanonicalProjectId(entry.project_id);
      const current = projectActualMinutes.get(canonicalProjectId) || 0;
      projectActualMinutes.set(canonicalProjectId, current + entry.total_minutes);

      const rate = projectRates.get(canonicalProjectId) ?? 0;
      const currentRevenue = projectRevenues.get(canonicalProjectId) || 0;
      projectRevenues.set(canonicalProjectId, currentRevenue + (entry.total_minutes / 60) * rate);
    }
  }

  // Group entries by user -> project -> task to apply rounding correctly
  // Structure: userName -> projectId -> taskName -> minutes
  const userProjectTasks = new Map<string, Map<string, Map<string, number>>>();

  for (const entry of entries) {
    const userName = (entry.user_id && userIdToDisplayNameLookup?.get(entry.user_id)) || entry.user_name;
    const canonicalProjectId = getCanonicalProjectId(entry.project_id);
    const taskName = entry.task_name || 'No Task';

    if (!userProjectTasks.has(userName)) {
      userProjectTasks.set(userName, new Map());
    }
    const projectMap = userProjectTasks.get(userName)!;

    if (!projectMap.has(canonicalProjectId)) {
      projectMap.set(canonicalProjectId, new Map());
    }
    const taskMap = projectMap.get(canonicalProjectId)!;

    const currentMinutes = taskMap.get(taskName) || 0;
    taskMap.set(taskName, currentMinutes + entry.total_minutes);
  }

  // Calculate rounded hours and proportional revenue per user
  const userStats = new Map<string, { roundedMinutes: number; rawMinutes: number; revenue: number }>();

  for (const [userName, projectMap] of userProjectTasks) {
    let userRoundedMinutes = 0;
    let userRawMinutes = 0;
    let userRevenue = 0;

    for (const [projectId, taskMap] of projectMap) {
      const rounding = projectRounding.get(projectId) ?? DEFAULT_ROUNDING_INCREMENT;
      let projectUserRawMinutes = 0;
      let projectUserRoundedMinutes = 0;

      // Apply rounding per task
      for (const [, taskMinutes] of taskMap) {
        projectUserRawMinutes += taskMinutes;
        projectUserRoundedMinutes += roundMinutes(taskMinutes, rounding);
      }

      userRawMinutes += projectUserRawMinutes;
      userRoundedMinutes += projectUserRoundedMinutes;

      // Calculate proportional revenue based on raw minutes share
      const totalProjectMinutes = projectActualMinutes.get(projectId) || 1;
      const projectRevenue = projectRevenues.get(projectId) || 0;
      const userShare = (projectUserRawMinutes / totalProjectMinutes) * projectRevenue;
      userRevenue += userShare;
    }

    userStats.set(userName, {
      roundedMinutes: userRoundedMinutes,
      rawMinutes: userRawMinutes,
      revenue: userRevenue,
    });
  }

  // Convert to list format using rounded minutes for hours
  const listData: TopResourceItem[] = Array.from(userStats.entries()).map(
    ([name, stats]) => ({
      name,
      hours: stats.roundedMinutes / 60,
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
  projectRates,
  projectCanonicalIdLookup,
  userIdToDisplayNameLookup,
  billingResult,
  combinedRevenueByMonth,
  loading = false,
  section = 'all',
}: DashboardChartsRowProps) {
  const showResources = section === 'resources' || section === 'all';
  const showTrends = section === 'trends' || section === 'all';

  // Quarter selector state — defaults to current quarter
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() =>
    String(Math.ceil((new Date().getMonth() + 1) / 3))
  );

  const quarterOptions = [
    { value: '1', label: 'Q1 (Jan–Mar)' },
    { value: '2', label: 'Q2 (Apr–Jun)' },
    { value: '3', label: 'Q3 (Jul–Sep)' },
    { value: '4', label: 'Q4 (Oct–Dec)' },
  ];

  // Transform data for charts
  const pieData = useMemo(
    () => transformResourcesToPieData(resources),
    [resources]
  );

  // Line chart data — built directly from combinedRevenueByMonth (billing engine output)
  const lineData = useMemo(
    () => transformToLineChartData(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // Quarterly chart data — slice of the 12-month data for the selected quarter
  const quarterlyData = useMemo(
    () => transformToQuarterlyChartData(lineData, Number(selectedQuarter)),
    [lineData, selectedQuarter]
  );

  // MoM Growth Rate data
  const momGrowthData = useMemo(
    () => transformToMoMGrowthData(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // CAGR Projection data
  const cagrData = useMemo(
    () => transformToCAGRProjectionData(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // Growth statistics for display
  const growthStats = useMemo(
    () => calculateGrowthStats(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // Top 5 by hours for the selected month
  const topFiveByHours = useMemo(
    () => transformEntriesToTopList(entries, billingResult, projectRates, projectCanonicalIdLookup, userIdToDisplayNameLookup, 5, 'hours'),
    [entries, billingResult, projectRates, projectCanonicalIdLookup, userIdToDisplayNameLookup]
  );

  // Top 5 by revenue for the selected month
  const topFiveByRevenue = useMemo(
    () => transformEntriesToTopList(entries, billingResult, projectRates, projectCanonicalIdLookup, userIdToDisplayNameLookup, 5, 'revenue'),
    [entries, billingResult, projectRates, projectCanonicalIdLookup, userIdToDisplayNameLookup]
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
            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
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
  if (resources.length === 0 && combinedRevenueByMonth.size === 0) {
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
          {/* 12-Month Revenue Trend (2/3) + Quarterly Revenue (1/3) */}
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
            {/* 12-Month Revenue Trend */}
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

            {/* Quarterly Revenue */}
            <Card variant="default" padding="lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-vercel-gray-600">
                  Quarterly Revenue
                </h3>
                <Select
                  value={selectedQuarter}
                  onChange={setSelectedQuarter}
                  options={quarterOptions}
                />
              </div>
              {quarterlyData.some(d => d.revenue !== null && d.revenue > 0) ? (
                <LineGraphAtom data={quarterlyData} showLegend={false} />
              ) : (
                <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                  No revenue data for {quarterOptions[Number(selectedQuarter) - 1].label}
                </div>
              )}
            </Card>
          </div>

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
