import { useState, useEffect, useMemo } from 'react';
import { Button } from './Button';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import { useUnassociatedProjects } from '../hooks/useProjectGroup';
import type {
  ProjectGroupMemberDisplay,
  StagedProjectGroupChanges,
  StagedProjectMemberAdd,
} from '../types';

interface ProjectGroupSectionProps {
  /** The project ID being edited (the potential/actual primary) */
  projectId: string;
  /** Currently persisted member projects (from server) */
  persistedMembers: ProjectGroupMemberDisplay[];
  /** Staged changes (local state managed by parent) */
  stagedChanges: StagedProjectGroupChanges;
  /** Callback when staged changes update */
  onStagedChangesUpdate: (changes: StagedProjectGroupChanges) => void;
  /** Whether the section is disabled (during save) */
  disabled?: boolean;
}

type MemberStatus = 'persisted' | 'pending_addition' | 'pending_removal';

interface DisplayMember {
  id: string;
  project_id: string;
  project_name: string;
  status: MemberStatus;
}

/**
 * ProjectGroupSection - Manages project entity grouping
 *
 * This component allows admins to associate multiple project entities
 * (from different time tracking systems) that represent the same real-world project.
 */
export function ProjectGroupSection({
  projectId,
  persistedMembers,
  stagedChanges,
  onStagedChangesUpdate,
  disabled = false,
}: ProjectGroupSectionProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const {
    projects: unassociatedProjects,
    loading: loadingProjects,
    fetch: fetchUnassociatedProjects,
  } = useUnassociatedProjects();

  // Fetch unassociated projects when adding mode is opened
  useEffect(() => {
    if (isAddingNew) {
      fetchUnassociatedProjects(projectId);
    }
  }, [isAddingNew, fetchUnassociatedProjects, projectId]);

  // Compute display list with statuses
  const displayMembers = useMemo((): DisplayMember[] => {
    const members: DisplayMember[] = [];

    // Add persisted members
    for (const m of persistedMembers) {
      const isPendingRemoval = stagedChanges.removals.has(m.member_project_id);
      members.push({
        id: m.member_project_id,
        project_id: m.project_id,
        project_name: m.project_name,
        status: isPendingRemoval ? 'pending_removal' : 'persisted',
      });
    }

    // Add staged additions
    for (const add of stagedChanges.additions) {
      members.push({
        id: add.id,
        project_id: add.project_id,
        project_name: add.project_name,
        status: 'pending_addition',
      });
    }

    return members;
  }, [persistedMembers, stagedChanges]);

  // Filter dropdown options
  const dropdownOptions = useMemo(() => {
    const excludeIds = new Set<string>();
    excludeIds.add(projectId); // Exclude primary

    // Exclude persisted members (that aren't pending removal)
    for (const m of persistedMembers) {
      if (!stagedChanges.removals.has(m.member_project_id)) {
        excludeIds.add(m.member_project_id);
      }
    }

    // Exclude staged additions
    for (const add of stagedChanges.additions) {
      excludeIds.add(add.id);
    }

    return unassociatedProjects
      .filter(p => !excludeIds.has(p.id))
      .map(p => ({
        value: p.id,
        label: p.project_name,
      }));
  }, [unassociatedProjects, projectId, persistedMembers, stagedChanges]);

  // Handle adding a member (staging, not persisting)
  const handleAddMember = () => {
    if (!selectedProjectId) return;

    const project = unassociatedProjects.find(p => p.id === selectedProjectId);
    if (!project) return;

    const newAddition: StagedProjectMemberAdd = {
      id: project.id,
      project_id: project.project_id,
      project_name: project.project_name,
    };

    onStagedChangesUpdate({
      ...stagedChanges,
      additions: [...stagedChanges.additions, newAddition],
    });

    setSelectedProjectId('');
    setIsAddingNew(false);
  };

  // Handle removing a member (staging, not persisting)
  const handleRemoveMember = (memberId: string) => {
    const isStaged = stagedChanges.additions.some(a => a.id === memberId);

    if (isStaged) {
      onStagedChangesUpdate({
        ...stagedChanges,
        additions: stagedChanges.additions.filter(a => a.id !== memberId),
      });
    } else {
      const newRemovals = new Set(stagedChanges.removals);
      newRemovals.add(memberId);
      onStagedChangesUpdate({
        ...stagedChanges,
        removals: newRemovals,
      });
    }
  };

  // Handle undoing a staged removal
  const handleUndoRemoval = (memberId: string) => {
    const newRemovals = new Set(stagedChanges.removals);
    newRemovals.delete(memberId);
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
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        Project Associations
        {hasPendingChanges && (
          <Badge variant="warning" size="sm">Pending</Badge>
        )}
      </label>

      {/* Current members list */}
      <div className="space-y-2">
        {displayMembers.length === 0 ? (
          <div className="text-sm text-vercel-gray-300 italic py-2">
            No associated projects
          </div>
        ) : (
          displayMembers.map((member) => (
            <div
              key={member.id}
              className={`flex items-center justify-between px-3 py-2 border rounded-md transition-colors ${
                member.status === 'pending_removal'
                  ? 'bg-error-light border-error-border opacity-60'
                  : member.status === 'pending_addition'
                  ? 'bg-success-light border-success-border'
                  : 'bg-vercel-gray-50 border-vercel-gray-100'
              }`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={`text-sm truncate ${
                  member.status === 'pending_removal'
                    ? 'text-vercel-gray-300 line-through'
                    : 'text-vercel-gray-600'
                }`}>
                  {member.project_name}
                </span>
                {member.status === 'pending_addition' && (
                  <Badge variant="success" size="sm">New</Badge>
                )}
                {member.status === 'pending_removal' && (
                  <Badge variant="error" size="sm">Removing</Badge>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {member.status === 'pending_removal' ? (
                  <button
                    type="button"
                    onClick={() => handleUndoRemoval(member.id)}
                    disabled={disabled}
                    className="text-xs text-info hover:text-info-text transition-colors disabled:opacity-50"
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member.id)}
                    disabled={disabled}
                    className="text-vercel-gray-300 hover:text-bteam-brand transition-colors disabled:opacity-50"
                    title="Remove from group"
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

      {/* Add new member UI */}
      {isAddingNew ? (
        <div className="space-y-3 p-3 border border-vercel-gray-100 rounded-md bg-white">
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 mb-1">
              Select Project
            </label>
            {loadingProjects ? (
              <div className="flex items-center justify-center py-2">
                <Spinner size="sm" />
              </div>
            ) : (
              <Select
                value={selectedProjectId}
                onChange={(value) => setSelectedProjectId(value)}
                options={dropdownOptions}
                placeholder={dropdownOptions.length === 0 ? 'No projects available' : 'Select project...'}
                className="w-full"
                disabled={dropdownOptions.length === 0}
              />
            )}
            {dropdownOptions.length === 0 && !loadingProjects && (
              <p className="mt-1 text-xs text-vercel-gray-300">
                All projects are already associated with groups.
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
                setSelectedProjectId('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAddMember}
              disabled={!selectedProjectId}
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
          Add Project Association
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
