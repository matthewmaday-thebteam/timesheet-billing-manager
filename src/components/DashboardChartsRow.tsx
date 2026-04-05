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
  transformToLineChartData,
  transformToQuarterlyChartData,
  transformToMoMGrowthData,
  transformToCAGRProjectionData,
  calculateGrowthStats,
} from '../utils/chartTransforms';
import { formatCurrency } from '../utils/billing';
import type { PieChartDataPoint } from '../types/charts';

/** Data for top resources list display */
interface TopResourceItem {
  name: string;
  hours: number;
  revenue: number;
}

export interface DashboardChartsRowProps {
  /** Pre-computed pie chart data from Layer 2 (hours per employee) */
  pieData: PieChartDataPoint[];
  /** Pre-computed top 5 by hours from Layer 2 */
  topFiveByHours: TopResourceItem[];
  /** Pre-computed top 5 by revenue from Layer 2 */
  topFiveByRevenue: TopResourceItem[];
  /** Pre-computed combined revenue by month key (YYYY-MM -> dollars) from billing engine */
  combinedRevenueByMonth: Map<string, number>;
  /** Loading state */
  loading?: boolean;
  /** Which section to display: 'resources' (pie + top 5), 'trends' (revenue + MoM + CAGR), or 'all' */
  section?: 'resources' | 'trends' | 'all';
  /** Override projected annual revenue (from shared client-side hook) for chart band calculation */
  projectedAnnualRevenue?: number | null;
}

export function DashboardChartsRow({
  pieData,
  topFiveByHours,
  topFiveByRevenue,
  combinedRevenueByMonth,
  loading = false,
  section = 'all',
  projectedAnnualRevenue: projectedAnnualRevenueOverride,
}: DashboardChartsRowProps) {
  const showResources = section === 'resources' || section === 'all';
  const showTrends = section === 'trends' || section === 'all';

  // Quarter selector state -- defaults to current quarter
  const [selectedQuarter, setSelectedQuarter] = useState<string>(() =>
    String(Math.ceil((new Date().getMonth() + 1) / 3))
  );

  const quarterOptions = [
    { value: '1', label: 'Q1 (Jan-Mar)' },
    { value: '2', label: 'Q2 (Apr-Jun)' },
    { value: '3', label: 'Q3 (Jul-Sep)' },
    { value: '4', label: 'Q4 (Oct-Dec)' },
  ];

  // Growth statistics for display (computed first -- lineData depends on projectedAnnualRevenue)
  const growthStats = useMemo(
    () => calculateGrowthStats(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // Line chart data -- built directly from combinedRevenueByMonth (billing engine output)
  // Use shared client-side projected revenue only -- no CAGR fallback
  const effectiveProjectedRevenue = projectedAnnualRevenueOverride ?? null;
  const lineData = useMemo(
    () => transformToLineChartData(combinedRevenueByMonth, undefined, undefined, effectiveProjectedRevenue),
    [combinedRevenueByMonth, effectiveProjectedRevenue]
  );

  // Quarterly chart data -- slice of the 12-month data for the selected quarter
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
  if (pieData.length === 0 && combinedRevenueByMonth.size === 0) {
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
                <div>
                  <h3 className="text-lg font-semibold text-vercel-gray-600">
                    MoM Growth Rate
                  </h3>
                  <p className="text-xs text-vercel-gray-400">Excludes current month</p>
                </div>
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
