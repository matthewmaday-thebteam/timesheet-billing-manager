import { useState, useMemo, useCallback, useEffect } from 'react';
import { startOfMonth, endOfMonth, format, eachDayOfInterval, isWeekend, isSameDay, min } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useUnifiedBilling } from '../../hooks/useUnifiedBilling';
import { useCanonicalCompanyMapping } from '../../hooks/useCanonicalCompanyMapping';
import { useTimeOff } from '../../hooks/useTimeOff';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { supabase } from '../../lib/supabase';
import { RangeSelector } from '../atoms/RangeSelector';
import { EmployeePerformance } from '../EmployeePerformance';
import { MetricCard } from '../MetricCard';
import { Spinner } from '../Spinner';
import { DEFAULT_ROUNDING_INCREMENT, formatCurrency } from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import type { DateRange, MonthSelection, RoundingIncrement, BulgarianHoliday } from '../../types';

/**
 * Round minutes up to the nearest increment (matching billingCalculations.ts)
 */
function roundMinutes(minutes: number, increment: RoundingIncrement): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

export function EmployeesPage() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  const { entries, userIdToDisplayNameLookup, loading, error } = useTimesheetData(dateRange);

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Get canonical company mapping
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // Fetch time-off data for the selected period
  const { timeOff } = useTimeOff({
    startDate: dateRange.start,
    endDate: dateRange.end,
    approvedOnly: true,
  });

  // Fetch employee entities (excludes grouped members to avoid double-counting)
  const { entities: employees } = useEmployeeTableEntities();

  // Fetch holidays for the selected month
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

  // Helper to get canonical company name
  const getCanonicalCompanyName = useCallback((clientId: string, clientName: string): string => {
    const canonicalInfo = clientId ? getCanonicalCompany(clientId) : null;
    return canonicalInfo?.canonicalDisplayName || clientName || 'Unassigned';
  }, [getCanonicalCompany]);

  // Use unified billing calculation
  const { billingResult } = useUnifiedBilling({
    entries,
    projectsWithRates,
    getCanonicalCompanyName,
  });

  // Build project config map for rounding lookup
  const projectConfigMap = useMemo(() => {
    const map = new Map<string, { rounding: RoundingIncrement }>();
    for (const project of projectsWithRates) {
      if (project.projectId) {
        map.set(project.projectId, {
          rounding: project.effectiveRounding ?? DEFAULT_ROUNDING_INCREMENT,
        });
      }
    }
    return map;
  }, [projectsWithRates]);

  // Build project billedRevenue lookup from billingResult
  const projectBilledRevenueLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          lookup.set(project.projectId, project.billedRevenue);
        }
      }
    }
    return lookup;
  }, [billingResult]);

  // Build total project minutes lookup
  const projectTotalMinutesLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    for (const entry of entries) {
      const projectId = entry.project_id || '';
      const current = lookup.get(projectId) || 0;
      lookup.set(projectId, current + entry.total_minutes);
    }
    return lookup;
  }, [entries]);

  // Calculate utilization metrics
  const utilizationMetrics = useMemo(() => {
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
    let totalLostRevenue = 0;
    const employeeAvailableHours = new Map<string, { hours: number; rate: number }>();

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
      const availableHours = (workingDays - ptoDays) * hoursPerDay;
      totalAvailableHours += availableHours;

      const rate = employee.hourly_rate || 0;
      employeeAvailableHours.set(displayName, { hours: availableHours, rate });
    }

    // Use rounded hours from billing result (matches Revenue page)
    const totalWorkedHours = billingResult.roundedHours;

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
    totalLostRevenue = totalUnderutilizationHours * avgRate;

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
  }, [dateRange, holidays, employees, timeOff, billingResult, projectsWithRates]);

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    const csvRows: string[][] = [];

    // Title row
    csvRows.push([`Employee Performance - ${format(dateRange.start, 'MMMM yyyy')}`]);

    // Header row
    csvRows.push(['Employee', 'Company', 'Project', 'Task', 'Hours', 'Revenue']);

    // Build employee data (similar to EmployeePerformance logic)
    const userMap = new Map<string, Map<string, Map<string, Map<string, number>>>>();
    const userCompanyNames = new Map<string, Map<string, string>>();

    for (const entry of entries) {
      const userName = (entry.user_id && userIdToDisplayNameLookup.get(entry.user_id)) || entry.user_name;
      const projectId = entry.project_id || '';
      const projectName = entry.project_name || 'Unknown Project';
      const taskName = entry.task_name || entry.task_key || 'No Task';
      const companyName = getCanonicalCompanyName(entry.client_id || '', entry.client_name || 'Unassigned');
      const companyId = entry.client_id || companyName;

      if (!userMap.has(userName)) {
        userMap.set(userName, new Map());
        userCompanyNames.set(userName, new Map());
      }
      const companyMap = userMap.get(userName)!;
      const companyNameMap = userCompanyNames.get(userName)!;
      companyNameMap.set(companyId, companyName);

      if (!companyMap.has(companyId)) {
        companyMap.set(companyId, new Map());
      }
      const projectMap = companyMap.get(companyId)!;

      const projectKey = `${projectId}::${projectName}`;
      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, new Map());
      }
      const taskMap = projectMap.get(projectKey)!;

      const currentMinutes = taskMap.get(taskName) || 0;
      taskMap.set(taskName, currentMinutes + entry.total_minutes);
    }

    // Convert to CSV rows with revenue calculation
    const sortedUsers = Array.from(userMap.keys()).sort((a, b) => a.localeCompare(b));

    for (const userName of sortedUsers) {
      const companyMap = userMap.get(userName)!;
      const companyNameMap = userCompanyNames.get(userName)!;

      for (const [companyId, projectMap] of companyMap) {
        const companyName = companyNameMap.get(companyId) || companyId;

        for (const [projectKey, taskMap] of projectMap) {
          const [projectId, projectName] = projectKey.split('::');
          const config = projectConfigMap.get(projectId);
          const rounding = config?.rounding ?? DEFAULT_ROUNDING_INCREMENT;

          // Calculate project totals for this employee
          let employeeProjectMinutes = 0;
          for (const taskMinutes of taskMap.values()) {
            employeeProjectMinutes += taskMinutes;
          }

          // Calculate proportional revenue
          const totalProjectMinutes = projectTotalMinutesLookup.get(projectId) || employeeProjectMinutes;
          const projectBilledRevenue = projectBilledRevenueLookup.get(projectId) || 0;
          const employeeShare = totalProjectMinutes > 0 ? employeeProjectMinutes / totalProjectMinutes : 0;
          const employeeProjectRevenue = projectBilledRevenue * employeeShare;

          // Calculate project rounded minutes for proportional task distribution
          let projectRoundedMinutes = 0;
          for (const taskMinutes of taskMap.values()) {
            projectRoundedMinutes += roundMinutes(taskMinutes, rounding);
          }

          for (const [taskName, taskMinutes] of taskMap) {
            const roundedTaskMinutes = roundMinutes(taskMinutes, rounding);
            const taskRevenue = projectRoundedMinutes > 0
              ? employeeProjectRevenue * (roundedTaskMinutes / projectRoundedMinutes)
              : 0;

            csvRows.push([
              userName,
              companyName,
              projectName,
              taskName,
              minutesToHours(roundedTaskMinutes),
              taskRevenue.toFixed(2),
            ]);
          }
        }
      }
    }

    // Convert to CSV string
    const csvContent = csvRows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `employee-performance-${format(dateRange.start, 'yyyy-MM')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [entries, dateRange, userIdToDisplayNameLookup, getCanonicalCompanyName, projectConfigMap, projectBilledRevenueLookup, projectTotalMinutesLookup]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Employees</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Employee hours and revenue performance
          </p>
        </div>
      </div>

      {/* Range Selector with Export */}
      <RangeSelector
        variant="export"
        dateRange={dateRange}
        onChange={setDateRange}
        onExport={handleExportCSV}
        exportDisabled={loading || entries.length === 0}
      />

      {/* Utilization Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Underutilization"
          value={`${utilizationMetrics.underutilizationHours.toFixed(1)} hrs`}
        />
        <MetricCard
          title="Lost Revenue (approx.)"
          value={formatCurrency(utilizationMetrics.lostRevenue)}
        />
        <MetricCard
          title="Utilization"
          value={`${utilizationMetrics.utilizationPercent.toFixed(1)}%`}
        />
        <MetricCard
          title="Time Off"
          value={`${utilizationMetrics.timeOffDays} days`}
        />
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading employee data...</span>
        </div>
      ) : error ? (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-error">{error}</span>
          </div>
        </div>
      ) : (
        <EmployeePerformance
          entries={entries}
          projectsWithRates={projectsWithRates}
          timeOff={timeOff}
          billingResult={billingResult}
          getCanonicalCompanyName={getCanonicalCompanyName}
          userIdToDisplayNameLookup={userIdToDisplayNameLookup}
        />
      )}
    </div>
  );
}
