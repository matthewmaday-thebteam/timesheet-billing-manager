import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ProjectGroupMutationResult, StagedProjectMemberAdd } from '../types';

interface SaveChangesParams {
  /** The primary project ID */
  primaryProjectId: string;
  /** Whether this project already has a group */
  hasExistingGroup: boolean;
  /** Projects to add as members */
  additions: StagedProjectMemberAdd[];
  /** Member project IDs to remove */
  removals: string[];
}

interface SaveChangesResult {
  success: boolean;
  groupDissolved: boolean;
  error?: string;
}

interface UseProjectGroupMutationsResult {
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
 * Hook for managing project group mutations.
 * Handles creating groups, adding members, and removing members.
 */
export function useProjectGroupMutations(): UseProjectGroupMutationsResult {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveChanges = useCallback(async (params: SaveChangesParams): Promise<SaveChangesResult> => {
    const { primaryProjectId, hasExistingGroup, additions, removals } = params;

    setIsSaving(true);
    setSaveError(null);

    let groupDissolved = false;

    try {
      // Process removals first (order matters for group dissolution)
      for (const memberProjectId of removals) {
        const { data, error } = await supabase.rpc('rpc_project_group_remove_member', {
          p_primary_project_id: primaryProjectId,
          p_member_project_id: memberProjectId,
        });

        if (error) {
          throw new Error(`Failed to remove member: ${error.message}`);
        }

        const result = data as ProjectGroupMutationResult;
        if (result.group_dissolved) {
          groupDissolved = true;
        }
      }

      // Process additions
      for (let i = 0; i < additions.length; i++) {
        const addition = additions[i];
        const isFirstAddition = i === 0;
        const needsGroupCreation = !hasExistingGroup || groupDissolved;

        if (needsGroupCreation && isFirstAddition) {
          // Create group and add first member
          const { error } = await supabase.rpc('rpc_project_group_create_and_add_member', {
            p_primary_project_id: primaryProjectId,
            p_member_project_id: addition.id,
          });

          if (error) {
            throw new Error(`Failed to create group: ${error.message}`);
          }

          groupDissolved = false;
        } else {
          // Add to existing group
          const { error } = await supabase.rpc('rpc_project_group_add_member', {
            p_primary_project_id: primaryProjectId,
            p_member_project_id: addition.id,
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
