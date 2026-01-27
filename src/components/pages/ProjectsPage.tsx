import { useState, useMemo } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useProjectHierarchy } from '../../hooks/useProjectHierarchy';
import { formatCurrency } from '../../utils/billing';
import { RangeSelector } from '../atoms/RangeSelector';
import { ProjectHierarchyTable } from '../atoms/ProjectHierarchyTable';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import type { DateRange, MonthSelection } from '../../types';

export function ProjectsPage() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  const {
    entries,
    projectCanonicalIdLookup,
    userIdToDisplayNameLookup,
    loading,
    error,
  } = useTimesheetData(dateRange);

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates (which includes canonical company info)
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Build 5-tier hierarchy
  const hierarchyResult = useProjectHierarchy({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
    userIdToDisplayNameLookup,
  });

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Projects</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Work breakdown for <span className="text-bteam-brand font-medium">{format(dateRange.start, 'MMMM yyyy')}</span>
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-vercel-gray-400">Total Hours</div>
              <div className="text-lg font-semibold text-vercel-gray-600">{hierarchyResult.totalHours.toFixed(2)}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-vercel-gray-400">Total Revenue</div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success" />
                <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(hierarchyResult.totalRevenue)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Range Selector */}
      <RangeSelector
        variant="dateRange"
        dateRange={dateRange}
        onChange={setDateRange}
      />

      {/* Error State */}
      {error && <Alert message={error} icon="error" variant="error" />}

      {/* Hierarchy Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading project data...</span>
        </div>
      ) : hierarchyResult.companies.length === 0 ? (
        <div className="bg-white rounded-lg border border-vercel-gray-100 p-8 text-center">
          <p className="text-sm text-vercel-gray-400">No timesheet data for this month.</p>
        </div>
      ) : (
        <ProjectHierarchyTable hierarchyResult={hierarchyResult} />
      )}
    </div>
  );
}
