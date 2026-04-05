import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type {
  Resource,
  ResourceWithGrouping,
  ResourceFormData,
  EmploymentType,
  EntityGroupRole,
} from '../types';

interface UseEmployeeTableEntitiesResult {
  /** Resources filtered for Employee table (excludes members) */
  entities: ResourceWithGrouping[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refetch data */
  refetch: () => void;
  /** Update a resource */
  updateResource: (id: string, data: ResourceFormData, employmentTypes?: EmploymentType[]) => Promise<boolean>;
  /** Whether an update is in progress */
  isUpdating: boolean;
}

/**
 * Hook to fetch employee table entities with physical person grouping information.
 * Returns only entities that should appear in the Employee table:
 * - Unassociated entities
 * - Primary entities (with their member system IDs aggregated)
 * Excludes member entities.
 */
export function useEmployeeTableEntities(): UseEmployeeTableEntitiesResult {
  const [resources, setResources] = useState<Resource[]>([]);
  const [groupingData, setGroupingData] = useState<Map<string, {
    role: EntityGroupRole;
    groupId: string | null;
    memberCount: number;
  }>>(new Map());
  const [memberSystemIds, setMemberSystemIds] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch from the view that filters out members
      const { data: viewData, error: viewError } = await supabase
        .from('v_employee_table_entities')
        .select('*')
        .order('external_label', { ascending: true });

      if (viewError) {
        throw new Error(viewError.message);
      }

      // Parse the view data
      const resourceList: Resource[] = [];
      const groupingMap = new Map<string, {
        role: EntityGroupRole;
        groupId: string | null;
        memberCount: number;
      }>();

      for (const row of viewData || []) {
        // Build resource object (view includes all resource fields + grouping info)
        const resource: Resource = {
          id: row.id,
          user_id: row.user_id,
          external_label: row.external_label,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          teams_account: row.teams_account,
          employment_type_id: row.employment_type_id,
          billing_mode: row.billing_mode,
          expected_hours: row.expected_hours,
          hourly_rate: row.hourly_rate,
          monthly_cost: row.monthly_cost,
          bamboo_employee_id: row.bamboo_employee_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          // Include employment type if present
          employment_type: row.employment_type_name ? {
            id: row.employment_type_id,
            name: row.employment_type_name,
            created_at: '',
          } : undefined,
        };

        resourceList.push(resource);

        // Store grouping info
        groupingMap.set(row.id, {
          role: (row.grouping_role || 'unassociated') as EntityGroupRole,
          groupId: row.group_id,
          memberCount: row.member_count || 0,
        });
      }

      setResources(resourceList);
      setGroupingData(groupingMap);

      // Fetch member system IDs for primary entities
      const primaryIds = Array.from(groupingMap.entries())
        .filter(([, info]) => info.role === 'primary')
        .map(([id]) => id);

      if (primaryIds.length > 0) {
        const { data: memberData, error: memberError } = await supabase
          .from('v_group_member_details')
          .select('primary_resource_id, member_user_id, member_external_label')
          .in('primary_resource_id', primaryIds);

        if (memberError) {
          console.warn('Failed to fetch member details:', memberError.message);
        } else {
          const memberIdsMap = new Map<string, string[]>();
          for (const row of memberData || []) {
            const primaryId = row.primary_resource_id;
            const systemId = row.member_user_id || row.member_external_label;
            if (systemId) {
              const existing = memberIdsMap.get(primaryId) || [];
              existing.push(systemId);
              memberIdsMap.set(primaryId, existing);
            }
          }
          setMemberSystemIds(memberIdsMap);
        }
      } else {
        setMemberSystemIds(new Map());
      }

      // Also fetch associations for system ID display (resource_user_associations)
      const { data: assocData, error: assocError } = await supabase
        .from('resource_user_associations')
        .select('resource_id, user_id');

      if (!assocError && assocData) {
        // Update resources with associations (for primary's own system IDs)
        const assocByResource = new Map<string, string[]>();
        for (const assoc of assocData) {
          const existing = assocByResource.get(assoc.resource_id) || [];
          if (assoc.user_id) {
            existing.push(assoc.user_id);
          }
          assocByResource.set(assoc.resource_id, existing);
        }

        // Merge into resources
        for (const resource of resourceList) {
          const assocIds = assocByResource.get(resource.id) || [];
          (resource as Resource & { _assoc_ids?: string[] })._assoc_ids = assocIds;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch employee data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build the final entities with all_system_ids computed
  const entities = useMemo((): ResourceWithGrouping[] => {
    return resources.map(resource => {
      const groupInfo = groupingData.get(resource.id) || {
        role: 'unassociated' as EntityGroupRole,
        groupId: null,
        memberCount: 0,
      };

      // Compute all system IDs:
      // 1. Resource's own user_id or external_label
      // 2. Resource's associations (from resource_user_associations)
      // 3. Member system IDs (if primary)
      const allIds: string[] = [];
      const seenIds = new Set<string>();

      // Add primary's own IDs
      const assocIds = (resource as Resource & { _assoc_ids?: string[] })._assoc_ids || [];
      for (const id of assocIds) {
        if (id && !seenIds.has(id)) {
          allIds.push(id);
          seenIds.add(id);
        }
      }

      // Fallback to user_id or external_label if no associations
      if (allIds.length === 0) {
        const fallbackId = resource.user_id || resource.external_label;
        if (fallbackId && !seenIds.has(fallbackId)) {
          allIds.push(fallbackId);
          seenIds.add(fallbackId);
        }
      }

      // Add member system IDs for primaries
      if (groupInfo.role === 'primary') {
        const memberIds = memberSystemIds.get(resource.id) || [];
        for (const id of memberIds) {
          if (id && !seenIds.has(id)) {
            allIds.push(id);
            seenIds.add(id);
          }
        }
      }

      return {
        ...resource,
        grouping_role: groupInfo.role,
        group_id: groupInfo.groupId,
        member_count: groupInfo.memberCount,
        all_system_ids: allIds,
      };
    });
  }, [resources, groupingData, memberSystemIds]);

  const updateResource = useCallback(async (
    id: string,
    data: ResourceFormData,
    employmentTypes?: EmploymentType[]
  ): Promise<boolean> => {
    setIsUpdating(true);

    const newEmploymentType = employmentTypes?.find(et => et.id === data.employment_type_id);
    const previousResources = [...resources];

    // Optimistic update
    setResources(prev =>
      prev.map(r =>
        r.id === id
          ? {
              ...r,
              first_name: data.first_name || null,
              last_name: data.last_name || null,
              email: data.email || null,
              teams_account: data.teams_account || null,
              employment_type_id: data.employment_type_id,
              employment_type: newEmploymentType || r.employment_type,
              billing_mode: data.billing_mode,
              expected_hours: data.expected_hours,
              hourly_rate: data.hourly_rate,
              monthly_cost: data.monthly_cost,
              bamboo_employee_id: data.bamboo_employee_id,
              updated_at: new Date().toISOString(),
            }
          : r
      )
    );

    try {
      const { error: updateError } = await supabase
        .from('resources')
        .update({
          first_name: data.first_name || null,
          last_name: data.last_name || null,
          email: data.email || null,
          teams_account: data.teams_account || null,
          employment_type_id: data.employment_type_id,
          billing_mode: data.billing_mode,
          expected_hours: data.expected_hours,
          hourly_rate: data.hourly_rate,
          monthly_cost: data.monthly_cost,
          bamboo_employee_id: data.bamboo_employee_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        setResources(previousResources);
        throw new Error(updateError.message);
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update resource');
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [resources]);

  return {
    entities,
    loading,
    error,
    refetch: fetchData,
    updateResource,
    isUpdating,
  };
}
