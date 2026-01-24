import { useState, useCallback, useMemo } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { AccordionFlat } from '../AccordionFlat';
import { Spinner } from '../Spinner';
import { Button } from '../Button';
import { DropdownMenu } from '../DropdownMenu';
import type { MonthSelection, DateRange } from '../../types';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useCanonicalCompanyMapping } from '../../hooks/useCanonicalCompanyMapping';
import type { AccordionFlatColumn, AccordionFlatRow, AccordionFlatGroup } from '../AccordionFlat';

/**
 * Convert DateRange to MonthSelection (uses start date's month)
 */
function dateRangeToMonth(range: DateRange): MonthSelection {
  return {
    year: range.start.getFullYear(),
    month: range.start.getMonth() + 1,
  };
}

export function ProjectsPage() {
  const [dateRange] = useState<DateRange>(() => {
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
  } = useMonthlyRates({ selectedMonth });

  // Get canonical company mapping for CSV export and table grouping
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    const csvRows: string[][] = [];

    // Title row
    csvRows.push(['Project Log']);

    // Header row
    csvRows.push(['Company', 'Project']);

    // Sort by company then project (using canonical company names)
    const sortedProjectsForExport = [...projectsWithRates].sort((a, b) => {
      const canonicalA = a.clientId ? getCanonicalCompany(a.clientId) : null;
      const canonicalB = b.clientId ? getCanonicalCompany(b.clientId) : null;
      const companyA = canonicalA?.canonicalDisplayName || a.clientName || 'Unassigned';
      const companyB = canonicalB?.canonicalDisplayName || b.clientName || 'Unassigned';
      if (companyA !== companyB) return companyA.localeCompare(companyB);
      return a.projectName.localeCompare(b.projectName);
    });

    // Data rows
    for (const project of sortedProjectsForExport) {
      // Use canonical company name if available
      const canonicalInfo = project.clientId ? getCanonicalCompany(project.clientId) : null;
      const companyName = canonicalInfo?.canonicalDisplayName || project.clientName || 'Unassigned';
      csvRows.push([
        companyName,
        project.projectName,
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
    link.download = `projects-${format(dateRange.start, 'yyyy-MM')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [projectsWithRates, dateRange.start, getCanonicalCompany]);

  // Sort projects by name
  const sortedProjects = useMemo(() => {
    return [...projectsWithRates].sort((a, b) => {
      return a.projectName.localeCompare(b.projectName);
    });
  }, [projectsWithRates]);

  // Define columns for AccordionFlat
  const columns: AccordionFlatColumn[] = [
    { key: 'project', label: 'Project', align: 'left' },
    { key: 'associations', label: 'Associations', align: 'right' },
  ];

  // Helper to build a row for a project
  const buildProjectRow = (project: typeof projectsWithRates[0]): AccordionFlatRow => {
    const menuItems = [
      {
        label: 'Edit',
        onClick: () => {
          // TODO: Implement edit functionality
        },
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
      },
    ];

    return {
      id: project.projectId,
      cells: {
        project: (
          <span className="text-vercel-gray-600">
            {project.projectName}
          </span>
        ),
        associations: (
          <div className="flex items-center justify-end">
            <span className="text-vercel-gray-400">—</span>
            <div className="ml-4 w-6 shrink-0 flex justify-center" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu items={menuItems} />
            </div>
          </div>
        ),
      },
    };
  };

  // Group projects by company/client (using canonical company names)
  const groupedByCompany = useMemo(() => {
    const groupMap = new Map<string, typeof projectsWithRates>();

    for (const project of sortedProjects) {
      // Use canonical company name if available
      const canonicalInfo = project.clientId ? getCanonicalCompany(project.clientId) : null;
      const clientName = canonicalInfo?.canonicalDisplayName || project.clientName || 'Unassigned';
      if (!groupMap.has(clientName)) {
        groupMap.set(clientName, []);
      }
      groupMap.get(clientName)!.push(project);
    }

    return groupMap;
  }, [sortedProjects, getCanonicalCompany]);

  // Build groups for AccordionFlat
  const groups: AccordionFlatGroup[] = useMemo(() => {
    const result: AccordionFlatGroup[] = [];

    for (const [clientName, clientProjects] of groupedByCompany) {
      result.push({
        id: clientName,
        label: clientName,
        rows: clientProjects.map(buildProjectRow),
      });
    }

    // Sort groups alphabetically by company name
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [groupedByCompany]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Projects</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Below are the known projects in the system and their associations
          </p>
        </div>
      </div>

      {/* Export Button Container */}
      <div className="flex flex-wrap items-center gap-4 p-6 bg-white rounded-lg border border-vercel-gray-100">
        <div className="ml-auto">
          <Button
            variant="secondary"
            onClick={handleExportCSV}
            disabled={isLoading || projectsWithRates.length === 0}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </Button>
        </div>
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

      {/* Projects Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading projects...</span>
        </div>
      ) : (
        <AccordionFlat
          alwaysExpanded={true}
          columns={columns}
          groups={groups}
        />
      )}
    </div>
  );
}
