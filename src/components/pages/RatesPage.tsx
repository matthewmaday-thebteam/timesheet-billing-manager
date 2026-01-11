import { useState } from 'react';
import { useProjects } from '../../hooks/useProjects';
import { ProjectEditorModal } from '../ProjectEditorModal';
import { DropdownMenu } from '../DropdownMenu';
import { Spinner } from '../Spinner';
import type { Project } from '../../types';

export function RatesPage() {
  const {
    projects,
    loading,
    error,
    isOperating,
    updateProject,
  } = useProjects();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const handleEditClick = (project: Project) => {
    setSelectedProject(project);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedProject(null);
  };

  const getMenuItems = (project: Project) => [
    {
      label: 'Edit Rate',
      onClick: () => handleEditClick(project),
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
    },
  ];

  // Calculate stats
  const projectsWithRate = projects.filter(p => p.rate !== null).length;
  const projectsWithoutRate = projects.filter(p => p.rate === null).length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Project Rates</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage hourly billing rates for revenue calculations
          </p>
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Total Projects</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">{projects.length}</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">With Custom Rate</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">{projectsWithRate}</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Using Default ($45)</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">{projectsWithoutRate}</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Default Rate</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">$45.00</p>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-flex items-center gap-2 text-vercel-gray-400">
              <Spinner size="md" />
              <span className="text-sm">Loading projects...</span>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="p-8 text-center">
            <svg className="mx-auto h-12 w-12 text-vercel-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="mt-4 text-sm text-vercel-gray-400">No projects found</p>
            <p className="mt-1 text-xs text-vercel-gray-300">Projects are automatically created when timesheet data is synced</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-vercel-gray-50 border-b border-vercel-gray-100">
                  <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                    Project Name
                  </th>
                  <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                    Project ID
                  </th>
                  <th className="px-4 py-3 text-right text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                    Hourly Rate
                  </th>
                  <th className="px-4 py-3 text-right text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vercel-gray-100">
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="hover:bg-vercel-gray-50 transition-colors duration-200 ease-out"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-vercel-gray-600">{project.project_name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-vercel-gray-400 font-mono">{project.project_id}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {project.rate !== null ? (
                        <span className="text-sm font-medium text-vercel-gray-600">
                          ${project.rate.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-sm text-vercel-gray-300">
                          $45.00 <span className="text-2xs">(default)</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end">
                        <DropdownMenu items={getMenuItems(project)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor Modal */}
      <ProjectEditorModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        project={selectedProject}
        onSave={updateProject}
        isSaving={isOperating}
      />
    </div>
  );
}
