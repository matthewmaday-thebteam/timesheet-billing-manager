import { useState, useMemo, useEffect } from 'react';
import { startOfMonth, endOfMonth, format, eachDayOfInterval, isWeekend, isSameDay, min } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useProjectTableEntities } from '../../hooks/useProjectTableEntities';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useBilling } from '../../hooks/useBilling';
import { useBillings } from '../../hooks/useBillings';
import { useCombinedRevenue } from '../../hooks/useCombinedRevenue';
import { useTimeOff } from '../../hooks/useTimeOff';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../utils/billing';
import {
  transformToLineChartData,
  transformToQuarterlyChartData,
  transformToMoMGrowthData,
  transformToCAGRProjectionData,
  calculateGrowthStats,
  aggregateDailyRevenue,
} from '../../utils/chartTransforms';
import { chartColors, formatChartCurrency } from '../atoms/charts/chartTheme';
import { MetricCard } from '../MetricCard';
import { Card } from '../Card';
import { Select } from '../Select';
import { Spinner } from '../Spinner';
import { MonthPicker } from '../MonthPicker';
import { LineGraphAtom } from '../atoms/charts/LineGraphAtom';
import { BarChartAtom } from '../atoms/charts/BarChartAtom';
import { CAGRChartAtom } from '../atoms/charts/CAGRChartAtom';
import type { DateRange, MonthSelection, BulgarianHoliday } from '../../types';
import { HISTORICAL_MONTHS } from '../../config/chartConfig';
import { getCurrentMonth } from '../../hooks/useMonthlyRates';

