import { useState, useEffect, useMemo } from 'react';
import { Button } from './Button';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import type {
  Resource,
  ProjectManagerDisplay,
  StagedProjectManagerChanges,
  StagedProjectManagerAdd,
} from '../types';

interface ProjectManagerSectionProps {
  /** Currently persisted managers (from server) */
  persistedManagers: ProjectManagerDisplay[];
  /** All resources for the dropdown */
  allResources: Resource[];
  /** Whether resources are still loading */
  resourcesLoading: boolean;
  /** Staged changes (local state managed by parent) */
  stagedChanges: StagedProjectManagerChanges;
  /** Callback when staged changes update */
  onStagedChangesUpdate: (changes: StagedProjectManagerChanges) => void;
  /** Whether the section is disabled (during save) */
  disabled?: boolean;
}

type ManagerStatus = 'persisted' | 'pending_addition' | 'pending_removal';

interface DisplayManager {
  resource_id: string;
  display_name: string;
  external_label: string;
  status: ManagerStatus;
}

function getResourceDisplayName(r: Resource): string {
  const firstName = r.first_name || '';
  const lastName = r.last_name || '';
  return (firstName || lastName)
    ? `${firstName} ${lastName}`.trim()
    : r.external_label || 'Unknown';
}

/**
 * ProjectManagerSection - Manages project manager assignments
 *
 * Follows the same staged-changes pattern as ProjectGroupSection.
 * Allows admins to assign resources as project managers.
 */
