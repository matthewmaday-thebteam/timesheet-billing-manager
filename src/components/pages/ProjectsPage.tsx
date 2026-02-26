import { useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useBilling } from '../../hooks/useBilling';
import { useProjectHierarchy } from '../../hooks/useProjectHierarchy';
import { useAllProjectManagers } from '../../hooks/useProjectManagers';
import { useProjects } from '../../hooks/useProjects';
import { formatCurrency, formatHours } from '../../utils/billing';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { RangeSelector } from '../RangeSelector';
import { ProjectHierarchyTable } from '../atoms/ProjectHierarchyTable';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import type { MonthSelection, ProjectManagerLookup } from '../../types';

export function ProjectsPage() {
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

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

  // Fetch billing result from summary table
  const { billingResult } = useBilling({ selectedMonth });

  // Build 5-tier hierarchy
  const hierarchyResult = useProjectHierarchy({
    entries,
    billingResult,
    projectCanonicalIdLookup,
    userIdToDisplayNameLookup,
  });

  // Fetch project managers (keyed by internal UUID)
  const { managerLookup: rawManagerLookup } = useAllProjectManagers();

  // Fetch projects list (for internal UUID → external project_id mapping)
  const { projects: allProjects } = useProjects();

  // Remap manager lookup: internal UUID → canonical external project_id
  // The hierarchy table uses canonical external project_id as its key
  const managerLookup = useMemo<ProjectManagerLookup>(() => {
    const result: ProjectManagerLookup = new Map();

    for (const [internalId, names] of rawManagerLookup) {
      // Find the project to get its external project_id
      const proj = allProjects.find(p => p.id === internalId);
      if (!proj) continue;

      // Resolve through canonical lookup (grouped projects share a canonical ID)
      const canonicalId = projectCanonicalIdLookup?.get(proj.project_id) ?? proj.project_id;

      // Merge names into canonical key (multiple internal projects may map to same canonical)
      const existing = result.get(canonicalId) || [];
      for (const name of names) {
        if (!existing.includes(name)) {
          existing.push(name);
        }
      }
      result.set(canonicalId, existing);
    }

    return result;
  }, [rawManagerLookup, allProjects, projectCanonicalIdLookup]);

  // Export to CSV - Revenue By Project
  const handleExportCSV = useCallback(() => {
    const csvRows: string[][] = [];

    // Title row
    csvRows.push([`Revenue By Project - ${format(dateRange.start, 'MMMM yyyy')}`]);

    // Header row
    csvRows.push(['Company', 'Project', 'Manager', 'Employee', 'Date', 'Task', 'Hours', 'Revenue']);

    // Iterate through the 5-tier hierarchy
    for (const company of hierarchyResult.companies) {
      // Company summary row
      csvRows.push([company.companyName, '', '', '', '', '', formatHours(company.hours), formatCurrency(company.revenue)]);

      for (const project of company.projects) {
        const projectManagers = managerLookup.get(project.projectId)?.join('; ') ?? '';
        // Project row
        csvRows.push([company.companyName, project.projectName, projectManagers, '', '', '', formatHours(project.hours), formatCurrency(project.revenue)]);

        for (const employee of project.employees) {
          for (const day of employee.days) {
            for (const task of day.tasks) {
              // Task row (full detail)
              csvRows.push([
                company.companyName,
                project.projectName,
                '',
                employee.employeeName,
                day.displayDate,
                task.taskName,
                formatHours(task.hours),
                formatCurrency(task.revenue),
              ]);
            }
          }
        }
      }

      // Empty row between companies
      csvRows.push(['']);
    }

    // Total row
    csvRows.push(['TOTAL', '', '', '', '', '', formatHours(hierarchyResult.totalHours), formatCurrency(hierarchyResult.totalRevenue)]);

    // Convert to CSV string
    const csvContent = csvRows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // Create and download file
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `revenue-by-project-${format(dateRange.start, 'yyyy-MM')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [hierarchyResult, dateRange.start, managerLookup]);

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
              <div className="text-lg font-semibold text-vercel-gray-600">{hierarchyResult.totalHours.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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

      {/* Range Selector with Export */}
      <RangeSelector
        variant="export"
        dateRange={dateRange}
        onChange={setDateRange}
        exportOptions={[
          { label: 'Revenue By Project', onClick: handleExportCSV },
        ]}
        exportDisabled={loading || hierarchyResult.companies.length === 0}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
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
        <div className="bg-white rounded-lg border border-vercel-gray-100 p-6 text-center">
          <p className="text-sm text-vercel-gray-400">No timesheet data for this month.</p>
        </div>
      ) : (
        <ProjectHierarchyTable hierarchyResult={hierarchyResult} managerLookup={managerLookup} />
      )}
    </div>
  );
}
