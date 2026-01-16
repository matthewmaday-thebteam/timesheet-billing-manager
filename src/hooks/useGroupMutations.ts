import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { GroupMutationResult, StagedMemberAdd } from '../types';

interface SaveChangesParams {
  /** The primary entity ID */
  primaryResourceId: string;
  /** Whether this entity already has a group */
  hasExistingGroup: boolean;
  /** Entities to add as members */
  additions: StagedMemberAdd[];
  /** Member entity IDs to remove */
  removals: string[];
}

interface SaveChangesResult {
  success: boolean;
  groupDissolved: boolean;
  error?: string;
}

interface UseGroupMutationsResult {
  /**
   * Persist staged changes atomically.
   * Returns success status and whether the group was dissolved.
   */
  saveChanges: (params: SaveChangesParams) => Promise<SaveChangesResult>;
  /** Whether a mutation is in progress */
  isSaving: boolean;
  /** Error from last save attempt */
  saveError: string | null;
  /** Clear the save error */
  clearError: () => void;
}

/**
 * Hook for managing physical person group mutations.
 * Handles creating groups, adding members, and removing members.
 */
export function useGroupMutations(): UseGroupMutationsResult {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveChanges = useCallback(async (params: SaveChangesParams): Promise<SaveChangesResult> => {
    const { primaryResourceId, hasExistingGroup, additions, removals } = params;

    setIsSaving(true);
    setSaveError(null);

    let groupDissolved = false;

    try {
      // Process removals first (order matters for group dissolution)
      // This ensures we handle the case where all members are removed
      for (const memberResourceId of removals) {
        const { data, error } = await supabase.rpc('rpc_group_remove_member', {
          p_primary_resource_id: primaryResourceId,
          p_member_resource_id: memberResourceId,
        });

        if (error) {
          throw new Error(`Failed to remove member: ${error.message}`);
        }

        const result = data as GroupMutationResult;
        if (result.group_dissolved) {
          groupDissolved = true;
        }
      }

      // Process additions
      // If group was dissolved and we have additions, we need to create a new group
      for (let i = 0; i < additions.length; i++) {
        const addition = additions[i];
        const isFirstAddition = i === 0;
        const needsGroupCreation = !hasExistingGroup || groupDissolved;

        if (needsGroupCreation && isFirstAddition) {
          // Create group and add first member
          const { error } = await supabase.rpc('rpc_group_create_and_add_member', {
            p_primary_resource_id: primaryResourceId,
            p_member_resource_id: addition.resource_id,
          });

          if (error) {
            throw new Error(`Failed to create group: ${error.message}`);
          }

          // Group now exists, subsequent additions use add_member
          groupDissolved = false;
        } else {
          // Add to existing group
          const { error } = await supabase.rpc('rpc_group_add_member', {
            p_primary_resource_id: primaryResourceId,
            p_member_resource_id: addition.resource_id,
          });

          if (error) {
            throw new Error(`Failed to add member: ${error.message}`);
          }
        }
      }

      return {
        success: true,
        groupDissolved: groupDissolved && additions.length === 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes';
      setSaveError(message);
      return {
        success: false,
        groupDissolved: false,
        error: message,
      };
    } finally {
      setIsSaving(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setSaveError(null);
  }, []);

  return {
    saveChanges,
    isSaving,
    saveError,
    clearError,
  };
}
