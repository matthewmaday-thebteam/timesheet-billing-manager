import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Spinner } from '../Spinner';
import { Tooltip } from '../Tooltip';
import { DropdownMenu } from '../DropdownMenu';
import { Select } from '../Select';
import { RangeSelector } from '../RangeSelector';
import { ProjectEditorModal } from '../ProjectEditorModal';
import type { Project, ProjectWithGrouping } from '../../types';
import { useProjectTableEntities } from '../../hooks/useProjectTableEntities';
import { useAllProjectManagers } from '../../hooks/useProjectManagers';

export function ProjectManagementPage() {
  const {
    projects,
    loading: isLoading,
    error,
    refetch,
  } = useProjectTableEntities();

  // Fetch project managers (keyed by internal UUID — matches project.id directly)
  const { managerLookup, refetch: refetchManagers } = useAllProjectManagers();

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // Filter state
  const [filterManager, setFilterManager] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterReport, setFilterReport] = useState('');

  // Build filter options from data
  const managerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const [, managers] of managerLookup) {
      for (const name of managers) {
        names.add(name);
      }
    }
    return [
      { value: '', label: 'All Managers' },
      ...Array.from(names).sort().map(name => ({ value: name, label: name })),
    ];
  }, [managerLookup]);

  const companyOptions = useMemo(() => {
    const companies = new Set<string>();
    for (const project of projects) {
      companies.add(project.company_display_name || 'Unassigned');
    }
    return [
      { value: '', label: 'All Companies' },
      ...Array.from(companies).sort().map(name => ({ value: name, label: name })),
    ];
  }, [projects]);

  const reportOptions = [
    { value: '', label: 'All' },
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ];

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    const csvRows: string[] = [];

    // Header row
    csvRows.push('"System IDs","Project","Manager","Company","Report"');

    // Data rows
    for (const project of projects) {
      const idCount = getIdCount(project);
      const companyName = project.company_display_name || 'Unassigned';
      const managers = managerLookup.get(project.id)?.join('; ') ?? '';
      const report = project.send_weekly_report ? 'Yes' : 'No';
      csvRows.push(`"${idCount}","${project.project_name.replace(/"/g, '""')}","${managers.replace(/"/g, '""')}","${companyName.replace(/"/g, '""')}","${report}"`);
    }

    // Convert to CSV string
    const csvContent = csvRows.join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `projects-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [projects, managerLookup]);

  const handleEditClick = (project: ProjectWithGrouping) => {
    // Convert to base Project type for modal
    const baseProject: Project = {
      id: project.id,
      project_id: project.project_id,
      project_name: project.project_name,
      rate: project.rate,
      target_hours: project.target_hours,
      send_weekly_report: project.send_weekly_report,
      created_at: project.created_at,
      updated_at: project.updated_at,
    };
    setSelectedProject(baseProject);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedProject(null);
  };

  const handleGroupChange = () => {
    refetch();
    refetchManagers();
  };

  // Get total ID count for a project (itself + members)
  const getIdCount = (project: ProjectWithGrouping): number => {
    if (project.grouping_role === 'primary') {
      return 1 + project.member_count;
    }
    return 1;
  };

  // Sort projects by company then by project name, then apply filters
  const filteredProjects = useMemo(() => {
    const sorted = [...projects].sort((a, b) => {
      const companyA = a.company_display_name || 'ZZZZZ'; // Sort unassigned last
      const companyB = b.company_display_name || 'ZZZZZ';
      if (companyA !== companyB) {
        return companyA.localeCompare(companyB);
      }
      return a.project_name.localeCompare(b.project_name);
    });

    return sorted.filter((project) => {
      // Filter by manager
      if (filterManager) {
        const managers = managerLookup.get(project.id) ?? [];
        if (!managers.includes(filterManager)) return false;
      }

      // Filter by company
      if (filterCompany) {
        const companyName = project.company_display_name || 'Unassigned';
        if (companyName !== filterCompany) return false;
      }

      // Filter by report status
      if (filterReport === 'yes' && !project.send_weekly_report) return false;
      if (filterReport === 'no' && project.send_weekly_report) return false;

      return true;
    });
  }, [projects, managerLookup, filterManager, filterCompany, filterReport]);

  const hasActiveFilters = filterManager || filterCompany || filterReport;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Project Management</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage project information and associations
          </p>
        </div>
      </div>

      {/* Export Button */}
      <RangeSelector
        variant="exportOnly"
        onExport={handleExportCSV}
        exportDisabled={isLoading || projects.length === 0}
      />

      {/* Filters */}
      {!isLoading && projects.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">Filters</span>
          <Select
            value={filterManager}
            onChange={setFilterManager}
            options={managerOptions}
            placeholder="All Managers"
            className="w-48"
          />
          <Select
            value={filterCompany}
            onChange={setFilterCompany}
            options={companyOptions}
            placeholder="All Companies"
            className="w-48"
          />
          <Select
            value={filterReport}
            onChange={setFilterReport}
            options={reportOptions}
            placeholder="All"
            className="w-32"
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => { setFilterManager(''); setFilterCompany(''); setFilterReport(''); }}
              className="text-xs text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors"
            >
              Clear filters
            </button>
          )}
          <span className="text-xs text-vercel-gray-300 ml-auto">
            {filteredProjects.length} of {projects.length} projects
          </span>
        </div>
      )}

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
        <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-vercel-gray-50">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-left w-28">
                  System ID
                </th>
                <th className="px-4 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-left">
                  Project
                </th>
                <th className="px-4 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-left">
                  Manager
                </th>
                <th className="px-4 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-left">
                  Company
                </th>
                <th className="px-4 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-left w-24">
                  Report
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vercel-gray-100">
              {filteredProjects.map((project) => {
                const idCount = getIdCount(project);
                const menuItems = [
                  {
                    label: 'Edit',
                    onClick: () => handleEditClick(project),
                    icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    ),
                  },
                ];

                return (
                  <tr
                    key={project.id}
                    className="hover:bg-vercel-gray-50 transition-colors"
                  >
                    {/* System ID column */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-vercel-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span className="text-sm text-vercel-gray-400 font-mono">
                          {idCount} {idCount === 1 ? 'ID' : 'IDs'}
                        </span>
                      </div>
                    </td>
                    {/* Project column */}
                    <td className="px-4 py-3 text-sm text-vercel-gray-600">
                      {project.project_name}
                    </td>
                    {/* Manager column */}
                    <td className="px-4 py-3 text-sm text-vercel-gray-300">
                      {(() => {
                        const managers = managerLookup.get(project.id) ?? [];
                        if (managers.length === 0) return null;
                        if (managers.length === 1) return managers[0];
                        return (
                          <Tooltip content={managers.join(', ')} position="bottom">
                            <span>
                              {managers[0]} <span className="text-vercel-gray-400">+{managers.length - 1}</span>
                            </span>
                          </Tooltip>
                        );
                      })()}
                    </td>
                    {/* Company column */}
                    <td className="px-4 py-3 text-sm text-vercel-gray-400">
                      {project.company_display_name || (
                        <span className="italic">Unassigned</span>
                      )}
                    </td>
                    {/* Report column with 3-dot menu */}
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className={project.send_weekly_report ? 'text-vercel-gray-600' : 'text-vercel-gray-300'}>
                          {project.send_weekly_report ? 'Yes' : 'No'}
                        </span>
                        <div className="flex-shrink-0">
                          <DropdownMenu items={menuItems} />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredProjects.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-vercel-gray-300">
                    {hasActiveFilters ? 'No projects match the selected filters' : 'No projects found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor Modal */}
      <ProjectEditorModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        project={selectedProject}
        onGroupChange={handleGroupChange}
      />
    </div>
  );
}
