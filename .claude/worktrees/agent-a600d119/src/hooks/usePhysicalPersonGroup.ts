import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  EntityGroupRole,
  GroupMemberDisplay,
  GroupGetResult,
  UnassociatedEntity,
} from '../types';

interface UsePhysicalPersonGroupResult {
  /** Entity's role in the grouping system */
  role: EntityGroupRole;
  /** Group ID if this entity is a primary (null otherwise) */
  groupId: string | null;
  /** Member entities if this entity is a primary */
  members: GroupMemberDisplay[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refetch group data */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch physical person group data for a specific entity.
 * Returns the entity's role (primary/member/unassociated) and its group members if primary.
 */
export function usePhysicalPersonGroup(resourceId: string | null): UsePhysicalPersonGroupResult {
  const [role, setRole] = useState<EntityGroupRole>('unassociated');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMemberDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroupData = useCallback(async () => {
    if (!resourceId) {
      setRole('unassociated');
      setGroupId(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_group_get', {
        p_resource_id: resourceId,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const result = data as GroupGetResult;

      if (result && result.success) {
        setRole(result.role);
        setGroupId(result.group_id);

        // Parse members from the result
        if (result.members && Array.isArray(result.members)) {
          const memberList: GroupMemberDisplay[] = result.members.map((m) => ({
            member_resource_id: m.member_resource_id,
            external_label: m.external_label,
            first_name: m.first_name,
            last_name: m.last_name,
            user_id: m.user_id,
            added_at: m.added_at,
            display_name: m.first_name && m.last_name
              ? `${m.first_name} ${m.last_name}`.trim()
              : m.external_label,
          }));
          setMembers(memberList);
        } else {
          setMembers([]);
        }
      } else {
        // No group data - entity is unassociated
        setRole('unassociated');
        setGroupId(null);
        setMembers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch group data');
      // Set defaults on error
      setRole('unassociated');
      setGroupId(null);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

  useEffect(() => {
    fetchGroupData();
  }, [fetchGroupData]);

  return {
    role,
    groupId,
    members,
    loading,
    error,
    refetch: fetchGroupData,
  };
}

interface UseUnassociatedEntitiesResult {
  /** List of unassociated entities available for grouping */
  entities: UnassociatedEntity[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Fetch/refresh the list */
  fetch: (excludeResourceId?: string) => Promise<void>;
}

/**
 * Hook to fetch entities available for adding to a group.
 * Only returns unassociated entities (not already a primary or member).
 */
export function useUnassociatedEntities(): UseUnassociatedEntitiesResult {
  const [entities, setEntities] = useState<UnassociatedEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntities = useCallback(async (excludeResourceId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_list_unassociated_entities', {
        p_exclude_resource_id: excludeResourceId || null,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const entityList: UnassociatedEntity[] = (data || []).map((e: {
        resource_id: string;
        external_label: string;
        first_name: string | null;
        last_name: string | null;
        user_id: string | null;
        display_name: string;
      }) => ({
        resource_id: e.resource_id,
        external_label: e.external_label,
        first_name: e.first_name,
        last_name: e.last_name,
        user_id: e.user_id,
        display_name: e.display_name || e.external_label,
      }));

      setEntities(entityList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch unassociated entities');
      setEntities([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    entities,
    loading,
    error,
    fetch: fetchEntities,
  };
}
