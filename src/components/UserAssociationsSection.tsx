import { useState, useEffect } from 'react';
import { Button } from './Button';
import { Select } from './Select';
import { Badge } from './Badge';
import { Spinner } from './Spinner';
import { useUserAssociations } from '../hooks/useUserAssociations';
import type { ResourceUserAssociation, AssociationSource } from '../types';

interface UserAssociationsSectionProps {
  resourceId: string;
  associations: ResourceUserAssociation[];
  onAssociationsChange: (associations: ResourceUserAssociation[]) => void;
  disabled?: boolean;
}

interface PendingAssociation {
  user_id: string;
  source: AssociationSource;
  user_name: string;
}

interface PendingRemoval {
  id: string;
}

/**
 * UserAssociationsSection - Manages multiple time tracking system IDs for an employee
 *
 * Features:
 * - Displays current associations with source badges
 * - Add new associations from unassociated users dropdown
 * - Remove associations (mark for deletion)
 * - Changes are held locally until parent component saves
 */
export function UserAssociationsSection({
  resourceId,
  associations,
  onAssociationsChange,
  disabled = false,
}: UserAssociationsSectionProps) {
  const {
    unassociatedUsers,
    loading,
    fetchUnassociatedUsers,
    addAssociation,
    removeAssociation,
    isUpdating,
  } = useUserAssociations();

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedSource, setSelectedSource] = useState<AssociationSource>('clockify');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [pendingAdditions, setPendingAdditions] = useState<PendingAssociation[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);

  // Fetch unassociated users when adding mode is opened
  useEffect(() => {
    if (isAddingNew) {
      fetchUnassociatedUsers();
    }
  }, [isAddingNew, fetchUnassociatedUsers]);

  // Get badge variant based on source
  const getSourceBadgeVariant = (source: AssociationSource) => {
    return source === 'clockify' ? 'info' : 'success';
  };

  // Get display label for source
  const getSourceLabel = (source: AssociationSource) => {
    return source === 'clockify' ? 'Clockify' : 'ClickUp';
  };

  // Filter unassociated users by selected source
  const filteredUsers = unassociatedUsers.filter(u => u.source === selectedSource);

  // Get user options for dropdown
  const userOptions = filteredUsers.map(u => ({
    value: u.user_id,
    label: `${u.user_name} (${u.user_id.substring(0, 8)}...)`,
  }));

  // Handle adding a new association
  const handleAddAssociation = async () => {
    if (!selectedUserId) return;

    const user = filteredUsers.find(u => u.user_id === selectedUserId);
    if (!user) return;

    const result = await addAssociation(resourceId, user.user_id, user.source, user.user_name);
    if (result) {
      onAssociationsChange([...associations, result]);
      setSelectedUserId('');
      setIsAddingNew(false);
    }
  };

  // Handle removing an association
  const handleRemoveAssociation = async (associationId: string) => {
    const success = await removeAssociation(associationId);
    if (success) {
      onAssociationsChange(associations.filter(a => a.id !== associationId));
    }
  };

  // Get visible associations (excluding pending removals)
  const visibleAssociations = associations.filter(
    a => !pendingRemovals.some(pr => pr.id === a.id)
  );

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        User Associations
      </label>

      {/* Current associations list */}
      <div className="space-y-2">
        {visibleAssociations.length === 0 ? (
          <div className="text-sm text-vercel-gray-300 italic py-2">
            No user associations
          </div>
        ) : (
          visibleAssociations.map((assoc) => (
            <div
              key={assoc.id}
              className="flex items-center justify-between px-3 py-2 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md"
            >
              <div className="flex items-center gap-2">
                <Badge variant={getSourceBadgeVariant(assoc.source)} size="sm">
                  {getSourceLabel(assoc.source)}
                </Badge>
                <span className="text-sm text-vercel-gray-600">
                  {assoc.user_name || assoc.user_id}
                </span>
                <span className="text-xs text-vercel-gray-300 font-mono">
                  ({assoc.user_id.substring(0, 12)}...)
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveAssociation(assoc.id)}
                disabled={disabled || isUpdating}
                className="text-vercel-gray-300 hover:text-bteam-brand transition-colors disabled:opacity-50"
                title="Remove association"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add new association UI */}
      {isAddingNew ? (
        <div className="space-y-3 p-3 border border-vercel-gray-100 rounded-md bg-white">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-vercel-gray-400 mb-1">
                Source
              </label>
              <Select
                value={selectedSource}
                onChange={(value) => {
                  setSelectedSource(value as AssociationSource);
                  setSelectedUserId('');
                }}
                options={[
                  { value: 'clockify', label: 'Clockify' },
                  { value: 'clickup', label: 'ClickUp' },
                ]}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-vercel-gray-400 mb-1">
                User
              </label>
              {loading ? (
                <div className="flex items-center justify-center py-2">
                  <Spinner size="sm" />
                </div>
              ) : (
                <Select
                  value={selectedUserId}
                  onChange={(value) => setSelectedUserId(value)}
                  options={userOptions}
                  placeholder={filteredUsers.length === 0 ? 'No users available' : 'Select user...'}
                  className="w-full"
                  disabled={filteredUsers.length === 0}
                />
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setIsAddingNew(false);
                setSelectedUserId('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAddAssociation}
              disabled={!selectedUserId || isUpdating}
            >
              {isUpdating ? (
                <span className="flex items-center gap-1">
                  <Spinner size="sm" color="white" />
                  Adding...
                </span>
              ) : (
                'Add'
              )}
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
    </div>
  );
}
