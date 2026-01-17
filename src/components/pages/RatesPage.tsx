import { useState, useCallback } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { DateRangeFilter } from '../DateRangeFilter';
import { BillingRatesTable } from '../BillingRatesTable';
import { Spinner } from '../Spinner';
import type { DateRange } from '../../types';

export function RatesPage() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  // Force re-render when billing rates change
  const [ratesVersion, setRatesVersion] = useState(0);
  const handleRatesChange = useCallback(() => {
    setRatesVersion(v => v + 1);
  }, []);

  const { projects, loading, error } = useTimesheetData(dateRange);

  // Use ratesVersion to ensure React sees this as a dependency
  void ratesVersion;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Billing Rates & Revenue</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage hourly billing rates and view revenue by project
          </p>
        </div>
      </div>

      {/* Date Range Filter */}
      <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />

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
        <BillingRatesTable
          projects={projects}
          onRatesChange={handleRatesChange}
        />
      )}
    </div>
  );
}
