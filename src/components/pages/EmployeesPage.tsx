import { useState, useMemo, useCallback, useEffect } from 'react';
import { format } from 'date-fns';
import { useEmployeeTotals } from '../../hooks/useEmployeeTotals';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useCanonicalCompanyMapping } from '../../hooks/useCanonicalCompanyMapping';
import { useTimeOff } from '../../hooks/useTimeOff';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { supabase } from '../../lib/supabase';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { RangeSelector } from '../RangeSelector';
import { EmployeePerformance } from '../EmployeePerformance';
import { MetricCard } from '../MetricCard';
import { Spinner } from '../Spinner';
import { formatCurrency } from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import { useUtilizationMetrics } from '../../hooks/useUtilizationMetrics';
import type { MonthSelection, BulgarianHoliday } from '../../types';

export function EmployeesPage() {
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  // Fetch Layer 2 data (employee_totals) with canonical lookups
  const { rows, userIdToDisplayNameLookup, projectCanonicalIdLookup, loading, error } = useEmployeeTotals(dateRange);

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates
  const { projectsWithRates, isLoading: ratesLoading } = useMonthlyRates({ selectedMonth });

  // Get canonical company mapping
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // Fetch time-off data for the selected period
  const { timeOff, loading: timeOffLoading } = useTimeOff({
    startDate: dateRange.start,
    endDate: dateRange.end,
    approvedOnly: true,
  });

  // Fetch employee entities (excludes grouped members to avoid double-counting)
  const { entities: employees, loading: employeesLoading } = useEmployeeTableEntities();

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

  // Build project rate lookup for revenue calculation (keyed by external project ID)
  const projectRateLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of projectsWithRates) {
      if (project.externalProjectId) {
        map.set(project.externalProjectId, project.effectiveRate);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Build employee hourly rate lookup: canonical display name -> hourly_rate
  const employeeHourlyRateLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const emp of employees) {
      const displayName = emp.first_name || emp.last_name
        ? [emp.first_name, emp.last_name].filter(Boolean).join(' ')
        : emp.external_label;
      if (emp.hourly_rate != null) {
        map.set(displayName, emp.hourly_rate);
      }
    }
    return map;
  }, [employees]);

  // Combined loading state for utilization metrics
  const metricsLoading = loading || ratesLoading || timeOffLoading || employeesLoading;

  // Build synthetic entries for utilization metrics from Layer 2 rows
  // useUtilizationMetrics needs entries with user_id, total_minutes, work_date
  const syntheticEntries = useMemo(() => {
    return rows.map(row => ({
      ...row,
      // useUtilizationMetrics uses total_minutes and work_date
      total_minutes: row.rounded_minutes,
      project_id: row.project_id,
      project_name: row.project_name,
      task_id: null,
      task_key: '',
      synced_at: '',
      project_key: '',
      user_key: '',
    }));
  }, [rows]);

  // Calculate utilization metrics (shared hook)
  const utilizationMetrics = useUtilizationMetrics({
    dateRange,
    holidays,
    employees,
    timeOff,
    entries: syntheticEntries as any,
    projectsWithRates,
  });

  // Export to CSV using Layer 2 data
  const handleExportCSV = useCallback(() => {
    const csvRows: string[][] = [];

    // Title row
    csvRows.push([`Employee Performance - ${format(dateRange.start, 'MMMM yyyy')}`]);

    // Header row
    csvRows.push(['Employee', 'Company', 'Project', 'Task', 'Hours', 'Profit', 'Revenue']);

    // Build employee data from Layer 2 rows
    const userMap = new Map<string, Map<string, Map<string, Map<string, number>>>>();
    const userCompanyNames = new Map<string, Map<string, string>>();

    for (const row of rows) {
      const userName = (row.user_id && userIdToDisplayNameLookup.get(row.user_id)) || row.user_name;
      const projectId = row.project_id || '';
      const projectName = row.project_name || 'Unknown Project';
      const taskName = row.task_name || 'No Task';
      const companyId = row.client_id || '';
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

      // Sum rounded_minutes
      const currentMinutes = taskMap.get(taskName) || 0;
      taskMap.set(taskName, currentMinutes + row.rounded_minutes);
    }

    // Convert to CSV rows with revenue/profit calculations
    const sortedUsers = Array.from(userMap.keys()).sort((a, b) => a.localeCompare(b));

    for (const userName of sortedUsers) {
      const companyMap = userMap.get(userName)!;
      const companyNameMap = userCompanyNames.get(userName)!;
      const employeeHourlyRate = employeeHourlyRateLookup.get(userName) ?? null;

      for (const [companyId, projectMap] of companyMap) {
        const companyName = companyNameMap.get(companyId) || companyId;

        for (const [projectKey, taskMap] of projectMap) {
          const [projectId, projectName] = projectKey.split('::');
          // Map to canonical project ID for rate lookup
          const canonicalProjectId = projectCanonicalIdLookup?.get(projectId) || projectId;
          const projectRate = projectRateLookup.get(canonicalProjectId) ?? 0;

          for (const [taskName, roundedMinutes] of taskMap) {
            const roundedHours = roundedMinutes / 60;

            // Revenue = rounded_hours x project_rate
            const taskRevenue = roundedHours * projectRate;

            // Profit = revenue - (rounded_hours x employee_hourly_rate)
            let taskProfit: number | null = null;
            if (employeeHourlyRate !== null) {
              taskProfit = taskRevenue - (roundedHours * employeeHourlyRate);
            }

            csvRows.push([
              userName,
              companyName,
              projectName,
              taskName,
              minutesToHours(roundedMinutes),
              taskProfit !== null ? taskProfit.toFixed(2) : '',
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
  }, [rows, dateRange, userIdToDisplayNameLookup, getCanonicalCompanyName, projectCanonicalIdLookup, projectRateLookup, employeeHourlyRateLookup]);

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
        exportDisabled={loading || rows.length === 0}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
      />

      {/* Utilization Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Underutilization"
          value={`${utilizationMetrics.underutilizationHours.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hrs`}
          loading={metricsLoading}
        />
        <MetricCard
          title="Lost Revenue (approx.)"
          value={formatCurrency(utilizationMetrics.lostRevenue)}
          loading={metricsLoading}
        />
        <MetricCard
          title="Utilization"
          value={`${utilizationMetrics.utilizationPercent.toFixed(1)}%`}
          loading={metricsLoading}
        />
        <MetricCard
          title="Time Off"
          value={`${utilizationMetrics.timeOffDays} days`}
          loading={metricsLoading}
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
          rows={rows}
          projectsWithRates={projectsWithRates}
          employees={employees}
          timeOff={timeOff}
          getCanonicalCompanyName={getCanonicalCompanyName}
          userIdToDisplayNameLookup={userIdToDisplayNameLookup}
          projectCanonicalIdLookup={projectCanonicalIdLookup}
        />
      )}
    </div>
  );
}
