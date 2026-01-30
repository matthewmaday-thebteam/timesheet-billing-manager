import { useState, useMemo, useCallback } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useUnifiedBilling } from '../../hooks/useUnifiedBilling';
import { useCarryoverSync } from '../../hooks/useCarryoverSync';
import { useBillings } from '../../hooks/useBillings';
import { formatCurrency } from '../../utils/billing';
import { generateRevenueCSV, downloadCSV } from '../../utils/generateRevenueCSV';
import { RangeSelector } from '../atoms/RangeSelector';
import { RevenueTable } from '../atoms/RevenueTable';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import type { DateRange, MonthSelection } from '../../types';

export function RevenuePage() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  const { entries, projectCanonicalIdLookup, loading, error } = useTimesheetData(dateRange);

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates (which now includes rounding data)
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Use unified billing calculation - single source of truth
  // CRITICAL: Company grouping now uses project's canonical company info (from projectsWithRates)
  const { totalRevenue, billingResult, unmatchedProjects, allProjectsMatched } = useUnifiedBilling({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
  });

  // Auto-persist carryover to database so next month can read it
  useCarryoverSync({
    billingResult,
    projectsWithRates,
    selectedMonth,
    loading,
  });

  // Fetch fixed billings for the date range
  const {
    companyBillings,
    isLoading: billingsLoading,
    error: billingsError,
  } = useBillings({ dateRange });

  // Build lookup: internal UUID -> externalProjectId
  const internalToExternalId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsWithRates) {
      if (p.projectId && p.externalProjectId) {
        map.set(p.projectId, p.externalProjectId);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Build lookup: externalProjectId -> milestone billing data
  const milestoneByExternalProjectId = useMemo(() => {
    const map = new Map<string, { totalCents: number; billingId: string }>();
    for (const company of companyBillings) {
      for (const billing of company.billings) {
        if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
          const externalId = internalToExternalId.get(billing.linkedProjectId);
          if (externalId) {
            // Sum if multiple milestones for same project
            const existing = map.get(externalId);
            map.set(externalId, {
              totalCents: (existing?.totalCents || 0) + billing.totalCents,
              billingId: billing.id,
            });
          }
        }
      }
    }
    return map;
  }, [companyBillings, internalToExternalId]);

  // Filter out linked milestone billings from display
  const filteredCompanyBillings = useMemo(() => {
    const linkedBillingIds = new Set<string>();
    for (const company of companyBillings) {
      for (const billing of company.billings) {
        if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
          const externalId = internalToExternalId.get(billing.linkedProjectId);
          if (externalId) linkedBillingIds.add(billing.id);
        }
      }
    }

    return companyBillings.map(company => {
      const filteredBillings = company.billings.filter(b => !linkedBillingIds.has(b.id));
      // Recalculate totalCents after filtering
      const filteredTotalCents = filteredBillings.reduce((sum, b) => sum + b.totalCents, 0);
      return {
        ...company,
        billings: filteredBillings,
        totalCents: filteredTotalCents,
      };
    });
  }, [companyBillings, internalToExternalId]);

  // Calculate filtered billing cents (excludes linked milestones)
  const filteredBillingCents = useMemo(() => {
    let total = 0;
    for (const company of filteredCompanyBillings) {
      for (const billing of company.billings) {
        total += billing.totalCents;
      }
    }
    return total;
  }, [filteredCompanyBillings]);

  // Calculate milestone adjustment for header total
  // When a project has a linked milestone, replace timesheet revenue with milestone amount
  const milestoneAdjustment = useMemo(() => {
    let adjustment = 0;
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          const milestone = milestoneByExternalProjectId.get(project.projectId);
          if (milestone) {
            // Replace timesheet revenue with milestone: add milestone, subtract timesheet
            adjustment += (milestone.totalCents / 100) - project.billedRevenue;
          }
        }
      }
    }
    return adjustment;
  }, [billingResult.companies, milestoneByExternalProjectId]);

  // Combined total revenue (time-based + filtered fixed billings + milestone adjustments)
  // Use filteredBillingCents to exclude linked milestones (they're accounted for in milestoneAdjustment)
  const combinedTotalRevenue = totalRevenue + (filteredBillingCents / 100) + milestoneAdjustment;

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    const csvContent = generateRevenueCSV({
      billingResult,
      filteredCompanyBillings,
      milestoneByExternalProjectId,
      monthLabel: format(dateRange.start, 'MMMM yyyy'),
    });
    downloadCSV(csvContent, `revenue-${format(dateRange.start, 'yyyy-MM')}.csv`);
  }, [billingResult, filteredCompanyBillings, milestoneByExternalProjectId, dateRange.start]);

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
        {!loading && !billingsLoading && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(combinedTotalRevenue)}</span>
          </div>
        )}
      </div>

      {/* Range Selector with Export */}
      <RangeSelector
        variant="export"
        dateRange={dateRange}
        onChange={setDateRange}
        onExport={handleExportCSV}
        exportDisabled={loading || entries.length === 0}
      />

      {/* Error State */}
      {error && <Alert message={error} icon="error" variant="error" />}

      {/* Unmatched Projects Warning */}
      {!allProjectsMatched && (
        <Alert
          message={`Data integrity error: ${unmatchedProjects.length} project(s) could not be matched by ID and are excluded from billing.`}
          icon="warning"
          variant="warning"
        >
          <div className="mt-2 text-sm">
            <p className="font-medium mb-1">Unmatched projects:</p>
            <ul className="list-disc list-inside space-y-1">
              {unmatchedProjects.map((p, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{p.entryProjectId}</span>
                  {' - '}
                  {p.entryProjectName}
                  {' '}
                  <span className="text-vercel-gray-400">({(p.totalMinutes / 60).toFixed(2)} hrs)</span>
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      {/* Billings Error */}
      {billingsError && <Alert message={billingsError} icon="error" variant="error" />}

      {/* Billing Rates Table */}
      {loading || billingsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">
            {loading ? 'Loading timesheet data...' : 'Loading billings...'}
          </span>
        </div>
      ) : (
        <RevenueTable
          billingResult={billingResult}
          companyBillings={filteredCompanyBillings}
          totalBillingCents={filteredBillingCents}
          milestoneByExternalProjectId={milestoneByExternalProjectId}
        />
      )}
    </div>
  );
}
