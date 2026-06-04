import { useState, useMemo, useEffect } from 'react';
import { format, eachDayOfInterval, isWeekend, isSameDay, min } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useProjectTableEntities } from '../../hooks/useProjectTableEntities';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useBilling } from '../../hooks/useBilling';
import { useCombinedRevenue } from '../../hooks/useCombinedRevenue';
import { useTimeOff } from '../../hooks/useTimeOff';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { useInvestorMetrics } from '../../hooks/useInvestorMetrics';
import { useProjectedAnnualRevenue } from '../../hooks/useProjectedAnnualRevenue';
import { useInvestorProfitEfficiency } from '../../hooks/useInvestorProfitEfficiency';
import { useInvestorConcentration } from '../../hooks/useInvestorConcentration';
import { useInvestorRevenueMix } from '../../hooks/useInvestorRevenueMix';
import { useInvestorUtilization } from '../../hooks/useInvestorUtilization';
import { useInvestorRealization } from '../../hooks/useInvestorRealization';
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  chartColors,
  pieChartColorSequence,
  formatChartCurrency,
  axisTickStyle,
  axisLineStyle,
  tooltipStyle,
  chartFontFamily,
} from '../atoms/charts/chartTheme';
import { MetricCard } from '../MetricCard';
import { Card } from '../Card';
import { Select } from '../Select';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { RangeSelector } from '../RangeSelector';
import { LineGraphAtom } from '../atoms/charts/LineGraphAtom';
import { BarChartAtom } from '../atoms/charts/BarChartAtom';
import { CAGRChartAtom } from '../atoms/charts/CAGRChartAtom';
import { TrendLineAtom } from '../atoms/charts/TrendLineAtom';
import { CompositionBarAtom } from '../atoms/charts/CompositionBarAtom';
import { useDateFilter } from '../../contexts/DateFilterContext';
import type { MonthSelection, BulgarianHoliday } from '../../types';
import { HISTORICAL_MONTHS, CHART_HEIGHT } from '../../config/chartConfig';

