/**
 * useProjectedAnnualRevenue - Client-side projected annual revenue hook.
 *
 * Computes projected annual revenue using the IDENTICAL formula from
 * InvestorDashboardPage.tsx. No DB RPC. No CAGR. Both Dashboard and
 * Investor page get the same value.
 *
 * Formula:
 *   projectedAnnualRevenue = ytdRevenue
 *     + (avgDailyRevenue * remainingYearWorkdays)
 *     - (ftVacationDays * 8 * avgRate)
 *     - (ptVacationDays * 5 * avgRate)
 *
 * @official 2026-04-04
 */

import { useState, useEffect, useMemo } from 'react';
import { eachDayOfInterval, isWeekend, isSameDay } from 'date-fns';
import { useCombinedRevenue } from './useCombinedRevenue';
import { useMonthlyRates } from './useMonthlyRates';
import { useEmployeeTableEntities } from './useEmployeeTableEntities';
import { useTimeOff } from './useTimeOff';
import { useTimesheetData } from './useTimesheetData';
import { useInvestorMetrics } from './useInvestorMetrics';
import { useBilling } from './useBilling';
import { useDateFilter } from '../contexts/DateFilterContext';
import { aggregateDailyRevenue } from '../utils/chartTransforms';
import { calculateProjectedAnnualRevenue } from '../utils/projectedRevenue';
import { supabase } from '../lib/supabase';
import type { MonthSelection, BulgarianHoliday } from '../types';
import { HISTORICAL_MONTHS } from '../config/chartConfig';

// ============================================================================
// TYPES
// ============================================================================

export interface UseProjectedAnnualRevenueReturn {
  /** Projected annual revenue in dollars (null while loading or insufficient data) */
  projectedAnnualRevenue: number | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
}

// ============================================================================
// HOOK
// ============================================================================

