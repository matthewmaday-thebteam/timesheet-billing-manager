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
  fetchUnassociatedUsers: (currentResourceId: string) => Promise<void>;
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
   * Fetches all user_ids from timesheet_daily_rollups that are available for association.
   * A user is available if:
   * - They only have a self-association (user_id = resource's external_label), OR
   * - They have no associations at all
   * Excludes users already associated with the current resource (non-self associations).
   */
  const fetchUnassociatedUsers = useCallback(async (currentResourceId: string) => {
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

      // Get ALL associations with their resource's user_id AND external_label to identify self-associations
      const { data: allAssociations, error: assocError } = await supabase
        .from('resource_user_associations')
        .select('user_id, resource_id, resource:resources(user_id, external_label)');

      if (assocError) {
        throw new Error(assocError.message);
      }

      // Find user_ids that have "real" associations (non-self associations)
      // A self-association is where association.user_id matches resource.user_id OR resource.external_label
      const reallyAssociatedUserIds = new Set<string>();
      const currentResourceNonSelfUserIds = new Set<string>();

      for (const assoc of allAssociations || []) {
        // Handle Supabase join result - may be array or object
        const resourceData = assoc.resource as { user_id: string | null; external_label: string } | { user_id: string | null; external_label: string }[] | null;
        const resourceUserId = Array.isArray(resourceData)
          ? resourceData[0]?.user_id
          : resourceData?.user_id;
        const resourceExtLabel = Array.isArray(resourceData)
          ? resourceData[0]?.external_label
          : resourceData?.external_label;

        // Self-association if user_id matches either the resource's user_id OR external_label
        const isSelfAssociation = assoc.user_id === resourceUserId || assoc.user_id === resourceExtLabel;

        if (!isSelfAssociation) {
          // This is a real association (user associated with a different resource)
          reallyAssociatedUserIds.add(assoc.user_id);

          // Track if this is a non-self association with the current resource
          if (assoc.resource_id === currentResourceId) {
            currentResourceNonSelfUserIds.add(assoc.user_id);
          }
        }
      }

      // Filter to available users, dedupe by user_id
      const seen = new Set<string>();
      const available: UnassociatedUser[] = [];

      for (const entry of timesheetUsers || []) {
        if (!entry.user_id) continue;

        // Skip if:
        // - Has a real association with ANY resource (including current)
        // - Already seen in this loop
        if (reallyAssociatedUserIds.has(entry.user_id) ||
            seen.has(entry.user_id)) continue;

        // Infer source from workspace_id pattern (for database record only)
        const isClickUp = /^\d+$/.test(entry.clockify_workspace_id);
        const source: AssociationSource = isClickUp ? 'clickup' : 'clockify';

        seen.add(entry.user_id);
        available.push({
          user_id: entry.user_id,
          user_name: entry.user_name || entry.user_id,
          source,
        });
      }

      // Sort by name
      available.sort((a, b) => a.user_name.localeCompare(b.user_name));

      setUnassociatedUsers(available);
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