export function InvestorDashboardPage() {
  // Global date filter — shared across all pages via DateFilterContext
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  // Convert dateRange to MonthSelection for hooks that need it
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Determine if we're viewing a past (completed) month
  const now = new Date();
  const isViewingPastMonth =
    selectedMonth.year < now.getFullYear() ||
    (selectedMonth.year === now.getFullYear() && selectedMonth.month < now.getMonth() + 1);

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

  // Compute combined revenue for all 12 chart months
  const { combinedRevenueByMonth, loading: combinedRevenueLoading } = useCombinedRevenue({
    dateRange,
    extendedMonths: HISTORICAL_MONTHS,
  });

  // Use billing from summary table
  const { billingResult } = useBilling({
    selectedMonth,
  });

  // Fetch pre-calculated investor metrics from DB
  const { data: investorMetrics, loading: investorMetricsLoading } = useInvestorMetrics(selectedMonth);

  // Projected annual revenue — client-side shared hook (single source of truth)
  const { projectedAnnualRevenue: hookProjectedAnnualRevenue } = useProjectedAnnualRevenue();

  // ========== INVESTOR ANALYTICS (DB-COMPUTED — render only, no math) ==========
  const profitEfficiency = useInvestorProfitEfficiency();
  const concentration = useInvestorConcentration();
  const revenueMix = useInvestorRevenueMix();
  const utilization = useInvestorUtilization();
  const realization = useInvestorRealization();

  // Revenue metrics from DB (investor metrics RPC)
  const combinedTotalRevenue = (investorMetrics?.combined_total_revenue_cents ?? 0) / 100;
  const earnedTotalRevenue = (investorMetrics?.earned_total_revenue_cents ?? 0) / 100;

  // ========== UTILIZATION CALCULATION (from EmployeesPage) ==========
  const { entities: employees } = useEmployeeTableEntities();
  const { timeOff } = useTimeOff({
    startDate: dateRange.start,
    endDate: dateRange.end,
    approvedOnly: true,
  });

  // Rest-of-year time off (for projected annual vacation deductions)
  const [yearStart] = useState(() => new Date());
  const [yearEnd] = useState(() => new Date(new Date().getFullYear(), 11, 31));
  const { timeOff: yearRemainingTimeOff } = useTimeOff({
    startDate: yearStart,
    endDate: yearEnd,
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

  // ========== DB-SOURCED WORKDAY & REVENUE METRICS ==========
  const companyHolidayCount = investorMetrics?.company_holiday_count ?? 0;
  const completedWorkdays = investorMetrics?.completed_workdays ?? 0;
  const remainingWorkdays = investorMetrics?.remaining_workdays ?? 0;

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

  // ========== BILLING CAPS (for cumulative daily billing on capped projects) ==========
  const billingCaps = useMemo(() => {
    const caps = new Map<string, number>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (!project.projectId || !project.maximumApplied) continue;
        const canonicalId = projectCanonicalIdLookup?.get(project.projectId) || project.projectId;
        // billedHours = the configured max cap (when maximumApplied is true)
        // carryoverIn = hours carried from previous month that count toward the cap
        // effectiveRemaining = new hours available before cap is hit
        caps.set(canonicalId, project.billedHours - project.carryoverIn);
      }
    }
    return caps;
  }, [billingResult.companies, projectCanonicalIdLookup]);

  // ========== CHART DATA ==========
  // Growth stats (computed first — lineData depends on projectedAnnualRevenue)
  const growthStats = useMemo(
    () => calculateGrowthStats(combinedRevenueByMonth),
    [combinedRevenueByMonth]
  );

  // Line chart data — built directly from combinedRevenueByMonth (billing engine output)
  // Use shared client-side projected revenue for best/worst case bands (+/- 15%)
  // No CAGR fallback — identical formula as local calculation below
  const effectiveProjectedRevenue = hookProjectedAnnualRevenue ?? null;
  const lineData = useMemo(
    () => transformToLineChartData(combinedRevenueByMonth, undefined, undefined, effectiveProjectedRevenue),
    [combinedRevenueByMonth, effectiveProjectedRevenue]
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

  // Daily revenue bar chart data (earned + billed per day)
  const dailyRevenueData = useMemo(
    () => aggregateDailyRevenue(entries, projectRatesMap, dateRange.start, projectCanonicalIdLookup, billingCaps),
    [entries, projectRatesMap, dateRange.start, projectCanonicalIdLookup, billingCaps]
  );

  // Avg daily revenue: average of each completed workday's per-day revenue.
  // Excludes today (partial day) — only sums through yesterday.
  const { avgDailyRevenue, avgDailyBilledRevenue } = useMemo(() => {
    const today = new Date();
    const lastDayToInclude = isViewingPastMonth
      ? dailyRevenueData.length
      : today.getDate() - 1;

    let earnedSum = 0;
    let billedSum = 0;
    for (let i = 0; i < lastDayToInclude && i < dailyRevenueData.length; i++) {
      earnedSum += dailyRevenueData[i].earned;
      billedSum += dailyRevenueData[i].billed;
    }

    return {
      avgDailyRevenue: earnedSum / completedWorkdays,
      avgDailyBilledRevenue: billedSum / completedWorkdays,
    };
  }, [dailyRevenueData, completedWorkdays, isViewingPastMonth]);

  // Projected monthly: MTD + (avg daily * remaining workdays)
  const projectedRevenue = earnedTotalRevenue + (avgDailyRevenue * remainingWorkdays);
  const projectedBilledRevenue = combinedTotalRevenue + (avgDailyBilledRevenue * remainingWorkdays);

  // ========== PROJECTED ANNUAL REVENUE ==========
  // Uses the shared hook value — identical formula computed in useProjectedAnnualRevenue
  // (remainingYearWorkdays, ftVacationDays, ptVacationDays now computed inside the hook)
  const projectedAnnualRevenue = hookProjectedAnnualRevenue;

  // ========== PROJECTED QUARTERLY REVENUE ==========
  // Quarter so far + (avg daily * remaining quarter workdays) - vacation deductions
  const quarterEnd = useMemo(() => {
    const endMonth = currentQuarter * 3; // Q1→3, Q2→6, Q3→9, Q4→12
    return new Date(currentYear, endMonth, 0); // last day of that month
  }, [currentYear, currentQuarter]);

  const remainingQuarterWorkdays = useMemo(() => {
    const holidayDates = holidays.map(h => new Date(h.holiday_date));
    const days = eachDayOfInterval({ start: yearStart, end: quarterEnd });
    return days.filter(day => {
      if (isWeekend(day)) return false;
      if (holidayDates.some(h => isSameDay(h, day))) return false;
      return true;
    }).length;
  }, [holidays, yearStart, quarterEnd]);

  const { ftQuarterVacDays, ptQuarterVacDays } = useMemo(() => {
    const holidayDates = holidays.map(h => new Date(h.holiday_date));
    let ftDays = 0;
    let ptDays = 0;

    for (const employee of employees) {
      const empType = employee.employment_type?.name;
      if (empType !== 'Full-time' && empType !== 'Part-time') continue;

      const displayName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.external_label;

      for (const to of yearRemainingTimeOff) {
        if (to.employee_name !== displayName && to.resource_id !== employee.id) continue;

        const ptoStart = new Date(to.start_date);
        const ptoEnd = new Date(to.end_date);
        const overlapStart = ptoStart < yearStart ? yearStart : ptoStart;
        const overlapEnd = ptoEnd > quarterEnd ? quarterEnd : ptoEnd;

        if (overlapStart <= overlapEnd) {
          const ptoDays = eachDayOfInterval({ start: overlapStart, end: overlapEnd });
          for (const day of ptoDays) {
            if (!isWeekend(day) && !holidayDates.some(h => isSameDay(h, day))) {
              if (empType === 'Full-time') ftDays++;
              else ptDays++;
            }
          }
        }
      }
    }

    return { ftQuarterVacDays: ftDays, ptQuarterVacDays: ptDays };
  }, [employees, yearRemainingTimeOff, holidays, yearStart, quarterEnd]);

  const projectedQuarterlyRevenue = useMemo(() => {
    const avgRate = rateMetrics.averageRate;
    return quarterlyRevenue
      + (avgDailyRevenue * remainingQuarterWorkdays)
      - (ftQuarterVacDays * 8 * avgRate)
      - (ptQuarterVacDays * 5 * avgRate);
  }, [quarterlyRevenue, avgDailyRevenue, remainingQuarterWorkdays, ftQuarterVacDays, ptQuarterVacDays, rateMetrics.averageRate]);

  const isLoading = loading || combinedRevenueLoading || investorMetricsLoading;

  // ===========================================================================
  // INVESTOR ANALYTICS — PRESENTATION SHAPING ONLY (no business math)
  // All values below are DB-computed; we only divide cents→dollars for display,
  // rename keys to the chart contract, and pick the latest completed row.
  // ===========================================================================
  const centsToNum = (cents: number | null | undefined) => (cents ?? 0) / 100;

  // --- Profitability & efficiency ---
  const profitTrendData = useMemo(
    () =>
      profitEfficiency.rows.map((r) => ({
        month: r.month,
        all_in_profit: centsToNum(r.all_in_profit_cents),
        all_in_margin_pct: r.all_in_margin_pct,
        ts_margin_pct: r.ts_margin_pct,
        cost_coverage_pct: r.cost_coverage_pct,
      })),
    [profitEfficiency.rows]
  );
  const latestProfit = profitEfficiency.rows.at(-1) ?? null;
  // Any month not fully cost-verified (coverage < 100%) gets a caption, per spec.
  const hasUnverifiedCoverage = useMemo(
    () => profitEfficiency.rows.some((r) => (r.cost_coverage_pct ?? 0) < 100),
    [profitEfficiency.rows]
  );

  // --- Revenue mix + run-rate ---
  const revenueMixData = useMemo(
    () =>
      revenueMix.byMonth.map((r) => ({
        month: r.month,
        recurring: centsToNum(r.recurring_cents),
        project: centsToNum(r.project_cents),
        one_time: centsToNum(r.one_time_cents),
        reimbursement: centsToNum(r.reimbursement_cents),
      })),
    [revenueMix.byMonth]
  );
  const latestMix = revenueMix.byMonth.at(-1) ?? null;
  const latestRecurringPct = useMemo(() => {
    if (!latestMix || !latestMix.combined_cents) return null;
    return (latestMix.recurring_cents / latestMix.combined_cents) * 100;
  }, [latestMix]);

  // --- Client concentration ---
  const concentrationRankData = useMemo(
    () =>
      concentration.latest.map((c) => ({
        // BarChartAtom horizontal mode uses categoryKey for the label + value for length
        month: c.company_name,
        company_name: c.company_name,
        value: centsToNum(c.revenue_cents),
        pct: c.pct,
      })),
    [concentration.latest]
  );
  const concentrationTrendData = useMemo(
    () =>
      concentration.byMonth.map((r) => ({
        month: r.month,
        top1_pct: r.top1_pct,
        top5_pct: r.top5_pct,
      })),
    [concentration.byMonth]
  );
  const latestConcentration = concentration.byMonth.at(-1) ?? null;

  // --- Utilization ---
  const utilizationTrendData = useMemo(
    () =>
      utilization.rows.map((r) => ({
        month: r.month,
        utilization_pct: r.utilization_pct,
      })),
    [utilization.rows]
  );

  // --- Realization & effective rate ---
  const realizationTrendData = useMemo(
    () =>
      realization.rows.map((r) => ({
        month: r.month,
        realization_pct: r.realization_pct,
        effective_rate: centsToNum(r.effective_rate_cents),
      })),
    [realization.rows]
  );
  const latestRealization = realization.rows.at(-1) ?? null;

  // Shared display formatters (presentation only)
  const formatPct = (value: number) => `${value.toFixed(1)}%`;
  const formatPerHead = (cents: number) => formatCurrency(centsToNum(cents));

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
      </div>

      {/* Range Selector */}
      <RangeSelector
        variant="dateRange"
        dateRange={dateRange}
        onChange={setDateRange}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
      />

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
              title={isViewingPastMonth ? 'Avg Daily Revenue' : 'Avg Daily Revenue (thru yesterday)'}
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
              secondaryValue={projectedAnnualRevenue != null ? formatCurrency(projectedAnnualRevenue) : '—'}
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-vercel-gray-600">
                Daily Revenue
              </h3>
              <div className="flex items-center gap-4 text-xs text-vercel-gray-400 font-mono">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: chartColors.bteamBrand }}
                  />
                  Billed
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: chartColors.bteamBrand, opacity: 0.3 }}
                  />
                  Earned
                </span>
              </div>
            </div>
            {dailyRevenueData.some(d => d.earned > 0 || d.billed > 0) ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart
                  data={dailyRevenueData}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  barGap={-20}
                  barSize={20}
                  barCategoryGap="10%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartColors.gridLine}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tick={axisTickStyle}
                    axisLine={axisLineStyle}
                    tickLine={axisLineStyle}
                  />
                  <YAxis
                    tick={axisTickStyle}
                    axisLine={axisLineStyle}
                    tickLine={axisLineStyle}
                    tickFormatter={formatChartCurrency}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ fontFamily: chartFontFamily }}
                    formatter={(value?: number, name?: string) => [
                      formatCurrency(value ?? 0),
                      name === 'earned' ? 'Earned' : 'Billed',
                    ]}
                    labelFormatter={(label: string) => `Day ${label}`}
                  />
                  <Bar
                    dataKey="earned"
                    fill={chartColors.bteamBrand}
                    opacity={0.3}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="billed"
                    fill={chartColors.bteamBrand}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
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

          {/* ================================================================ */}
          {/* INVESTOR ANALYTICS — DB-COMPUTED CHARTS                          */}
          {/* ================================================================ */}

          {/* --- Profitability & Efficiency --- */}
          <Card variant="default" padding="lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-vercel-gray-600">
                  Profitability &amp; Efficiency
                </h3>
                {hasUnverifiedCoverage && (
                  <p className="text-xs text-warning font-mono mt-0.5">
                    Months with labor-cost coverage &lt; 100% are not fully cost-verified.
                  </p>
                )}
              </div>
            </div>

            {profitEfficiency.error ? (
              <Alert message={profitEfficiency.error} icon="error" variant="error" />
            ) : profitEfficiency.loading ? (
              <div className="flex items-center justify-center h-[250px]">
                <Spinner size="md" />
              </div>
            ) : profitTrendData.length > 0 ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <MetricCard
                    title="All-In Margin"
                    value={latestProfit ? formatPct(latestProfit.all_in_margin_pct) : '—'}
                  />
                  <MetricCard
                    title="Timesheet Margin"
                    value={latestProfit ? formatPct(latestProfit.ts_margin_pct) : '—'}
                  />
                  <MetricCard
                    title="Revenue / Resource"
                    value={latestProfit ? formatPerHead(latestProfit.revenue_per_resource_cents) : '—'}
                  />
                  <MetricCard
                    title="Profit / Resource"
                    value={latestProfit ? formatPerHead(latestProfit.profit_per_resource_cents) : '—'}
                  />
                </div>
                <TrendLineAtom
                  data={profitTrendData}
                  series={[
                    { dataKey: 'all_in_profit', name: 'All-In Profit', color: chartColors.bteamBrand, yAxisId: 'right' },
                    { dataKey: 'all_in_margin_pct', name: 'All-In Margin', color: chartColors.brandIndigo, yAxisId: 'left' },
                    { dataKey: 'ts_margin_pct', name: 'Timesheet Margin', color: chartColors.brandPurple, strokeDasharray: '5 5', yAxisId: 'left' },
                  ]}
                  leftFormatter={(v) => `${v}%`}
                  rightFormatter={formatChartCurrency}
                />
              </>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                No profitability data available
              </div>
            )}
          </Card>

          {/* --- Revenue Mix + Run-Rate --- */}
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
            <Card variant="default" padding="lg">
              <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
                Revenue Mix
              </h3>
              {revenueMix.error ? (
                <Alert message={revenueMix.error} icon="error" variant="error" />
              ) : revenueMix.loading ? (
                <div className="flex items-center justify-center h-[250px]">
                  <Spinner size="md" />
                </div>
              ) : revenueMixData.length > 0 ? (
                <CompositionBarAtom
                  data={revenueMixData}
                  series={[
                    { dataKey: 'recurring', name: 'Recurring', color: pieChartColorSequence[0] },
                    { dataKey: 'project', name: 'Project', color: pieChartColorSequence[1] },
                    { dataKey: 'one_time', name: 'One-Time', color: pieChartColorSequence[2] },
                    { dataKey: 'reimbursement', name: 'Reimbursement', color: pieChartColorSequence[3] },
                  ]}
                  yAxisFormatter={formatChartCurrency}
                />
              ) : (
                <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                  No revenue mix data available
                </div>
              )}
            </Card>

            <Card variant="default" padding="lg">
              <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
                Committed Run-Rate
              </h3>
              {revenueMix.error ? (
                <Alert message={revenueMix.error} icon="error" variant="error" />
              ) : revenueMix.loading ? (
                <div className="flex items-center justify-center h-[120px]">
                  <Spinner size="md" />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  <MetricCard
                    title="Committed Monthly Run-Rate"
                    value={formatCurrency(centsToNum(revenueMix.committed_monthly_run_rate_cents))}
                  />
                  <MetricCard
                    title="Recurring % (latest month)"
                    value={latestRecurringPct != null ? formatPct(latestRecurringPct) : '—'}
                  />
                </div>
              )}
            </Card>
          </div>

          {/* --- Client Concentration --- */}
          <Card variant="default" padding="lg">
            <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
              Client Concentration
            </h3>
            {concentration.error ? (
              <Alert message={concentration.error} icon="error" variant="error" />
            ) : concentration.loading ? (
              <div className="flex items-center justify-center h-[250px]">
                <Spinner size="md" />
              </div>
            ) : concentrationRankData.length > 0 || concentrationTrendData.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <MetricCard
                    title="Top Client %"
                    value={latestConcentration ? formatPct(latestConcentration.top1_pct) : '—'}
                  />
                  <MetricCard
                    title="Top 5 Clients %"
                    value={latestConcentration ? formatPct(latestConcentration.top5_pct) : '—'}
                  />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs text-vercel-gray-400 font-mono mb-2">
                      Latest month revenue by client
                    </p>
                    {concentrationRankData.length > 0 ? (
                      <BarChartAtom
                        data={concentrationRankData}
                        layout="horizontal"
                        categoryKey="company_name"
                        fillColor={chartColors.brandIndigo}
                        valueFormatter={formatChartCurrency}
                        yAxisFormatter={formatChartCurrency}
                        valueLabel="Revenue"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                        No client revenue for latest month
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-vercel-gray-400 font-mono mb-2">
                      Concentration over time
                    </p>
                    {concentrationTrendData.length > 0 ? (
                      <TrendLineAtom
                        data={concentrationTrendData}
                        series={[
                          { dataKey: 'top1_pct', name: 'Top Client', color: chartColors.bteamBrand },
                          { dataKey: 'top5_pct', name: 'Top 5 Clients', color: chartColors.brandIndigo },
                        ]}
                        leftFormatter={(v) => `${v}%`}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                        No concentration trend available
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                No client concentration data available
              </div>
            )}
          </Card>

          {/* --- Efficiency / Utilization --- */}
          <Card variant="default" padding="lg">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-vercel-gray-600">
                Utilization Trend
              </h3>
              <p className="text-xs text-vercel-gray-400 font-mono mt-0.5">
                Include-contractors basis.
              </p>
            </div>
            {utilization.error ? (
              <Alert message={utilization.error} icon="error" variant="error" />
            ) : utilization.loading ? (
              <div className="flex items-center justify-center h-[250px]">
                <Spinner size="md" />
              </div>
            ) : utilizationTrendData.length > 0 ? (
              <TrendLineAtom
                data={utilizationTrendData}
                series={[
                  { dataKey: 'utilization_pct', name: 'Utilization', color: chartColors.success },
                ]}
                leftFormatter={(v) => `${v}%`}
                showLegend={false}
              />
            ) : (
              <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                No utilization data available
              </div>
            )}
          </Card>

          {/* --- Realization & Effective Rate --- */}
          <Card variant="default" padding="lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-vercel-gray-600">
                  Realization &amp; Effective Rate
                </h3>
                <p className="text-xs text-vercel-gray-400 font-mono mt-0.5">
                  &gt;100% = minimum-floor padding; &lt;100% = carryover / unbillable hours.
                </p>
              </div>
            </div>
            {realization.error ? (
              <Alert message={realization.error} icon="error" variant="error" />
            ) : realization.loading ? (
              <div className="flex items-center justify-center h-[250px]">
                <Spinner size="md" />
              </div>
            ) : realizationTrendData.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <MetricCard
                    title="Realization (latest)"
                    value={latestRealization ? formatPct(latestRealization.realization_pct) : '—'}
                  />
                  <MetricCard
                    title="Effective Rate (latest)"
                    value={latestRealization ? `$${centsToNum(latestRealization.effective_rate_cents).toFixed(2)}` : '—'}
                  />
                </div>
                <TrendLineAtom
                  data={realizationTrendData}
                  series={[
                    { dataKey: 'realization_pct', name: 'Realization', color: chartColors.brandPurple, yAxisId: 'left' },
                    { dataKey: 'effective_rate', name: 'Effective Rate', color: chartColors.bteamBrand, yAxisId: 'right' },
                  ]}
                  leftFormatter={(v) => `${v}%`}
                  rightFormatter={formatChartCurrency}
                />
              </>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-vercel-gray-400 font-mono text-sm">
                No realization data available
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
