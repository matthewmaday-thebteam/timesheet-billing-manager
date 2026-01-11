import { useState } from 'react';
import { useResources } from '../../hooks/useResources';
import { useEmploymentTypes } from '../../hooks/useEmploymentTypes';
import { ResourceTable } from '../ResourceTable';
import { EmployeeEditorModal } from '../EmployeeEditorModal';
import type { Resource } from '../../types';

export function EmployeesPage() {
  const { resources, loading, error, updateResource, isUpdating } = useResources();
  const { employmentTypes } = useEmploymentTypes();
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleRowClick = (resource: Resource) => {
    setSelectedResource(resource);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedResource(null);
  };

  const handleSaveResource = async (id: string, data: import('../../types').ResourceFormData) => {
    return updateResource(id, data, employmentTypes);
  };

  const incompleteCount = resources.filter(r => !r.email || !r.first_name).length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Employees</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage employee information and enrichment data
          </p>
        </div>
        {incompleteCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-warning-light border border-warning rounded-md">
            <svg className="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium text-warning">
              {incompleteCount} incomplete {incompleteCount === 1 ? 'record' : 'records'}
            </span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Total</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">{resources.length}</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Full-time</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">
            {resources.filter(r => r.employment_type?.name === 'Full-time').length}
          </p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Part-time</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">
            {resources.filter(r => r.employment_type?.name === 'Part-time').length}
          </p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Contractor</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">
            {resources.filter(r => r.employment_type?.name === 'Contractor').length}
          </p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Vendor</p>
          <p className="text-2xl font-semibold text-vercel-gray-600">
            {resources.filter(r => r.employment_type?.name === 'Vendor').length}
          </p>
        </div>
        <div className={`p-4 rounded-lg border ${
          incompleteCount > 0
            ? 'bg-warning-light border-warning'
            : 'bg-white border-vercel-gray-100'
        }`}>
          <p className="text-xs text-vercel-gray-400 mb-1">Incomplete</p>
          <p className={`text-2xl font-semibold ${
            incompleteCount > 0 ? 'text-warning' : 'text-vercel-gray-600'
          }`}>
            {incompleteCount}
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

      {/* Resource Table */}
      <ResourceTable
        resources={resources}
        loading={loading}
        onRowClick={handleRowClick}
      />

      {/* Employee Editor Modal */}
      <EmployeeEditorModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        resource={selectedResource}
        onSave={handleSaveResource}
        isSaving={isUpdating}
        employmentTypes={employmentTypes}
      />
    </div>
  );
}
