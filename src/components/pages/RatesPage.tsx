import { useState, useCallback, useMemo } from 'react';
import { MonthPicker } from '../MonthPicker';
import { BillingRatesTable } from '../BillingRatesTable';
import { MetricCard } from '../MetricCard';
import { Spinner } from '../Spinner';
import type { MonthSelection } from '../../types';
import {
  useMonthlyRates,
  getCurrentMonth,
  formatMonthDisplay,
  isFutureMonth,
} from '../../hooks/useMonthlyRates';

const TARGET_RATE_2026 = 60;

export function RatesPage() {
  const [selectedMonth, setSelectedMonth] = useState<MonthSelection>(getCurrentMonth);

  // Fetch monthly rates using the new hook
  const {
    projectsWithRates,
    isLoading,
    error,
    updateRate,
    refetch,
  } = useMonthlyRates({ selectedMonth });

  // Calculate metrics from monthly rates data
  const rateMetrics = useMemo(() => {
    const projectsInMonth = projectsWithRates.filter(p => p.existedInSelectedMonth);

    let totalRate = 0;
    let ratedCount = 0;
    let noExplicitRateCount = 0;
    let atTargetRateCount = 0;

    for (const project of projectsWithRates) {
      totalRate += project.effectiveRate;
      ratedCount++;

      if (project.effectiveRate >= TARGET_RATE_2026) {
        atTargetRateCount++;
      }

      // Count projects without an explicit rate for this month
      if (!project.hasExplicitRateThisMonth) {
        noExplicitRateCount++;
      }
    }

    const averageRate = ratedCount > 0 ? totalRate / ratedCount : 0;

    return {
      totalProjects: projectsWithRates.length,
      projectsInMonth: projectsInMonth.length,
      averageRate,
      noExplicitRateCount,
      targetRate: TARGET_RATE_2026,
      atTargetRateCount,
    };
  }, [projectsWithRates]);

  const handleRatesChange = useCallback(() => {
    refetch();
  }, [refetch]);

  const currentYear = new Date().getFullYear();
  const isFuture = isFutureMonth(selectedMonth);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Current and Historical Rates</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            {isFuture ? 'Schedule rates for' : 'Set rates for'}{' '}
            <span className="text-bteam-brand font-medium">{formatMonthDisplay(selectedMonth)}</span>
          </p>
        </div>
      </div>

      {/* Month Picker */}
      <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
        <div className="flex items-center justify-between">
          <MonthPicker
            selectedMonth={selectedMonth}
            onChange={setSelectedMonth}
            showTodayButton={true}
          />

          {/* Rate source legend */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-vercel-gray-400">Set this month</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span className="text-vercel-gray-400">Inherited</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-vercel-gray-300"></span>
              <span className="text-vercel-gray-400">Default</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Average Rate"
          value={`$${rateMetrics.averageRate.toFixed(2)}`}
        />
        <MetricCard
          title={`${currentYear} Target`}
          value={`$${rateMetrics.targetRate.toFixed(2)}`}
        />
        <MetricCard
          title={`At ${currentYear} Target`}
          value={rateMetrics.atTargetRateCount}
        />
        <MetricCard
          title="Inherited/Default"
          value={rateMetrics.noExplicitRateCount}
          isAlert={false}
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
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading rates...</span>
        </div>
      ) : (
        <BillingRatesTable
          projectsWithRates={projectsWithRates}
          selectedMonth={selectedMonth}
          onUpdateRate={updateRate}
          onRatesChange={handleRatesChange}
        />
      )}
    </div>
  );
}
