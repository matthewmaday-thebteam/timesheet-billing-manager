import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Resource, ResourceFormData } from '../types';

interface UseResourcesResult {
  resources: Resource[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  updateResource: (id: string, data: ResourceFormData) => Promise<boolean>;
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
        .select('*')
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

  const updateResource = useCallback(async (id: string, data: ResourceFormData): Promise<boolean> => {
    setIsUpdating(true);

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
              employment_type: data.employment_type,
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
          employment_type: data.employment_type,
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