export function useProjectedAnnualRevenue(): UseProjectedAnnualRevenueReturn {
  const { dateRange } = useDateFilter();

  // ---- Current month selection (for hooks that need MonthSelection) ----
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // ---- Is the user viewing a completed month? ----
  const now = new Date();
  const isViewingPastMonth =
    selectedMonth.year < now.getFullYear() ||
    (selectedMonth.year === now.getFullYear() && selectedMonth.month < now.getMonth() + 1);

  // ---- Data sources (same hooks InvestorDashboardPage uses) ----

  // Combined revenue by month (for YTD)
  const { combinedRevenueByMonth, loading: combinedRevenueLoading } = useCombinedRevenue({
    dateRange,
    extendedMonths: HISTORICAL_MONTHS,
  });

  // Monthly rates (for avg rate and project rates map)
  const { projectsWithRates, isLoading: ratesLoading } = useMonthlyRates({ selectedMonth });

  // Employees (for vacation day categorisation by employment type)
  const { entities: employees, loading: employeesLoading } = useEmployeeTableEntities();

  // Timesheet entries (for daily revenue aggregation)
  const {
    entries,
    projectCanonicalIdLookup,
    loading: timesheetLoading,
  } = useTimesheetData(dateRange, { extendedMonths: HISTORICAL_MONTHS });

  // Billing result (for billing caps on capped projects)
  const { billingResult } = useBilling({ selectedMonth });

  // Investor metrics (for completedWorkdays from DB)
  const { data: investorMetrics, loading: investorMetricsLoading } = useInvestorMetrics(selectedMonth);
  const completedWorkdays = investorMetrics?.completed_workdays ?? 0;

  // ---- Rest-of-year time off ----
  const [yearStart] = useState(() => new Date());
  const [yearEnd] = useState(() => new Date(new Date().getFullYear(), 11, 31));

  const { timeOff: yearRemainingTimeOff, loading: timeOffLoading } = useTimeOff({
    startDate: yearStart,
    endDate: yearEnd,
    approvedOnly: true,
  });

  // ---- Bulgarian holidays ----
  const [holidays, setHolidays] = useState<BulgarianHoliday[]>([]);
  const [holidaysLoading, setHolidaysLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchHolidays() {
      setHolidaysLoading(true);
      const year = dateRange.start.getFullYear();
      const { data } = await supabase
        .from('bulgarian_holidays')
        .select('*')
        .eq('year', year);
      if (!cancelled) {
        setHolidays(data || []);
        setHolidaysLoading(false);
      }
    }
    fetchHolidays();
    return () => { cancelled = true; };
  }, [dateRange.start]);

  // ---- Derived: project rates map (for daily revenue chart) ----
  const projectRatesMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projectsWithRates) {
      if (p.externalProjectId && p.effectiveRate > 0) {
        map.set(p.externalProjectId, p.effectiveRate);
      }
    }
    return map;
  }, [projectsWithRates]);

  // ---- Derived: billing caps ----
  const billingCaps = useMemo(() => {
    const caps = new Map<string, number>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (!project.projectId || !project.maximumApplied) continue;
        const canonicalId = projectCanonicalIdLookup?.get(project.projectId) || project.projectId;
        caps.set(canonicalId, project.billedHours - project.carryoverIn);
      }
    }
    return caps;
  }, [billingResult.companies, projectCanonicalIdLookup]);

  // ---- Derived: avg rate ----
  const avgRate = useMemo(() => {
    let totalRate = 0;
    let ratedCount = 0;
    for (const project of projectsWithRates) {
      if (project.effectiveRate > 0) {
        totalRate += project.effectiveRate;
        ratedCount++;
      }
    }
    return ratedCount > 0 ? totalRate / ratedCount : 0;
  }, [projectsWithRates]);

  // ---- Derived: YTD revenue ----
  const currentYear = new Date().getFullYear();
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

  // ---- Derived: daily revenue data -> avg daily revenue ----
  const dailyRevenueData = useMemo(
    () => aggregateDailyRevenue(entries, projectRatesMap, dateRange.start, projectCanonicalIdLookup, billingCaps),
    [entries, projectRatesMap, dateRange.start, projectCanonicalIdLookup, billingCaps]
  );

  const avgDailyRevenue = useMemo(() => {
    const today = new Date();
    const lastDayToInclude = isViewingPastMonth
      ? dailyRevenueData.length
      : today.getDate() - 1;

    let earnedSum = 0;
    for (let i = 0; i < lastDayToInclude && i < dailyRevenueData.length; i++) {
      earnedSum += dailyRevenueData[i].earned;
    }

    return completedWorkdays > 0 ? earnedSum / completedWorkdays : 0;
  }, [dailyRevenueData, completedWorkdays, isViewingPastMonth]);

  // ---- Derived: remaining year workdays ----
  const remainingYearWorkdays = useMemo(() => {
    const holidayDates = holidays.map(h => new Date(h.holiday_date));
    const days = eachDayOfInterval({ start: yearStart, end: yearEnd });
    return days.filter(day => {
      if (isWeekend(day)) return false;
      if (holidayDates.some(h => isSameDay(h, day))) return false;
      return true;
    }).length;
  }, [holidays, yearStart, yearEnd]);

  // ---- Derived: remaining vacation days by employment type ----
  const { ftVacationDays, ptVacationDays } = useMemo(() => {
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
        const overlapEnd = ptoEnd > yearEnd ? yearEnd : ptoEnd;

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

    return { ftVacationDays: ftDays, ptVacationDays: ptDays };
  }, [employees, yearRemainingTimeOff, holidays, yearStart, yearEnd]);

  // ---- Aggregate loading state ----
  const loading =
    combinedRevenueLoading ||
    ratesLoading ||
    employeesLoading ||
    timesheetLoading ||
    investorMetricsLoading ||
    timeOffLoading ||
    holidaysLoading;

  // ---- Final calculation ----
  const projectedAnnualRevenue = useMemo(() => {
    if (loading) return null;
    if (completedWorkdays === 0) return null;

    return calculateProjectedAnnualRevenue({
      ytdRevenue,
      avgDailyRevenue,
      remainingYearWorkdays,
      ftVacationDays,
      ptVacationDays,
      avgRate,
    });
  }, [loading, completedWorkdays, ytdRevenue, avgDailyRevenue, remainingYearWorkdays, ftVacationDays, ptVacationDays, avgRate]);

  return {
    projectedAnnualRevenue,
    loading,
    error: null,
  };
}
