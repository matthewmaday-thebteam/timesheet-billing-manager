import { useState, useMemo, useCallback, useEffect } from 'react';
import { format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useUnifiedBilling } from '../../hooks/useUnifiedBilling';
import { useCanonicalCompanyMapping } from '../../hooks/useCanonicalCompanyMapping';
import { useTimeOff } from '../../hooks/useTimeOff';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { supabase } from '../../lib/supabase';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { RangeSelector } from '../molecules/RangeSelector';
import { EmployeePerformance } from '../EmployeePerformance';
import { MetricCard } from '../MetricCard';
import { Spinner } from '../Spinner';
import { DEFAULT_ROUNDING_INCREMENT, formatCurrency } from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import { useUtilizationMetrics } from '../../hooks/useUtilizationMetrics';
import type { MonthSelection, RoundingIncrement, BulgarianHoliday } from '../../types';

/**
 * Round minutes up to the nearest increment (matching billingCalculations.ts)
 */
function roundMinutes(minutes: number, increment: RoundingIncrement): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

export function EmployeesPage() {
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  const { entries, userIdToDisplayNameLookup, projectCanonicalIdLookup, loading, error } = useTimesheetData(dateRange);

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

  // Helper to get canonical company name (ID-only lookup, no name fallbacks)
  const getCanonicalCompanyName = useCallback((clientId: string): string => {
    const canonicalInfo = clientId ? getCanonicalCompany(clientId) : null;
    return canonicalInfo?.canonicalDisplayName || 'Unknown';
  }, [getCanonicalCompany]);

  // Use unified billing calculation
  // Company grouping now uses project's canonical company info (from projectsWithRates)
  const { billingResult } = useUnifiedBilling({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
  });

  // Build project config map for rounding lookup (keyed by external project ID)
  const projectConfigMap = useMemo(() => {
    const map = new Map<string, { rounding: RoundingIncrement }>();
    for (const project of projectsWithRates) {
      if (project.externalProjectId) {
        map.set(project.externalProjectId, {
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

  // Build total project minutes lookup using canonical project IDs
  const projectTotalMinutesLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    for (const entry of entries) {
      const rawProjectId = entry.project_id || '';
      // Map to canonical project ID (member -> primary)
      const projectId = projectCanonicalIdLookup?.get(rawProjectId) || rawProjectId;
      const current = lookup.get(projectId) || 0;
      lookup.set(projectId, current + entry.total_minutes);
    }
    return lookup;
  }, [entries, projectCanonicalIdLookup]);

  // Calculate utilization metrics (shared hook)
  const utilizationMetrics = useUtilizationMetrics({
    dateRange,
    holidays,
    employees,
    timeOff,
    roundedHours: billingResult.roundedHours,
    projectsWithRates,
  });

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
      const companyId = entry.client_id || '';
      const companyName = getCanonicalCompanyName(companyId);

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
          // Map to canonical project ID for all lookups
          const canonicalProjectId = projectCanonicalIdLookup?.get(projectId) || projectId;
          const config = projectConfigMap.get(canonicalProjectId);
          const rounding = config?.rounding ?? DEFAULT_ROUNDING_INCREMENT;

          // Calculate project totals for this employee
          let employeeProjectMinutes = 0;
          for (const taskMinutes of taskMap.values()) {
            employeeProjectMinutes += taskMinutes;
          }

          // Calculate proportional revenue using canonical project ID
          const totalProjectMinutes = projectTotalMinutesLookup.get(canonicalProjectId) || employeeProjectMinutes;
          const projectBilledRevenue = projectBilledRevenueLookup.get(canonicalProjectId) || 0;
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
  }, [entries, dateRange, userIdToDisplayNameLookup, getCanonicalCompanyName, projectConfigMap, projectBilledRevenueLookup, projectTotalMinutesLookup, projectCanonicalIdLookup]);

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
        exportOptions={[
          { label: 'Employee Performance Report', onClick: handleExportCSV },
        ]}
        exportDisabled={loading || entries.length === 0}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
      />

      {/* Utilization Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Underutilization"
          value={`${utilizationMetrics.underutilizationHours.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hrs`}
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
          projectCanonicalIdLookup={projectCanonicalIdLookup}
        />
      )}
    </div>
  );
}
