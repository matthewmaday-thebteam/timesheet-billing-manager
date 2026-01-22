import { useState, useCallback, useMemo } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useProjects } from '../../hooks/useProjects';
import { buildDbRateLookupByName } from '../../utils/billing';
import { DateRangeFilter } from '../DateRangeFilter';
import { BillingRatesTable } from '../BillingRatesTable';
import { MetricCard } from '../MetricCard';
import { Spinner } from '../Spinner';
import type { DateRange } from '../../types';

const TARGET_RATE_2026 = 60;

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
  const { projects: dbProjects } = useProjects();

  // Build rate lookup
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Use ratesVersion to ensure React sees this as a dependency
  void ratesVersion;

  // Calculate metrics
  const rateMetrics = useMemo(() => {
    // Get unique project names from timesheet data
    const projectNames = new Set(projects.map(p => p.projectName));

    // Count projects with defined rates and calculate average
    let totalRate = 0;
    let ratedCount = 0;
    let noRateCount = 0;
    let atTargetRateCount = 0;

    for (const projectName of projectNames) {
      const rate = dbRateLookup.get(projectName);
      if (rate !== undefined && rate !== null) {
        totalRate += rate;
        ratedCount++;
        if (rate >= TARGET_RATE_2026) {
          atTargetRateCount++;
        }
      } else {
        noRateCount++;
      }
    }

    const averageRate = ratedCount > 0 ? totalRate / ratedCount : 0;

    return {
      averageRate,
      noRateCount,
      targetRate: TARGET_RATE_2026,
      atTargetRateCount,
    };
  }, [projects, dbRateLookup]);

  const currentYear = new Date().getFullYear();

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Current and Historical Rates</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Set Rates for the month of <span className="text-bteam-brand font-medium">{format(dateRange.start, 'MMMM yyyy')}</span>
          </p>
        </div>
      </div>

      {/* Date Range Filter */}
      <DateRangeFilter dateRange={dateRange} onChange={setDateRange} hideCustomRange={true} />

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Average Rate"
          value={`$${rateMetrics.averageRate.toFixed(2)}`}
        />
        <MetricCard
          title={`${currentYear} Rate`}
          value={`$${rateMetrics.targetRate.toFixed(2)}`}
        />
        <MetricCard
          title={`At ${currentYear} Rate`}
          value={rateMetrics.atTargetRateCount}
        />
        <MetricCard
          title="No Rate Assigned"
          value={rateMetrics.noRateCount}
          isAlert={rateMetrics.noRateCount > 0}
        />
      </div>

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
