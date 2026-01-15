import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ResourceUserAssociation, AssociationSource } from '../types';

interface UnassociatedUser {
  user_id: string;
  user_name: string;
  source: AssociationSource;
}

interface UseUserAssociationsResult {
  unassociatedUsers: UnassociatedUser[];
  loading: boolean;
  error: string | null;
  fetchUnassociatedUsers: () => Promise<void>;
  addAssociation: (resourceId: string, userId: string, source: AssociationSource, userName: string) => Promise<ResourceUserAssociation | null>;
  removeAssociation: (associationId: string) => Promise<boolean>;
  isUpdating: boolean;
}

export function useUserAssociations(): UseUserAssociationsResult {
  const [unassociatedUsers, setUnassociatedUsers] = useState<UnassociatedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  /**
   * Fetches all user_ids from timesheet_daily_rollups that are NOT yet associated with any resource.
   * Returns distinct users grouped by their source (inferred from workspace_id pattern).
   */
  const fetchUnassociatedUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Get all user_ids currently in timesheet data
      const { data: timesheetUsers, error: timesheetError } = await supabase
        .from('timesheet_daily_rollups')
        .select('user_id, user_name, clockify_workspace_id')
        .not('user_id', 'is', null);

      if (timesheetError) {
        throw new Error(timesheetError.message);
      }

      // Get all user_ids already associated
      const { data: associations, error: assocError } = await supabase
        .from('resource_user_associations')
        .select('user_id, source');

      if (assocError) {
        throw new Error(assocError.message);
      }

      // Create a set of already associated user_ids
      const associatedSet = new Set(
        associations?.map(a => a.user_id) || []
      );

      // Filter to unassociated users, dedupe by user_id
      const seen = new Set<string>();
      const unassociated: UnassociatedUser[] = [];

      for (const entry of timesheetUsers || []) {
        if (!entry.user_id) continue;

        // Skip if already associated or already seen
        if (associatedSet.has(entry.user_id) || seen.has(entry.user_id)) continue;

        // Infer source from workspace_id pattern (for database record only)
        // Clockify uses MongoDB ObjectIds (24 hex chars), ClickUp uses numeric strings
        const isClickUp = /^\d+$/.test(entry.clockify_workspace_id);
        const source: AssociationSource = isClickUp ? 'clickup' : 'clockify';

        seen.add(entry.user_id);
        unassociated.push({
          user_id: entry.user_id,
          user_name: entry.user_name || entry.user_id,
          source,
        });
      }

      // Sort by name
      unassociated.sort((a, b) => a.user_name.localeCompare(b.user_name));

      setUnassociatedUsers(unassociated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch unassociated users');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Creates a new association between a resource and a user_id from a time tracking system.
   */
  const addAssociation = useCallback(async (
    resourceId: string,
    userId: string,
    source: AssociationSource,
    userName: string
  ): Promise<ResourceUserAssociation | null> => {
    setIsUpdating(true);
    setError(null);

    try {
      const { data, error: insertError } = await supabase
        .from('resource_user_associations')
        .insert({
          resource_id: resourceId,
          user_id: userId,
          source,
          user_name: userName,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      // Remove from unassociated list
      setUnassociatedUsers(prev =>
        prev.filter(u => u.user_id !== userId)
      );

      return data as ResourceUserAssociation;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add association');
      return null;
    } finally {
      setIsUpdating(false);
    }
  }, []);

  /**
   * Removes an association, making the user_id available for reassignment.
   */
  const removeAssociation = useCallback(async (associationId: string): Promise<boolean> => {
    setIsUpdating(true);
    setError(null);

    try {
      // First get the association data so we can add it back to unassociated
      const { data: association, error: fetchError } = await supabase
        .from('resource_user_associations')
        .select('*')
        .eq('id', associationId)
        .single();

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const { error: deleteError } = await supabase
        .from('resource_user_associations')
        .delete()
        .eq('id', associationId);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      // Add back to unassociated list
      if (association) {
        setUnassociatedUsers(prev => [
          ...prev,
          {
            user_id: association.user_id,
            user_name: association.user_name || association.user_id,
            source: association.source as AssociationSource,
          },
        ].sort((a, b) => a.user_name.localeCompare(b.user_name)));
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove association');
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, []);

  return {
    unassociatedUsers,
    loading,
    error,
    fetchUnassociatedUsers,
    addAssociation,
    removeAssociation,
    isUpdating,
  };
}
