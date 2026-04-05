import { useState, useEffect } from 'react';
import { Button } from './Button';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { useUserAssociations } from '../hooks/useUserAssociations';
import type { ResourceUserAssociation } from '../types';

interface UserAssociationsSectionProps {
  resourceId: string;
  resourceUserId: string | null;
  externalLabel: string;
  associations: ResourceUserAssociation[];
  onAssociationsChange: (associations: ResourceUserAssociation[]) => void;
  disabled?: boolean;
}

/**
 * UserAssociationsSection - Manages multiple time tracking system IDs for an employee
 *
 * Features:
 * - Displays current associations
 * - Add new associations from unassociated users dropdown
 * - Remove associations
 */
export function UserAssociationsSection({
  resourceId,
  resourceUserId,
  externalLabel,
  associations,
  onAssociationsChange,
  disabled = false,
}: UserAssociationsSectionProps) {
  // Filter out the self-association (where user_id matches the resource's user_id OR external_label)
  const additionalAssociations = associations.filter(
    a => a.user_id !== resourceUserId && a.user_id !== externalLabel
  );
  const {
    unassociatedUsers,
    loading,
    fetchUnassociatedUsers,
    addAssociation,
    removeAssociation,
    isUpdating,
  } = useUserAssociations();

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  // Fetch unassociated users when adding mode is opened
  useEffect(() => {
    if (isAddingNew) {
      fetchUnassociatedUsers({
        currentResourceId: resourceId,
        currentResourceUserId: resourceUserId,
        currentExternalLabel: externalLabel,
      });
    }
  }, [isAddingNew, fetchUnassociatedUsers, resourceId, resourceUserId, externalLabel]);

  // Get user options for dropdown - all unassociated users
  const userOptions = unassociatedUsers.map(u => ({
    value: u.user_id,
    label: u.user_name
      ? `${u.user_name} (${u.user_id.substring(0, 8)}...)`
      : u.user_id,
  }));

  // Handle adding a new association
  const handleAddAssociation = async () => {
    if (!selectedUserId) return;

    const user = unassociatedUsers.find(u => u.user_id === selectedUserId);
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

  // Format user ID for display
  const formatUserId = (userId: string) => {
    return userId.length > 12 ? `${userId.substring(0, 12)}...` : userId;
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        User Associations
      </label>

      {/* Current associations list (excluding self-association) */}
      <div className="space-y-2">
        {additionalAssociations.length === 0 ? (
          <div className="text-sm text-vercel-gray-300 italic py-2">
            No additional user associations
          </div>
        ) : (
          additionalAssociations.map((assoc) => (
            <div
              key={assoc.id}
              className="flex items-center justify-between px-3 py-2 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-vercel-gray-600">
                  {assoc.user_name || formatUserId(assoc.user_id)}
                </span>
                {assoc.user_name && (
                  <span className="text-xs text-vercel-gray-300 font-mono">
                    ({formatUserId(assoc.user_id)})
                  </span>
                )}
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
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 mb-1">
              Select User
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
                placeholder={unassociatedUsers.length === 0 ? 'No users available' : 'Select user...'}
                className="w-full"
                disabled={unassociatedUsers.length === 0}
              />
            )}
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
