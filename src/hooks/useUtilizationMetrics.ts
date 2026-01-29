import { useMemo } from 'react';
import { eachDayOfInterval, isWeekend, isSameDay, min } from 'date-fns';
import type { DateRange, BulgarianHoliday, Resource, EmployeeTimeOff, ProjectRateDisplay } from '../types';

interface UseUtilizationMetricsParams {
  dateRange: DateRange;
  holidays: BulgarianHoliday[];
  employees: Resource[];
  timeOff: EmployeeTimeOff[];
  roundedHours: number;
  projectsWithRates: ProjectRateDisplay[];
}

export interface UtilizationMetrics {
  underutilizationHours: number;
  lostRevenue: number;
  utilizationPercent: number;
  timeOffDays: number;
}

export function useUtilizationMetrics({
  dateRange,
  holidays,
  employees,
  timeOff,
  roundedHours,
  projectsWithRates,
}: UseUtilizationMetricsParams): UtilizationMetrics {
  return useMemo(() => {
    // Use current date or end of month, whichever is earlier (MTD calculation)
    const today = new Date();
    const effectiveEndDate = min([dateRange.end, today]);

    // Get all days from start of month to effective end date
    const daysInPeriod = eachDayOfInterval({
      start: dateRange.start,
      end: effectiveEndDate,
    });

    // Get holiday dates for quick lookup
    const holidayDates = holidays.map(h => new Date(h.holiday_date));

    // Count holidays that fall on weekdays MTD
    const holidaysMTD = holidayDates.filter(hDate => {
      const isInRange = hDate >= dateRange.start && hDate <= effectiveEndDate;
      return isInRange && !isWeekend(hDate);
    }).length;

    // Count working days (excludes weekends and holidays)
    const workingDays = daysInPeriod.filter(day => {
      if (isWeekend(day)) return false;
      if (holidayDates.some(h => isSameDay(h, day))) return false;
      return true;
    }).length;

    // Filter to billable employees (Full-time and Part-time only)
    const billableEmployees = employees.filter(e => {
      const empType = e.employment_type?.name;
      return empType === 'Full-time' || empType === 'Part-time';
    });

    // Calculate available hours per employee
    let totalAvailableHours = 0;

    for (const employee of billableEmployees) {
      const hoursPerDay = employee.employment_type?.name === 'Full-time' ? 8 : 4;
      const displayName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.external_label;

      // Calculate PTO days for this employee (only weekdays within the period)
      let ptoDays = 0;
      for (const to of timeOff) {
        if (to.employee_name === displayName || to.resource_id === employee.id) {
          // Count only weekday PTO days within our period
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

      // Available hours = (working days * hours/day) - (PTO days * hours/day)
      totalAvailableHours += (workingDays - ptoDays) * hoursPerDay;
    }

    // Use rounded hours from billing result (matches Revenue page)
    const totalWorkedHours = roundedHours;

    // Calculate underutilization (available - worked)
    const totalUnderutilizationHours = Math.max(0, totalAvailableHours - totalWorkedHours);

    // Calculate average rate from projectsWithRates (same as Rates page)
    let totalRate = 0;
    let ratedCount = 0;
    for (const project of projectsWithRates) {
      if (project.effectiveRate > 0) {
        totalRate += project.effectiveRate;
        ratedCount++;
      }
    }
    const avgRate = ratedCount > 0 ? totalRate / ratedCount : 0;
    const totalLostRevenue = totalUnderutilizationHours * avgRate;

    // Calculate total PTO days (excluding weekends)
    let totalPtoDays = 0;
    for (const to of timeOff) {
      const ptoStart = new Date(to.start_date);
      const ptoEnd = new Date(to.end_date);
      const overlapStart = ptoStart < dateRange.start ? dateRange.start : ptoStart;
      const overlapEnd = ptoEnd > effectiveEndDate ? effectiveEndDate : ptoEnd;

      if (overlapStart <= overlapEnd) {
        const ptoDaysInRange = eachDayOfInterval({ start: overlapStart, end: overlapEnd });
        for (const day of ptoDaysInRange) {
          if (!isWeekend(day)) {
            totalPtoDays++;
          }
        }
      }
    }

    // Calculate utilization percentage
    const utilizationPercent = totalAvailableHours > 0
      ? (totalWorkedHours / totalAvailableHours) * 100
      : 0;

    // Time off = holidays + PTO days (excluding weekends)
    const totalTimeOffDays = holidaysMTD + totalPtoDays;

    return {
      underutilizationHours: totalUnderutilizationHours,
      lostRevenue: totalLostRevenue,
      utilizationPercent,
      timeOffDays: totalTimeOffDays,
    };
  }, [dateRange, holidays, employees, timeOff, roundedHours, projectsWithRates]);
}