export function ProjectManagerSection({
  persistedManagers,
  allResources,
  resourcesLoading,
  stagedChanges,
  onStagedChangesUpdate,
  disabled = false,
}: ProjectManagerSectionProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');

  // Reset adding state when disabled changes (e.g. after save)
  useEffect(() => {
    if (disabled) {
      setIsAddingNew(false);
      setSelectedResourceId('');
    }
  }, [disabled]);

  // Compute display list with statuses
  const displayManagers = useMemo((): DisplayManager[] => {
    const managers: DisplayManager[] = [];

    // Add persisted managers
    for (const m of persistedManagers) {
      const isPendingRemoval = stagedChanges.removals.has(m.resource_id);
      managers.push({
        resource_id: m.resource_id,
        display_name: m.display_name,
        external_label: m.external_label,
        status: isPendingRemoval ? 'pending_removal' : 'persisted',
      });
    }

    // Add staged additions
    for (const add of stagedChanges.additions) {
      managers.push({
        resource_id: add.resource_id,
        display_name: add.display_name,
        external_label: add.external_label,
        status: 'pending_addition',
      });
    }

    return managers;
  }, [persistedManagers, stagedChanges]);

  // Filter dropdown to exclude already-assigned resources
  const dropdownOptions = useMemo(() => {
    const excludeIds = new Set<string>();

    // Exclude persisted managers (that aren't pending removal)
    for (const m of persistedManagers) {
      if (!stagedChanges.removals.has(m.resource_id)) {
        excludeIds.add(m.resource_id);
      }
    }

    // Exclude staged additions
    for (const add of stagedChanges.additions) {
      excludeIds.add(add.resource_id);
    }

    return allResources
      .filter(r => !excludeIds.has(r.id))
      .map(r => ({
        value: r.id,
        label: getResourceDisplayName(r),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allResources, persistedManagers, stagedChanges]);

  // Handle staging an addition
  const handleAddManager = () => {
    if (!selectedResourceId) return;

    const resource = allResources.find(r => r.id === selectedResourceId);
    if (!resource) return;

    const newAddition: StagedProjectManagerAdd = {
      resource_id: resource.id,
      display_name: getResourceDisplayName(resource),
      external_label: resource.external_label || '',
    };

    onStagedChangesUpdate({
      ...stagedChanges,
      additions: [...stagedChanges.additions, newAddition],
    });

    setSelectedResourceId('');
    setIsAddingNew(false);
  };

  // Handle staging a removal
  const handleRemoveManager = (resourceId: string) => {
    const isStaged = stagedChanges.additions.some(a => a.resource_id === resourceId);

    if (isStaged) {
      // Remove from staged additions
      onStagedChangesUpdate({
        ...stagedChanges,
        additions: stagedChanges.additions.filter(a => a.resource_id !== resourceId),
      });
    } else {
      // Add to staged removals
      const newRemovals = new Set(stagedChanges.removals);
      newRemovals.add(resourceId);
      onStagedChangesUpdate({
        ...stagedChanges,
        removals: newRemovals,
      });
    }
  };

  // Handle undo removal
  const handleUndoRemoval = (resourceId: string) => {
    const newRemovals = new Set(stagedChanges.removals);
    newRemovals.delete(resourceId);
    onStagedChangesUpdate({
      ...stagedChanges,
      removals: newRemovals,
    });
  };

  const hasPendingChanges = stagedChanges.additions.length > 0 || stagedChanges.removals.size > 0;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        Project Managers
        {hasPendingChanges && (
          <Badge variant="warning" size="sm">Pending</Badge>
        )}
      </label>

      {/* Current managers list */}
      <div className="space-y-2">
        {displayManagers.length === 0 ? (
          <div className="text-sm text-vercel-gray-300 italic py-2">
            No project managers assigned
          </div>
        ) : (
          displayManagers.map((manager) => (
            <div
              key={manager.resource_id}
              className={`flex items-center justify-between px-3 py-2 border rounded-md transition-colors ${
                manager.status === 'pending_removal'
                  ? 'bg-error-light border-error-border opacity-60'
                  : manager.status === 'pending_addition'
                  ? 'bg-success-light border-success-border'
                  : 'bg-vercel-gray-50 border-vercel-gray-100'
              }`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={`text-sm truncate ${
                  manager.status === 'pending_removal'
                    ? 'text-vercel-gray-300 line-through'
                    : 'text-vercel-gray-600'
                }`}>
                  {manager.display_name}
                </span>
                {manager.status === 'pending_addition' && (
                  <Badge variant="success" size="sm">New</Badge>
                )}
                {manager.status === 'pending_removal' && (
                  <Badge variant="error" size="sm">Removing</Badge>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {manager.status === 'pending_removal' ? (
                  <button
                    type="button"
                    onClick={() => handleUndoRemoval(manager.resource_id)}
                    disabled={disabled}
                    className="text-xs text-info hover:text-info-text transition-colors disabled:opacity-50"
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRemoveManager(manager.resource_id)}
                    disabled={disabled}
                    className="text-vercel-gray-300 hover:text-bteam-brand transition-colors disabled:opacity-50"
                    title="Remove manager"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add new manager UI */}
      {isAddingNew ? (
        <div className="space-y-3 p-3 border border-vercel-gray-100 rounded-md bg-white">
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 mb-1">
              Select Resource
            </label>
            {resourcesLoading ? (
              <div className="flex items-center justify-center py-2">
                <Spinner size="sm" />
              </div>
            ) : (
              <Select
                value={selectedResourceId}
                onChange={(value) => setSelectedResourceId(value)}
                options={dropdownOptions}
                placeholder={dropdownOptions.length === 0 ? 'No resources available' : 'Select resource...'}
                className="w-full"
                disabled={dropdownOptions.length === 0}
              />
            )}
            {dropdownOptions.length === 0 && !resourcesLoading && (
              <p className="mt-1 text-xs text-vercel-gray-300">
                All resources are already assigned as managers.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setIsAddingNew(false);
                setSelectedResourceId('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAddManager}
              disabled={!selectedResourceId}
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIsAddingNew(true)}
          disabled={disabled}
          className="w-full"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Project Manager
        </Button>
      )}

      {/* Info about staging behavior */}
      {hasPendingChanges && (
        <p className="text-xs text-vercel-gray-300 italic">
          Changes will be saved when you click "Save Changes"
        </p>
      )}
    </div>
  );
}