export function InvestorDashboardPage() {
  // Month selection state — drives all data fetching
  const [selectedMonth, setSelectedMonth] = useState<MonthSelection>(getCurrentMonth);

  // Derive dateRange from selected month
  const dateRange = useMemo<DateRange>(() => {
    const monthDate = new Date(selectedMonth.year, selectedMonth.month - 1, 1);
    return {
      start: startOfMonth(monthDate),
      end: endOfMonth(monthDate),
    };
  }, [selectedMonth]);

  // Determine if we're viewing a past (completed) month
  const current = getCurrentMonth();
  const isViewingPastMonth =
    selectedMonth.year < current.year ||
    (selectedMonth.year === current.year && selectedMonth.month < current.month);

  // Fetch timesheet data with extended months for trend charts
  const {
    entries,
    loading,
    resources: resourceSummaries,
    projectCanonicalIdLookup,
  } = useTimesheetData(dateRange, { extendedMonths: HISTORICAL_MONTHS });

  // Fetch canonical project count
  const { projects: canonicalProjects } = useProjectTableEntities();

  // Fetch monthly rates
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Fetch fixed billings
  const { companyBillings, isLoading: billingsLoading } = useBillings({ dateRange });

  // Compute combined revenue for all 12 chart months
  const { combinedRevenueByMonth, loading: combinedRevenueLoading } = useCombinedRevenue({
    dateRange,
    extendedMonths: HISTORICAL_MONTHS,
  });

  // Use billing from summary table
  const { totalRevenue, billingResult } = useBilling({
    selectedMonth,
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

  // Earned revenue: billed revenue + dollar value of hours rolled over or lost to max cap
  // For milestone projects the milestone IS the earned amount (no rollover concept)
  const rolledOverRevenue = useMemo(() => {
    let extra = 0;
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        // Skip milestone-linked projects — milestone amount is the earned amount
        if (project.projectId && milestoneByExternalProjectId.has(project.projectId)) continue;
        extra += (project.carryoverOut + project.unbillableHours) * project.rate;
      }
    }
    return extra;
  }, [billingResult.companies, milestoneByExternalProjectId]);
  const earnedTotalRevenue = combinedTotalRevenue + rolledOverRevenue;

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

    for (const project of projectsWithRates) {
      if (project.effectiveRate > 0) {
        totalRate += project.effectiveRate;
        ratedCount++;
      }
    }

    const averageRate = ratedCount > 0 ? totalRate / ratedCount : 0;

    return {
      averageRate,
      totalProjects: projectsWithRates.length,
    };
  }, [projectsWithRates]);

  const currentYear = new Date().getFullYear();

  // ========== YTD REVENUE ==========
  const ytdRevenue = useMemo(() => {
    const yearPrefix = `${currentYear}-`;
    let total = 0;
    for (const [monthKey, amount] of combinedRevenueByMonth) {
      if (monthKey.startsWith(yearPrefix)) {
        total += amount;
      }
    }
    return total;
  }, [combinedRevenueByMonth, currentYear]);

  // ========== QUARTERLY REVENUE ==========
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);
  const quarterlyRevenue = useMemo(() => {
    const startMonth = (currentQuarter - 1) * 3 + 1;
    const monthKeys = [0, 1, 2].map(offset => {
      const m = startMonth + offset;
      return `${currentYear}-${String(m).padStart(2, '0')}`;
    });
    let total = 0;
    for (const key of monthKeys) {
      total += combinedRevenueByMonth.get(key) ?? 0;
    }
    return total;
  }, [combinedRevenueByMonth, currentYear, currentQuarter]);

  // ========== COMPANY HOLIDAYS (current month, weekdays only) ==========
  const companyHolidayCount = useMemo(() => {
    const currentMonth = dateRange.start.getMonth();
    let count = 0;
    for (const h of holidays) {
      const hDate = new Date(h.holiday_date);
      if (hDate.getMonth() === currentMonth && !isWeekend(hDate)) {
        count++;
      }
    }
    return count;
  }, [holidays, dateRange.start]);

  // ========== WORKDAYS IN MONTH (for avg daily revenue) ==========
  const workdaysInMonth = useMemo(() => {
    const allDays = eachDayOfInterval({
      start: dateRange.start,
      end: dateRange.end,
    });
    const holidayDates = holidays.map(h => new Date(h.holiday_date));
    return allDays.filter(day => {
      if (isWeekend(day)) return false;
      if (holidayDates.some(h => isSameDay(h, day))) return false;
      return true;
    }).length;
  }, [dateRange, holidays]);

  const remainingWorkdays = useMemo(() => {
    // Past months are complete — no remaining workdays
    if (isViewingPastMonth) return 0;
    const today = new Date();
    const startDay = today > dateRange.end ? dateRange.end : today < dateRange.start ? dateRange.start : today;
    const remainingDays = eachDayOfInterval({
      start: startDay,
      end: dateRange.end,
    });
    const holidayDates = holidays.map(h => new Date(h.holiday_date));
    return remainingDays.filter(day => {
      if (isWeekend(day)) return false;
      if (holidayDates.some(h => isSameDay(h, day))) return false;
      return true;
    }).length;
  }, [dateRange, holidays, isViewingPastMonth]);

  const avgDailyRevenue = workdaysInMonth > 0 ? earnedTotalRevenue / workdaysInMonth : 0;
  const projectedRevenue = earnedTotalRevenue + (avgDailyRevenue * remainingWorkdays);
  const avgDailyBilledRevenue = workdaysInMonth > 0 ? combinedTotalRevenue / workdaysInMonth : 0;
  const projectedBilledRevenue = combinedTotalRevenue + (avgDailyBilledRevenue * remainingWorkdays);

  // ========== PROJECTED ANNUAL REVENUE ==========
  const projectedAnnualRevenue = useMemo(() => {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-based
    const projectedCurrentMonth = earnedTotalRevenue + (avgDailyRevenue * remainingWorkdays);
    if (month === 1) return projectedCurrentMonth * 12;
    let completedMonthsRevenue = 0;
    for (let m = 1; m < month; m++) {
      const key = `${currentYear}-${String(m).padStart(2, '0')}`;
      completedMonthsRevenue += combinedRevenueByMonth.get(key) ?? 0;
    }
    return Math.round((completedMonthsRevenue + projectedCurrentMonth) / month * 12);
  }, [combinedRevenueByMonth, currentYear, earnedTotalRevenue, avgDailyRevenue, remainingWorkdays]);

  // ========== PROJECTED QUARTERLY REVENUE ==========
  const projectedQuarterlyRevenue = useMemo(() => {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-based
    const startMonth = (currentQuarter - 1) * 3 + 1;
    const monthInQuarter = month - startMonth + 1; // 1, 2, or 3
    const projectedCurrentMonth = earnedTotalRevenue + (avgDailyRevenue * remainingWorkdays);
    if (monthInQuarter === 1) return projectedCurrentMonth * 3;
    let completedQuarterMonthsRevenue = 0;
    for (let m = startMonth; m < month; m++) {
      const key = `${currentYear}-${String(m).padStart(2, '0')}`;
      completedQuarterMonthsRevenue += combinedRevenueByMonth.get(key) ?? 0;
    }
    return Math.round((completedQuarterMonthsRevenue + projectedCurrentMonth) / monthInQuarter * 3);
  }, [combinedRevenueByMonth, currentYear, currentQuarter, earnedTotalRevenue, avgDailyRevenue, remainingWorkdays]);

  // ========== RESOURCE ABSENCES (working days, current month) ==========
  const resourceAbsenceDays = useMemo(() => {
    const holidayDates = holidays.map(h => new Date(h.holiday_date));
    let totalDays = 0;
    for (const to of timeOff) {
      const ptoStart = new Date(to.start_date);
      const ptoEnd = new Date(to.end_date);
      const overlapStart = ptoStart < dateRange.start ? dateRange.start : ptoStart;
      const overlapEnd = ptoEnd > dateRange.end ? dateRange.end : ptoEnd;
      if (overlapStart <= overlapEnd) {
        const daysInRange = eachDayOfInterval({ start: overlapStart, end: overlapEnd });
        for (const day of daysInRange) {
          if (!isWeekend(day) && !holidayDates.some(h => isSameDay(h, day))) {
            totalDays++;
          }
        }
      }
    }
    return totalDays;
  }, [timeOff, dateRange, holidays]);

  // ========== PROJECT RATES MAP (for daily revenue chart) ==========
  const projectRatesMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projectsWithRates) {
      if (p.externalProjectId && p.effectiveRate > 0) {
        map.set(p.externalProjectId, p.effectiveRate);
      }
    }
    return map;
  }, [projectsWithRates]);

  // ========== CHART DATA ==========
  // Line chart data — built directly from combinedRevenueByMonth (billing engine output)
  const lineData = useMemo(
    () => transformToLineChartData(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

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

  // Quarterly chart data — slice of the 12-month data for the selected quarter
  const quarterlyData = useMemo(
    () => transformToQuarterlyChartData(lineData, Number(selectedQuarter)),
    [lineData, selectedQuarter]
  );

  // MoM Growth data
  const momGrowthData = useMemo(
    () => transformToMoMGrowthData(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // CAGR data
  const cagrData = useMemo(
    () => transformToCAGRProjectionData(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // Growth stats
  const growthStats = useMemo(
    () => calculateGrowthStats(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // Daily revenue bar chart data
  const dailyRevenueData = useMemo(
    () => aggregateDailyRevenue(entries, projectRatesMap, dateRange.start, projectCanonicalIdLookup),
    [entries, projectRatesMap, dateRange.start, projectCanonicalIdLookup]
  );

  // Currency formatter for daily revenue Y-axis
  const dailyRevenueYAxisFormatter = useMemo(
    () => (value: number) => formatChartCurrency(value),
    []
  );

  // Currency formatter for daily revenue tooltip
  const dailyRevenueTooltipFormatter = useMemo(
    () => (value: number) => formatCurrency(value),
    []
  );

  const isLoading = loading || billingsLoading || combinedRevenueLoading;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Investor Dashboard</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Key metrics for <span className="text-bteam-brand font-medium">{format(dateRange.start, 'MMMM yyyy')}</span>
          </p>
        </div>
        <MonthPicker
          selectedMonth={selectedMonth}
          onChange={setSelectedMonth}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading data...</span>
        </div>
      ) : (
        <>
          {/* Monthly Revenue Row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard
              title={isViewingPastMonth ? 'Total Monthly Revenue' : 'Total Monthly Revenue (MTD)'}
              value={formatCurrency(combinedTotalRevenue)}
              secondaryLabel={isViewingPastMonth ? undefined : 'Projected'}
              secondaryValue={isViewingPastMonth ? undefined : formatCurrency(projectedBilledRevenue)}
            />
            <MetricCard
              title={isViewingPastMonth ? 'Total Earned Revenue' : 'Total Earned Revenue (MTD)'}
              value={formatCurrency(earnedTotalRevenue)}
              secondaryLabel={isViewingPastMonth ? undefined : 'Projected'}
              secondaryValue={isViewingPastMonth ? undefined : formatCurrency(projectedRevenue)}
            />
            <MetricCard
              title="Avg Daily Revenue"
              value={formatCurrency(avgDailyRevenue)}
              secondaryLabel="Billed"
              secondaryValue={formatCurrency(avgDailyBilledRevenue)}
            />
          </div>

          {/* Cumulative Revenue Row */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard
              title="Total Revenue (YTD)"
              value={formatCurrency(ytdRevenue)}
              secondaryLabel="Projected"
              secondaryValue={formatCurrency(projectedAnnualRevenue)}
            />
            <MetricCard
              title={`Q${currentQuarter} Revenue`}
              value={formatCurrency(quarterlyRevenue)}
              secondaryLabel="Projected"
              secondaryValue={formatCurrency(projectedQuarterlyRevenue)}
            />
            <MetricCard
              title="Average Rate"
              value={`$${rateMetrics.averageRate.toFixed(2)}`}
            />
          </div>

          {/* Operational Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <MetricCard
              title="Projects"
              value={canonicalProjects.length.toLocaleString('en-US')}
            />
            <MetricCard
              title="Resources"
              value={resourceSummaries.length.toLocaleString('en-US')}
            />
            <MetricCard
              title="Company Holidays"
              value={companyHolidayCount.toLocaleString('en-US')}
            />
            <MetricCard
              title="Resource Absences"
              value={resourceAbsenceDays.toLocaleString('en-US')}
            />
            <MetricCard
              title="Utilization"
              value={`${utilizationPercent.toFixed(1)}%`}
            />
          </div>

          {/* Daily Revenue */}
          <Card variant="default" padding="lg">
            <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
              Daily Revenue
            </h3>
            {dailyRevenueData.some(d => d.value !== null && d.value > 0) ? (
              <BarChartAtom
                data={dailyRevenueData}
                fillColor={chartColors.bteamBrand}
                valueFormatter={dailyRevenueTooltipFormatter}
                yAxisFormatter={dailyRevenueYAxisFormatter}
                valueLabel="Revenue"
              />
            ) : (
              <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                No revenue data for this month
              </div>
            )}
          </Card>

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
    </div>
  );
}
