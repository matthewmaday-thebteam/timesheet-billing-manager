import { useState, useCallback, useMemo } from 'react';
import { useEmployeeTableEntities } from '../../hooks/useEmployeeTableEntities';
import { useEmploymentTypes } from '../../hooks/useEmploymentTypes';
import { ResourceTable } from '../ResourceTable';
import { EmployeeEditorModal } from '../EmployeeEditorModal';
import { MetricCard } from '../MetricCard';
import { BambooEmployeePanel } from '../BambooEmployeePanel';
import type { Resource, ResourceWithGrouping } from '../../types';

export function EmployeeManagementPage() {
  // Use the new hook that filters out member entities and includes grouping info
  const { entities, loading, error, updateResource, isUpdating, refetch } = useEmployeeTableEntities();

  // Sort entities alphabetically by last name
  const sortedEntities = useMemo(() => {
    return [...entities].sort((a, b) => {
      const lastNameA = a.last_name || '';
      const lastNameB = b.last_name || '';
      return lastNameA.localeCompare(lastNameB);
    });
  }, [entities]);
  const { employmentTypes } = useEmploymentTypes();
  const [selectedResource, setSelectedResource] = useState<Resource | ResourceWithGrouping | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saveCount, setSaveCount] = useState(0);

  const handleRowClick = (resource: Resource | ResourceWithGrouping) => {
    setSelectedResource(resource);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedResource(null);
  };

  const handleSaveResource = async (id: string, data: import('../../types').ResourceFormData) => {
    const success = await updateResource(id, data, employmentTypes);
    if (success) setSaveCount(c => c + 1);
    return success;
  };

  // Callback when group changes are saved - refetch the entity list
  const handleGroupChange = useCallback(() => {
    refetch();
  }, [refetch]);

  const incompleteCount = sortedEntities.filter(r => !r.email || !r.first_name).length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Employee Management</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage employee information
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard title="Total" value={sortedEntities.length} />
        <MetricCard
          title="Full-time"
          value={sortedEntities.filter(r => r.employment_type?.name === 'Full-time').length}
        />
        <MetricCard
          title="Part-time"
          value={sortedEntities.filter(r => r.employment_type?.name === 'Part-time').length}
        />
        <MetricCard
          title="Contractor"
          value={sortedEntities.filter(r => r.employment_type?.name === 'Contractor').length}
        />
        <MetricCard
          title="Vendor"
          value={sortedEntities.filter(r => r.employment_type?.name === 'Vendor').length}
        />
        <MetricCard
          title="Incomplete"
          value={incompleteCount}
          isAlert={incompleteCount > 0}
        />
      </div>

      {/* BambooHR Employees */}
      <BambooEmployeePanel key={saveCount} />

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
        resources={sortedEntities}
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
        onGroupChange={handleGroupChange}
      />
    </div>
  );
}
