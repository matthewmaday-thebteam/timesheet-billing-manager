import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useBilling } from '../../hooks/useBilling';
import { useCarryoverSync } from '../../hooks/useCarryoverSync';
import { useBillings } from '../../hooks/useBillings';
import { formatCurrency } from '../../utils/billing';
import { generateRevenueCSV, downloadCSV } from '../../utils/generateRevenueCSV';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { RangeSelector } from '../RangeSelector';
import { RevenueTable } from '../atoms/RevenueTable';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { Modal } from '../Modal';
import { Button } from '../Button';
import type { MonthSelection } from '../../types';

export function RevenuePage() {
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  const { entries, projectCanonicalIdLookup, loading, error } = useTimesheetData(dateRange);

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates (which now includes rounding data)
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Use billing wrapper (delegates to frontend or summary based on feature flag)
  const { totalRevenue, billingResult, unmatchedProjects, allProjectsMatched } = useBilling({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
    selectedMonth,
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

  // Earned revenue: billed revenue + dollar value of hours rolled over or lost to max cap
  // For milestone projects the milestone IS the earned amount (no rollover concept)
  const rolledOverRevenue = useMemo(() => {
    let extra = 0;
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        // Skip milestone-linked projects — milestone amount is the earned amount
        if (project.projectId && milestoneByExternalProjectId.has(project.projectId)) continue;
        extra += (project.carryoverOut + project.unbillableHours) * project.rate;
      }
    }
    return extra;
  }, [billingResult.companies, milestoneByExternalProjectId]);
  const earnedTotalRevenue = combinedTotalRevenue + rolledOverRevenue;

  // --- Export modal state ---
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());

  // Build alphabetized company list with revenue for the modal
  const sortedCompaniesForExport = useMemo(() => {
    // Merge time-based companies and fixed-billing-only companies
    const companyMap = new Map<string, { id: string; name: string; revenue: number }>();

    for (const c of billingResult.companies) {
      const billingData = filteredCompanyBillings.find(cb => cb.companyClientId === c.companyId);
      const billingCents = billingData?.totalCents || 0;
      let adj = 0;
      for (const project of c.projects) {
        if (project.projectId) {
          const milestone = milestoneByExternalProjectId.get(project.projectId);
          if (milestone) {
            adj += (milestone.totalCents / 100) - project.billedRevenue;
          }
        }
      }
      companyMap.set(c.companyId, {
        id: c.companyId,
        name: c.companyName,
        revenue: c.billedRevenue + (billingCents / 100) + adj,
      });
    }

    // Include fixed-billing-only companies not already in the time-based set
    for (const cb of filteredCompanyBillings) {
      if (!companyMap.has(cb.companyClientId)) {
        companyMap.set(cb.companyClientId, {
          id: cb.companyClientId,
          name: cb.companyName,
          revenue: cb.totalCents / 100,
        });
      }
    }

    return [...companyMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [billingResult.companies, filteredCompanyBillings, milestoneByExternalProjectId]);

  // Open modal and select all companies by default
  const handleOpenExportModal = useCallback(() => {
    setSelectedCompanyIds(new Set(sortedCompaniesForExport.map(c => c.id)));
    setShowExportModal(true);
  }, [sortedCompaniesForExport]);

  const handleToggleCompany = useCallback((companyId: string) => {
    setSelectedCompanyIds(prev => {
      const next = new Set(prev);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedCompanyIds(prev => {
      if (prev.size === sortedCompaniesForExport.length) {
        return new Set();
      }
      return new Set(sortedCompaniesForExport.map(c => c.id));
    });
  }, [sortedCompaniesForExport]);

  const handleExportCSV = useCallback(() => {
    const csvContent = generateRevenueCSV({
      billingResult,
      filteredCompanyBillings,
      milestoneByExternalProjectId,
      monthLabel: format(dateRange.start, 'MMMM yyyy'),
      companyIds: selectedCompanyIds,
    });
    downloadCSV(csvContent, `revenue-${format(dateRange.start, 'yyyy-MM')}.csv`);
    setShowExportModal(false);
  }, [billingResult, filteredCompanyBillings, milestoneByExternalProjectId, dateRange.start, selectedCompanyIds]);

  // Export Customer Revenue Report
  const handleExportCustomerRevenue = useCallback(() => {
    const csvRows: string[][] = [];

    // Title row
    csvRows.push([`Customer Revenue Report - ${format(dateRange.start, 'MMMM yyyy')}`]);

    // Header row
    csvRows.push(['Company', 'Project', 'Task', 'Hours', 'Rate ($/hr)', 'Project Revenue', 'Company Revenue']);

    // Sort companies alphabetically
    const sortedCompanies = [...billingResult.companies].sort((a, b) =>
      a.companyName.localeCompare(b.companyName)
    );

    for (const company of sortedCompanies) {
      // Calculate company revenue including milestone adjustments
      const companyBillingData = filteredCompanyBillings.find(cb => cb.companyClientId === company.companyId);
      const companyBillingCents = companyBillingData?.totalCents || 0;
      let milestoneAdj = 0;
      for (const project of company.projects) {
        if (project.projectId) {
          const milestone = milestoneByExternalProjectId.get(project.projectId);
          if (milestone) {
            milestoneAdj += (milestone.totalCents / 100) - project.billedRevenue;
          }
        }
      }
      const companyTotalRevenue = company.billedRevenue + (companyBillingCents / 100) + milestoneAdj;
      const companyTotalHours = company.billedHours;

      // Company summary row
      csvRows.push([
        company.companyName,
        '',
        '',
        companyTotalHours.toFixed(2),
        '',
        '',
        formatCurrency(companyTotalRevenue),
      ]);

      // Sort projects alphabetically
      const sortedProjects = [...company.projects].sort((a, b) =>
        a.projectName.localeCompare(b.projectName)
      );

      for (const project of sortedProjects) {
        // Check for milestone override
        const milestone = project.projectId
          ? milestoneByExternalProjectId.get(project.projectId)
          : undefined;
        const projectRevenue = milestone
          ? milestone.totalCents / 100
          : project.billedRevenue;

        // Project summary row
        csvRows.push([
          company.companyName,
          project.projectName,
          '',
          project.billedHours.toFixed(2),
          project.rate.toFixed(2),
          formatCurrency(projectRevenue),
          '',
        ]);

        // Task rows
        const sortedTasks = [...project.tasks].sort((a, b) =>
          b.roundedHours - a.roundedHours
        );

        for (const task of sortedTasks) {
          csvRows.push([
            company.companyName,
            project.projectName,
            task.taskName,
            task.roundedHours.toFixed(2),
            project.rate.toFixed(2),
            '',
            '',
          ]);
        }
      }

      // Empty row between companies
      csvRows.push(['']);
    }

    // Total row
    csvRows.push([
      'TOTAL',
      '',
      '',
      billingResult.billedHours.toFixed(2),
      '',
      '',
      formatCurrency(totalRevenue + (filteredBillingCents / 100) + milestoneAdjustment),
    ]);

    // Convert to CSV string
    const csvContent = csvRows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // Download
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `customer-revenue-${format(dateRange.start, 'yyyy-MM')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [billingResult, filteredCompanyBillings, milestoneByExternalProjectId, dateRange.start, totalRevenue, filteredBillingCents, milestoneAdjustment]);

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
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(combinedTotalRevenue)}</span>
            </div>
            {Math.round(earnedTotalRevenue * 100) !== Math.round(combinedTotalRevenue * 100) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-vercel-gray-300 uppercase tracking-wide">Earned</span>
                <span className="text-lg font-semibold text-vercel-gray-400">{formatCurrency(earnedTotalRevenue)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Range Selector with Export */}
      <RangeSelector
        variant="export"
        dateRange={dateRange}
        onChange={setDateRange}
        exportOptions={[
          { label: 'Detailed Revenue', onClick: handleOpenExportModal },
          { label: 'Customer Revenue Report', onClick: handleExportCustomerRevenue },
        ]}
        exportDisabled={loading || entries.length === 0}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
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

      {/* Export CSV Modal */}
      <Modal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Revenue CSV"
        maxWidth="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowExportModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleExportCSV}
              disabled={selectedCompanyIds.size === 0}
            >
              Export
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-vercel-gray-400">
            {format(dateRange.start, 'MMMM yyyy')}
          </p>

          {/* Select All */}
          <label className="flex items-center gap-3 pb-3 border-b border-vercel-gray-100 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedCompanyIds.size === sortedCompaniesForExport.length}
              ref={(el) => {
                if (el) {
                  el.indeterminate =
                    selectedCompanyIds.size > 0 &&
                    selectedCompanyIds.size < sortedCompaniesForExport.length;
                }
              }}
              onChange={handleToggleAll}
              className="h-4 w-4 rounded border-vercel-gray-200 text-vercel-gray-600 focus:ring-vercel-gray-600"
            />
            <span className="text-sm font-medium text-vercel-gray-600">Select All</span>
          </label>

          {/* Company list */}
          <div className="max-h-72 overflow-y-auto space-y-1 scrollbar-thin">
            {sortedCompaniesForExport.map(company => (
              <label
                key={company.id}
                className="flex items-center gap-3 py-1.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedCompanyIds.has(company.id)}
                  onChange={() => handleToggleCompany(company.id)}
                  className="h-4 w-4 rounded border-vercel-gray-200 text-vercel-gray-600 focus:ring-vercel-gray-600"
                />
                <span className="flex-1 text-sm text-vercel-gray-600">{company.name}</span>
                <span className="text-sm text-vercel-gray-300 tabular-nums">
                  {formatCurrency(company.revenue)}
                </span>
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
