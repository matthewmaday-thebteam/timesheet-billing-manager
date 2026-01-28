import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Resource, ResourceFormData, EmploymentType } from '../types';

interface UseResourcesResult {
  resources: Resource[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  updateResource: (id: string, data: ResourceFormData, employmentTypes?: EmploymentType[]) => Promise<boolean>;
  isUpdating: boolean;
}

export function useResources(): UseResourcesResult {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('resources')
        .select(`
          *,
          employment_type:employment_types(*),
          associations:resource_user_associations(*)
        `)
        .order('external_label', { ascending: true });

      if (queryError) {
        throw new Error(queryError.message);
      }

      setResources(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch resources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const updateResource = useCallback(async (id: string, data: ResourceFormData, employmentTypes?: EmploymentType[]): Promise<boolean> => {
    setIsUpdating(true);

    // Find the employment type object for the optimistic update
    const newEmploymentType = employmentTypes?.find(et => et.id === data.employment_type_id);

    // Optimistic update - update local state immediately
    const previousResources = [...resources];
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
        // Rollback on error
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
    resources,
    loading,
    error,
    refetch: fetchResources,
    updateResource,
    isUpdating,
  };
}
