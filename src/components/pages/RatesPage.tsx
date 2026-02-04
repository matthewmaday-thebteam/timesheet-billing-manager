import { useState, useCallback, useMemo } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { RangeSelector } from '../RangeSelector';
import { BillingRatesTable } from '../BillingRatesTable';
import { MetricCard } from '../MetricCard';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import type { MonthSelection, DateRange } from '../../types';
import {
  useMonthlyRates,
  formatMonthDisplay,
  isFutureMonth,
} from '../../hooks/useMonthlyRates';
import { useCanonicalCompanyMapping } from '../../hooks/useCanonicalCompanyMapping';

const TARGET_RATE_2026 = 60;
const DEFAULT_RATE = 45;

/**
 * Convert DateRange to MonthSelection (uses start date's month)
 */
function dateRangeToMonth(range: DateRange): MonthSelection {
  return {
    year: range.start.getFullYear(),
    month: range.start.getMonth() + 1,
  };
}

export function RatesPage() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  // Convert to MonthSelection for the hook
  const selectedMonth = useMemo(() => dateRangeToMonth(dateRange), [dateRange]);

  // Fetch monthly rates using the hook
  const {
    projectsWithRates,
    isLoading,
    error,
    updateRate,
    updateRounding,
    updateBillingLimits,
    updateActiveStatus,
    refetch,
  } = useMonthlyRates({ selectedMonth });

  // Get canonical company mapping for CSV export
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // Calculate metrics from monthly rates data
  const rateMetrics = useMemo(() => {
    const projectsInMonth = projectsWithRates.filter(p => p.existedInSelectedMonth);

    let totalRate = 0;
    let ratedCount = 0;
    let atDefaultRateCount = 0;
    let atTargetRateCount = 0;

    for (const project of projectsWithRates) {
      // Exclude $0 rate projects from average calculation
      if (project.effectiveRate > 0) {
        totalRate += project.effectiveRate;
        ratedCount++;
      }

      if (project.effectiveRate >= TARGET_RATE_2026) {
        atTargetRateCount++;
      }

      // Count projects at the hardcoded default rate
      if (project.effectiveRate === DEFAULT_RATE) {
        atDefaultRateCount++;
      }
    }

    const averageRate = ratedCount > 0 ? totalRate / ratedCount : 0;

    return {
      totalProjects: projectsWithRates.length,
      projectsInMonth: projectsInMonth.length,
      averageRate,
      atDefaultRateCount,
      targetRate: TARGET_RATE_2026,
      atTargetRateCount,
    };
  }, [projectsWithRates]);

  const handleRatesChange = useCallback(() => {
    refetch();
  }, [refetch]);

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    const csvRows: string[][] = [];

    // Title row
    csvRows.push([`${selectedMonth.year} Rate Card`]);

    // Header row
    csvRows.push(['Company', 'Project', 'Rate']);

    // Sort by company then project (using canonical company names via ID-only lookups)
    const sortedProjects = [...projectsWithRates].sort((a, b) => {
      const canonicalA = a.clientId ? getCanonicalCompany(a.clientId) : null;
      const canonicalB = b.clientId ? getCanonicalCompany(b.clientId) : null;
      const companyA = canonicalA?.canonicalDisplayName || 'Unknown';
      const companyB = canonicalB?.canonicalDisplayName || 'Unknown';
      if (companyA !== companyB) return companyA.localeCompare(companyB);
      return a.projectName.localeCompare(b.projectName);
    });

    // Data rows
    for (const project of sortedProjects) {
      // Use canonical company name via ID-only lookup (no name fallbacks)
      const canonicalInfo = project.clientId ? getCanonicalCompany(project.clientId) : null;
      const companyName = canonicalInfo?.canonicalDisplayName || 'Unknown';
      csvRows.push([
        companyName,
        project.projectName,
        project.effectiveRate.toFixed(2),
      ]);
    }

    // Convert to CSV string
    const csvContent = csvRows
      .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rates-${format(dateRange.start, 'yyyy-MM')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [projectsWithRates, dateRange.start, getCanonicalCompany, selectedMonth.year]);

  const currentYear = new Date().getFullYear();
  const isFuture = isFutureMonth(selectedMonth);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Current and Historical Rates</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            {isFuture ? 'Schedule rates for' : 'Rates for'}{' '}
            <span className="text-bteam-brand font-medium">{formatMonthDisplay(selectedMonth)}</span>
          </p>
        </div>
      </div>

      {/* Range Selector with Export */}
      <RangeSelector
        variant="export"
        dateRange={dateRange}
        onChange={setDateRange}
        exportOptions={[
          { label: 'Current Rate Card', onClick: handleExportCSV },
        ]}
        exportDisabled={isLoading || projectsWithRates.length === 0}
      />

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          title="Average Rate"
          value={`$${rateMetrics.averageRate.toFixed(2)}`}
        />
        <MetricCard
          title={`${currentYear} Target`}
          value={`$${rateMetrics.targetRate.toFixed(2)}`}
        />
        <MetricCard
          title="Base Rate"
          value={`$${DEFAULT_RATE.toFixed(2)}`}
        />
        <MetricCard
          title={`At ${currentYear} Target`}
          value={rateMetrics.atTargetRateCount.toLocaleString('en-US')}
        />
        <MetricCard
          title="Default"
          value={rateMetrics.atDefaultRateCount.toLocaleString('en-US')}
        />
      </div>

      {/* Error State */}
      {error && <Alert message={error} icon="error" variant="error" />}

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
          onUpdateRounding={updateRounding}
          onUpdateBillingLimits={updateBillingLimits}
          onUpdateActiveStatus={updateActiveStatus}
          onRatesChange={handleRatesChange}
        />
      )}
    </div>
  );
}
