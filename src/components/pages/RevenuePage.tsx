import { useState, useMemo } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useProjects } from '../../hooks/useProjects';
import { calculateProjectRevenue, formatCurrency, buildDbRateLookupByName } from '../../utils/billing';
import { DateRangeFilter } from '../DateRangeFilter';
import { RevenueTable } from '../atoms/RevenueTable';
import { Spinner } from '../Spinner';
import type { DateRange } from '../../types';

export function RevenuePage() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  const { projects, entries, loading, error } = useTimesheetData(dateRange);
  const { projects: dbProjects } = useProjects();

  // Calculate total revenue
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);
  const totalRevenue = useMemo(() => {
    return projects.reduce(
      (sum, p) => sum + calculateProjectRevenue(p, {}, dbRateLookup),
      0
    );
  }, [projects, dbRateLookup]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Revenue</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Revenue for the month of <span className="text-bteam-brand font-medium">{format(dateRange.start, 'MMMM yyyy')}</span>
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(totalRevenue)}</span>
          </div>
        )}
      </div>

      {/* Date Range Filter */}
      <DateRangeFilter dateRange={dateRange} onChange={setDateRange} hideCustomRange={true} />

      {/* Error State */}
      {error && (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-error">{error}</span>
          </div>
        </div>
      )}

      {/* Billing Rates Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading timesheet data...</span>
        </div>
      ) : (
        <RevenueTable
          entries={entries}
        />
      )}
    </div>
  );
}
