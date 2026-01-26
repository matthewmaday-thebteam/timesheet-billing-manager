import { useState, useMemo, useCallback } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useUnifiedBilling } from '../../hooks/useUnifiedBilling';
import { useCanonicalCompanyMapping } from '../../hooks/useCanonicalCompanyMapping';
import { useTimeOff } from '../../hooks/useTimeOff';
import { DateRangeFilter } from '../DateRangeFilter';
import { EmployeePerformance } from '../EmployeePerformance';
import { Spinner } from '../Spinner';
import type { DateRange, MonthSelection } from '../../types';

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

      {/* Date Range Filter */}
      <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />

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
