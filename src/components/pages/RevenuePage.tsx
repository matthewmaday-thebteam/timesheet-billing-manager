import { useState, useMemo, useCallback } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useUnifiedBilling } from '../../hooks/useUnifiedBilling';
import { useBillings } from '../../hooks/useBillings';
import {
  formatCurrency,
  formatHours,
  applyRounding,
  calculateBilledHours,
  DEFAULT_ROUNDING_INCREMENT,
} from '../../utils/billing';
import { RangeSelector } from '../atoms/RangeSelector';
import { RevenueTable } from '../atoms/RevenueTable';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import type { DateRange, MonthSelection, ProjectRateDisplayWithBilling } from '../../types';

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

  // Build billing data lookup by EXTERNAL project ID (Clockify/ClickUp ID)
  // This matches the project_id in timesheet entries
  const billingDataByProjectId = useMemo(() => {
    const map = new Map<string, ProjectRateDisplayWithBilling>();
    for (const p of projectsWithRates) {
      if (p.externalProjectId) {
        map.set(p.externalProjectId, p);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Use unified billing calculation - single source of truth
  // CRITICAL: Company grouping now uses project's canonical company info (from projectsWithRates)
  const { totalRevenue, billingResult, unmatchedProjects, allProjectsMatched } = useUnifiedBilling({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
  });

  // Fetch fixed billings for the date range
  const {
    companyBillings,
    totalCents: totalBillingCents,
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

    return companyBillings.map(company => ({
      ...company,
      billings: company.billings.filter(b => !linkedBillingIds.has(b.id)),
    }));
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

  // Combined total revenue (time-based + fixed billings)
  const combinedTotalRevenue = totalRevenue + (totalBillingCents / 100);

  // Check if any projects have billing limits for CSV export
  const hasBillingLimitsForExport = useMemo(() => {
    for (const data of billingDataByProjectId.values()) {
      if (data.minimumHours !== null || data.maximumHours !== null || data.carryoverHoursIn > 0) {
        return true;
      }
    }
    return false;
  }, [billingDataByProjectId]);

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    // Build CSV data from entries
    const csvRows: string[][] = [];

    // Title row
    csvRows.push([`Revenue for the month of ${format(dateRange.start, 'MMMM yyyy')}`]);

    // Header row - conditionally include billing columns
    const headerRow = hasBillingLimitsForExport
      ? ['Company', 'Project', 'Task', 'Actual', 'Rounded', 'Carryover In', 'Adjusted', 'Billed', 'Unbillable', 'Rounding', 'Rate ($/hr)', 'Revenue']
      : ['Company', 'Project', 'Task', 'Actual', 'Hours', 'Rounding', 'Rate ($/hr)', 'Revenue'];
    csvRows.push(headerRow);

    // Data rows - aggregate by company/project/task
    const taskMap = new Map<string, { company: string; project: string; projectId: string | null; task: string; minutes: number; rate: number }>();

    for (const entry of entries) {
      // Skip entries without project ID (unmatched projects)
      if (!entry.project_id) continue;

      // Map to canonical project ID (member projects -> primary project)
      const canonicalProjectId = projectCanonicalIdLookup?.get(entry.project_id) || entry.project_id;

      // Get billing data by canonical ID only
      const billingData = billingDataByProjectId.get(canonicalProjectId);
      if (!billingData) continue; // Skip unmatched projects

      // Use canonical company name from the PROJECT (not entry's client_id)
      const company = billingData.canonicalClientName || billingData.clientName || 'Unassigned';
      // Use canonical project name from billing data
      const project = billingData.projectName;
      const projectId = canonicalProjectId;
      const task = entry.task_name || 'No Task';
      const key = `${company}|${project}|${task}`;

      const rate = billingData.effectiveRate;

      if (taskMap.has(key)) {
        taskMap.get(key)!.minutes += entry.total_minutes;
      } else {
        taskMap.set(key, { company, project, projectId, task, minutes: entry.total_minutes, rate });
      }
    }

    // Group tasks by project to apply rounding at project level
    const projectMap = new Map<string, { company: string; project: string; projectId: string | null; tasks: { task: string; minutes: number }[]; rate: number; totalMinutes: number }>();

    for (const item of taskMap.values()) {
      const projectKey = `${item.company}|${item.project}`;
      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, {
          company: item.company,
          project: item.project,
          projectId: item.projectId,
          tasks: [],
          rate: item.rate,
          totalMinutes: 0,
        });
      }
      const proj = projectMap.get(projectKey)!;
      proj.tasks.push({ task: item.task, minutes: item.minutes });
      proj.totalMinutes += item.minutes;
    }

    // Convert to CSV rows sorted by company, project, task
    const sortedProjects = Array.from(projectMap.values()).sort((a, b) => {
      if (a.company !== b.company) return a.company.localeCompare(b.company);
      return a.project.localeCompare(b.project);
    });

    for (const proj of sortedProjects) {
      // Get billing data for this project - ID lookup only
      if (!proj.projectId) continue;
      const billingData = billingDataByProjectId.get(proj.projectId);
      if (!billingData) continue; // Skip unmatched projects

      // Use rate and rounding from billingData (ID lookup)
      const effectiveRate = billingData.effectiveRate;
      const rounding = billingData.effectiveRounding ?? DEFAULT_ROUNDING_INCREMENT;

      const incLabel = rounding === 0 ? '—' : `${rounding}m`;

      // Calculate project-level rounded minutes (for billing calc)
      let projectRoundedMinutes = 0;
      for (const task of proj.tasks) {
        projectRoundedMinutes += applyRounding(task.minutes, rounding);
      }

      // Calculate billing result for the project (if limits exist)
      let carryoverIn = 0;
      let adjustedHours = projectRoundedMinutes / 60;
      let billedHours = adjustedHours;
      let unbillableHours = 0;
      let billedRevenue = billedHours * effectiveRate;

      if (billingData && (billingData.minimumHours !== null || billingData.maximumHours !== null || billingData.carryoverHoursIn > 0)) {
        carryoverIn = billingData.carryoverHoursIn || 0;
        const limits = {
          minimumHours: billingData.minimumHours,
          maximumHours: billingData.maximumHours,
          carryoverEnabled: billingData.carryoverEnabled,
          carryoverMaxHours: billingData.carryoverMaxHours,
          carryoverExpiryMonths: billingData.carryoverExpiryMonths,
        };

        const billingResult = calculateBilledHours(
          projectRoundedMinutes,
          limits,
          carryoverIn,
          effectiveRate,
          billingData.isActive
        );

        adjustedHours = billingResult.adjustedHours;
        billedHours = billingResult.billedHours;
        unbillableHours = billingResult.unbillableHours;
        billedRevenue = billingResult.revenue;
      }

      // Sort tasks by minutes
      proj.tasks.sort((a, b) => b.minutes - a.minutes);

      // Track if this is the first task for the project (to add project-level billing)
      let isFirstTask = true;

      for (const task of proj.tasks) {
        // Apply rounding to each task individually
        const roundedTaskMinutes = applyRounding(task.minutes, rounding);
        const actualHours = (task.minutes / 60).toFixed(2);
        const roundedHours = (roundedTaskMinutes / 60).toFixed(2);
        const taskRevenue = ((roundedTaskMinutes / 60) * effectiveRate).toFixed(2);

        if (hasBillingLimitsForExport) {
          // Include billing columns - only show project-level billing on first task
          csvRows.push([
            proj.company,
            proj.project,
            task.task,
            actualHours,
            roundedHours,
            isFirstTask ? formatHours(carryoverIn) : '',
            isFirstTask ? formatHours(adjustedHours) : '',
            isFirstTask ? formatHours(billedHours) : '',
            isFirstTask && unbillableHours > 0 ? formatHours(unbillableHours) : '',
            incLabel,
            effectiveRate.toFixed(2),
            isFirstTask ? billedRevenue.toFixed(2) : taskRevenue,
          ]);
          isFirstTask = false;
        } else {
          // Standard export without billing columns
          csvRows.push([
            proj.company,
            proj.project,
            task.task,
            actualHours,
            roundedHours,
            incLabel,
            effectiveRate.toFixed(2),
            taskRevenue,
          ]);
        }
      }
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
    link.download = `revenue-${format(dateRange.start, 'yyyy-MM')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [entries, billingDataByProjectId, hasBillingLimitsForExport, dateRange.start, projectCanonicalIdLookup]);

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
