import { useState, useEffect, useMemo } from 'react';
import { Button } from './Button';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import { useUnassociatedEntities } from '../hooks/usePhysicalPersonGroup';
import type {
  GroupMemberDisplay,
  StagedGroupChanges,
  StagedMemberAdd,
} from '../types';

interface PhysicalPersonGroupSectionProps {
  /** The resource ID being edited (the potential/actual primary) */
  resourceId: string;
  /** Currently persisted member entities (from server) */
  persistedMembers: GroupMemberDisplay[];
  /** Staged changes (local state managed by parent) */
  stagedChanges: StagedGroupChanges;
  /** Callback when staged changes update */
  onStagedChangesUpdate: (changes: StagedGroupChanges) => void;
  /** Whether the section is disabled (during save) */
  disabled?: boolean;
}

type MemberStatus = 'persisted' | 'pending_addition' | 'pending_removal';

interface DisplayMember {
  resource_id: string;
  display_name: string;
  external_label: string;
  user_id: string | null;
  status: MemberStatus;
}

/**
 * PhysicalPersonGroupSection - Manages physical person entity grouping
 *
 * This component allows admins to associate multiple employee entities
 * (from different time tracking systems) that represent the same physical person.
 *
 * Features:
 * - Displays current group members
 * - Add new members from unassociated entities dropdown
 * - Remove members from group
 * - Staging behavior: changes are not persisted until parent saves
 */
export function PhysicalPersonGroupSection({
  resourceId,
  persistedMembers,
  stagedChanges,
  onStagedChangesUpdate,
  disabled = false,
}: PhysicalPersonGroupSectionProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');

  const {
    entities: unassociatedEntities,
    loading: loadingEntities,
    fetch: fetchUnassociatedEntities,
  } = useUnassociatedEntities();

  // Fetch unassociated entities when adding mode is opened
  useEffect(() => {
    if (isAddingNew) {
      fetchUnassociatedEntities(resourceId);
    }
  }, [isAddingNew, fetchUnassociatedEntities, resourceId]);

  // Compute display list with statuses
  const displayMembers = useMemo((): DisplayMember[] => {
    const members: DisplayMember[] = [];

    // Add persisted members
    for (const m of persistedMembers) {
      const isPendingRemoval = stagedChanges.removals.has(m.member_resource_id);
      members.push({
        resource_id: m.member_resource_id,
        display_name: m.display_name,
        external_label: m.external_label,
        user_id: m.user_id,
        status: isPendingRemoval ? 'pending_removal' : 'persisted',
      });
    }

    // Add staged additions
    for (const add of stagedChanges.additions) {
      members.push({
        resource_id: add.resource_id,
        display_name: add.display_name,
        external_label: add.external_label,
        user_id: add.user_id,
        status: 'pending_addition',
      });
    }

    return members;
  }, [persistedMembers, stagedChanges]);

  // Filter dropdown options:
  // - Exclude the primary entity
  // - Exclude already persisted members
  // - Exclude staged additions
  const dropdownOptions = useMemo(() => {
    const excludeIds = new Set<string>();
    excludeIds.add(resourceId); // Exclude primary

    // Exclude persisted members (that aren't pending removal)
    for (const m of persistedMembers) {
      if (!stagedChanges.removals.has(m.member_resource_id)) {
        excludeIds.add(m.member_resource_id);
      }
    }

    // Exclude staged additions
    for (const add of stagedChanges.additions) {
      excludeIds.add(add.resource_id);
    }

    return unassociatedEntities
      .filter(e => !excludeIds.has(e.resource_id))
      .map(e => ({
        value: e.resource_id,
        label: e.display_name || e.external_label,
      }));
  }, [unassociatedEntities, resourceId, persistedMembers, stagedChanges]);

  // Handle adding a member (staging, not persisting)
  const handleAddMember = () => {
    if (!selectedResourceId) return;

    const entity = unassociatedEntities.find(e => e.resource_id === selectedResourceId);
    if (!entity) return;

    const newAddition: StagedMemberAdd = {
      resource_id: entity.resource_id,
      display_name: entity.display_name || entity.external_label,
      external_label: entity.external_label,
      user_id: entity.user_id,
    };

    onStagedChangesUpdate({
      ...stagedChanges,
      additions: [...stagedChanges.additions, newAddition],
    });

    setSelectedResourceId('');
    setIsAddingNew(false);
  };

  // Handle removing a member (staging, not persisting)
  const handleRemoveMember = (memberId: string) => {
    // Check if this is a staged addition or a persisted member
    const isStaged = stagedChanges.additions.some(a => a.resource_id === memberId);

    if (isStaged) {
      // Remove from staged additions
      onStagedChangesUpdate({
        ...stagedChanges,
        additions: stagedChanges.additions.filter(a => a.resource_id !== memberId),
      });
    } else {
      // Add to staged removals
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

  // Format resource ID for display
  const formatId = (id: string) => {
    return id.length > 12 ? `${id.substring(0, 12)}...` : id;
  };

  // Check if there are any pending changes
  const hasPendingChanges = stagedChanges.additions.length > 0 || stagedChanges.removals.size > 0;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        User Associations
        {hasPendingChanges && (
          <Badge variant="warning" size="sm">Pending</Badge>
        )}
      </label>

      {/* Current members list */}
      <div className="space-y-2">
        {displayMembers.length === 0 ? (
          <div className="text-sm text-vercel-gray-300 italic py-2">
            No associated users
          </div>
        ) : (
          displayMembers.map((member) => (
            <div
              key={member.resource_id}
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
                  {member.display_name}
                </span>
                {member.user_id && member.user_id !== member.external_label && (
                  <span className="text-xs text-vercel-gray-300 font-mono flex-shrink-0">
                    ({formatId(member.user_id)})
                  </span>
                )}
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
                    onClick={() => handleUndoRemoval(member.resource_id)}
                    disabled={disabled}
                    className="text-xs text-info hover:text-info-text transition-colors disabled:opacity-50"
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member.resource_id)}
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
              Select Employee
            </label>
            {loadingEntities ? (
              <div className="flex items-center justify-center py-2">
                <Spinner size="sm" />
              </div>
            ) : (
              <Select
                value={selectedResourceId}
                onChange={(value) => setSelectedResourceId(value)}
                options={dropdownOptions}
                placeholder={dropdownOptions.length === 0 ? 'No employees available' : 'Select employee...'}
                className="w-full"
                disabled={dropdownOptions.length === 0}
              />
            )}
            {dropdownOptions.length === 0 && !loadingEntities && (
              <p className="mt-1 text-xs text-vercel-gray-300">
                All employees are already associated with groups.
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
              onClick={handleAddMember}
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
          Add User Association
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
