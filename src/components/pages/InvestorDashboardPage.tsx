import { useState, useMemo, useEffect } from 'react';
import { startOfMonth, endOfMonth, format, eachDayOfInterval, isWeekend, isSameDay, min } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useProjectTableEntities } from '../../hooks/useProjectTableEntities';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useUnifiedBilling } from '../../hooks/useUnifiedBilling';
import { useBillings } from '../../hooks/useBillings';
import { useResources } from '../../hooks/useResources';
import { useTimeOff } from '../../hooks/useTimeOff';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../utils/billing';
import {
  transformToLineChartData,
  transformToMoMGrowthData,
  transformToCAGRProjectionData,
  calculateGrowthStats,
} from '../../utils/chartTransforms';
import { MetricCard } from '../MetricCard';
import { Card } from '../Card';
import { Spinner } from '../Spinner';
import { LineGraphAtom } from '../atoms/charts/LineGraphAtom';
import { BarChartAtom } from '../atoms/charts/BarChartAtom';
import { CAGRChartAtom } from '../atoms/charts/CAGRChartAtom';
import type { DateRange, MonthSelection, BulgarianHoliday } from '../../types';
import { HISTORICAL_MONTHS } from '../../config/chartConfig';

const TARGET_RATE_2026 = 60;

export function InvestorDashboardPage() {
  const [dateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  // Fetch timesheet data with extended months for trend charts
  const {
    entries,
    monthlyAggregates,
    projectCanonicalIdLookup,
    loading,
  } = useTimesheetData(dateRange, { extendedMonths: HISTORICAL_MONTHS });

  // Fetch canonical project count
  const { projects: canonicalProjects } = useProjectTableEntities();

  // Fetch resources count
  const { resources } = useResources();

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Fetch fixed billings
  const { companyBillings, isLoading: billingsLoading } = useBillings({ dateRange });

  // Use unified billing calculation
  const { totalRevenue, billingResult } = useUnifiedBilling({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
  });

  // Build lookup: internal UUID -> externalProjectId
  const internalToExternalId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsWithRates) {
      if (p.projectId && p.externalProjectId) {
        map.set(p.projectId, p.externalProjectId);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Build milestone lookup
  const milestoneByExternalProjectId = useMemo(() => {
    const map = new Map<string, { totalCents: number; billingId: string }>();
    for (const company of companyBillings) {
      for (const billing of company.billings) {
        if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
          const externalId = internalToExternalId.get(billing.linkedProjectId);
          if (externalId) {
            const existing = map.get(externalId);
            map.set(externalId, {
              totalCents: (existing?.totalCents || 0) + billing.totalCents,
              billingId: billing.id,
            });
          }
        }
      }
    }
    return map;
  }, [companyBillings, internalToExternalId]);

  // Calculate filtered billing cents (excludes linked milestones)
  const filteredBillingCents = useMemo(() => {
    let total = 0;
    for (const company of companyBillings) {
      for (const billing of company.billings) {
        if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
          const externalId = internalToExternalId.get(billing.linkedProjectId);
          if (externalId) continue;
        }
        total += billing.totalCents;
      }
    }
    return total;
  }, [companyBillings, internalToExternalId]);

  // Calculate milestone adjustment
  const milestoneAdjustment = useMemo(() => {
    let adjustment = 0;
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          const milestone = milestoneByExternalProjectId.get(project.projectId);
          if (milestone) {
            adjustment += (milestone.totalCents / 100) - project.billedRevenue;
          }
        }
      }
    }
    return adjustment;
  }, [billingResult.companies, milestoneByExternalProjectId]);

  // Combined total revenue
  const combinedTotalRevenue = totalRevenue + (filteredBillingCents / 100) + milestoneAdjustment;

  // ========== UTILIZATION CALCULATION (from EmployeesPage) ==========
  const { entities: employees } = useEmployeeTableEntities();
  const { timeOff } = useTimeOff({
    startDate: dateRange.start,
    endDate: dateRange.end,
    approvedOnly: true,
  });

  const [holidays, setHolidays] = useState<BulgarianHoliday[]>([]);
  useEffect(() => {
    async function fetchHolidays() {
      const year = dateRange.start.getFullYear();
      const { data } = await supabase
        .from('bulgarian_holidays')
        .select('*')
        .eq('year', year);
      setHolidays(data || []);
    }
    fetchHolidays();
  }, [dateRange.start]);

  const utilizationPercent = useMemo(() => {
    const today = new Date();
    const effectiveEndDate = min([dateRange.end, today]);

    const daysInPeriod = eachDayOfInterval({
      start: dateRange.start,
      end: effectiveEndDate,
    });

    const holidayDates = holidays.map(h => new Date(h.holiday_date));

    const workingDays = daysInPeriod.filter(day => {
      if (isWeekend(day)) return false;
      if (holidayDates.some(h => isSameDay(h, day))) return false;
      return true;
    }).length;

    const billableEmployees = employees.filter(e => {
      const empType = e.employment_type?.name;
      return empType === 'Full-time' || empType === 'Part-time';
    });

    let totalAvailableHours = 0;

    for (const employee of billableEmployees) {
      const hoursPerDay = employee.employment_type?.name === 'Full-time' ? 8 : 4;
      const displayName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.external_label;

      let ptoDays = 0;
      for (const to of timeOff) {
        if (to.employee_name === displayName || to.resource_id === employee.id) {
          const ptoStart = new Date(to.start_date);
          const ptoEnd = new Date(to.end_date);
          const overlapStart = ptoStart < dateRange.start ? dateRange.start : ptoStart;
          const overlapEnd = ptoEnd > effectiveEndDate ? effectiveEndDate : ptoEnd;

          if (overlapStart <= overlapEnd) {
            const ptoDaysInRange = eachDayOfInterval({ start: overlapStart, end: overlapEnd });
            for (const day of ptoDaysInRange) {
              if (!isWeekend(day) && !holidayDates.some(h => isSameDay(h, day))) {
                ptoDays++;
              }
            }
          }
        }
      }

      const availableHours = (workingDays - ptoDays) * hoursPerDay;
      totalAvailableHours += availableHours;
    }

    const totalWorkedHours = billingResult.roundedHours;

    return totalAvailableHours > 0
      ? (totalWorkedHours / totalAvailableHours) * 100
      : 0;
  }, [dateRange, holidays, employees, timeOff, billingResult]);

  // ========== RATES METRICS (from RatesPage) ==========
  const rateMetrics = useMemo(() => {
    let totalRate = 0;
    let ratedCount = 0;
    let atTargetRateCount = 0;

    for (const project of projectsWithRates) {
      if (project.effectiveRate > 0) {
        totalRate += project.effectiveRate;
        ratedCount++;
      }
      if (project.effectiveRate >= TARGET_RATE_2026) {
        atTargetRateCount++;
      }
    }

    const averageRate = ratedCount > 0 ? totalRate / ratedCount : 0;

    return {
      averageRate,
      atTargetRateCount,
      totalProjects: projectsWithRates.length,
    };
  }, [projectsWithRates]);

  // ========== CHART DATA ==========
  // Create corrected monthlyAggregates with current month revenue
  const correctedMonthlyAggregates = useMemo(() => {
    if (monthlyAggregates.length === 0) return monthlyAggregates;

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    return monthlyAggregates.map(agg => {
      if (agg.month === currentMonthKey) {
        return { ...agg, totalRevenue: combinedTotalRevenue };
      }
      return agg;
    });
  }, [monthlyAggregates, combinedTotalRevenue]);

  // Line chart data
  const lineData = useMemo(() => {
    const baseData = transformToLineChartData(correctedMonthlyAggregates);

    if (correctedMonthlyAggregates.length > 0) {
      const currentMonthIndex = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      let cumulativeRevenue = 0;
      for (const agg of correctedMonthlyAggregates) {
        const [aggYear, aggMonth] = agg.month.split('-').map(Number);
        if (aggYear === currentYear && aggMonth - 1 <= currentMonthIndex) {
          cumulativeRevenue += agg.totalRevenue;
        }
      }

      for (let i = currentMonthIndex + 1; i < 12; i++) {
        if (baseData[i].bestCase !== null) {
          const monthsAhead = i - currentMonthIndex;
          const avgMonthlyRevenue = combinedTotalRevenue;
          baseData[i] = {
            ...baseData[i],
            revenue: Math.round(cumulativeRevenue),
            bestCase: Math.round(cumulativeRevenue + (monthsAhead * avgMonthlyRevenue * 1.2)),
            worstCase: Math.round(cumulativeRevenue + (monthsAhead * avgMonthlyRevenue * 0.8)),
          };
        }
      }
    }

    return baseData;
  }, [correctedMonthlyAggregates, combinedTotalRevenue]);

  // MoM Growth data
  const momGrowthData = useMemo(
    () => transformToMoMGrowthData(correctedMonthlyAggregates),
    [correctedMonthlyAggregates]
  );

  // CAGR data
  const cagrData = useMemo(
    () => transformToCAGRProjectionData(correctedMonthlyAggregates),
    [correctedMonthlyAggregates]
  );

  // Growth stats
  const growthStats = useMemo(
    () => calculateGrowthStats(correctedMonthlyAggregates),
    [correctedMonthlyAggregates]
  );

  const currentYear = new Date().getFullYear();
  const isLoading = loading || billingsLoading;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-vercel-gray-600">Investor Dashboard</h1>
        <p className="text-sm text-vercel-gray-400 mt-1">
          Key metrics for <span className="text-bteam-brand font-medium">{format(dateRange.start, 'MMMM yyyy')}</span>
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading data...</span>
        </div>
      ) : (
        <>
          {/* Top Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <MetricCard
              title="Total Revenue"
              value={formatCurrency(combinedTotalRevenue)}
            />
            <MetricCard
              title="Projects"
              value={canonicalProjects.length.toLocaleString('en-US')}
            />
            <MetricCard
              title="Resources"
              value={resources.length.toLocaleString('en-US')}
            />
            <MetricCard
              title="Utilization"
              value={`${utilizationPercent.toFixed(1)}%`}
            />
            <MetricCard
              title="Average Rate"
              value={`$${rateMetrics.averageRate.toFixed(2)}`}
            />
            <MetricCard
              title={`At ${currentYear} Target`}
              value={rateMetrics.atTargetRateCount.toLocaleString('en-US')}
            />
          </div>

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
    </div>
  );
}
