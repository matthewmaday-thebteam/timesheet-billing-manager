import { useState } from 'react';
import { useResources } from '../../hooks/useResources';
import { useEmploymentTypes } from '../../hooks/useEmploymentTypes';
import { ResourceTable } from '../ResourceTable';
import { EmployeeEditorDrawer } from '../EmployeeEditorDrawer';
import type { Resource } from '../../types';

export function EmployeesPage() {
  const { resources, loading, error, updateResource, isUpdating } = useResources();
  const { employmentTypes } = useEmploymentTypes();
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleRowClick = (resource: Resource) => {
    setSelectedResource(resource);
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedResource(null);
  };

  const incompleteCount = resources.filter(r => !r.email || !r.first_name).length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#000000]">Employees</h1>
          <p className="text-sm text-[#666666] mt-1">
            Manage employee information and enrichment data
          </p>
        </div>
        {incompleteCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FFF7ED] border border-[#FFEDD5] rounded-md">
            <svg className="w-4 h-4 text-[#C2410C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium text-[#C2410C]">
              {incompleteCount} incomplete {incompleteCount === 1 ? 'record' : 'records'}
            </span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
          <p className="text-[12px] text-[#666666] mb-1">Total Employees</p>
          <p className="text-2xl font-semibold text-[#000000]">{resources.length}</p>
        </div>
        <div className="p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
          <p className="text-[12px] text-[#666666] mb-1">Full-time</p>
          <p className="text-2xl font-semibold text-[#000000]">
            {resources.filter(r => r.employment_type?.name === 'Full-time').length}
          </p>
        </div>
        <div className="p-4 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
          <p className="text-[12px] text-[#666666] mb-1">Part-time</p>
          <p className="text-2xl font-semibold text-[#000000]">
            {resources.filter(r => r.employment_type?.name === 'Part-time').length}
          </p>
        </div>
        <div className={`p-4 rounded-lg border ${
          incompleteCount > 0
            ? 'bg-[#FFF7ED] border-[#FFEDD5]'
            : 'bg-[#FFFFFF] border-[#EAEAEA]'
        }`}>
          <p className="text-[12px] text-[#666666] mb-1">Incomplete Records</p>
          <p className={`text-2xl font-semibold ${
            incompleteCount > 0 ? 'text-[#C2410C]' : 'text-[#000000]'
          }`}>
            {incompleteCount}
          </p>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-[#DC2626]">{error}</span>
          </div>
        </div>
      )}

      {/* Resource Table */}
      <ResourceTable
        resources={resources}
        loading={loading}
        onRowClick={handleRowClick}
      />

      {/* Employee Editor Drawer */}
      <EmployeeEditorDrawer
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
        resource={selectedResource}
        onSave={updateResource}
        isSaving={isUpdating}
        employmentTypes={employmentTypes}
      />
    </div>
  );
}
