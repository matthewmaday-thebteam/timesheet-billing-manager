import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  ProjectManagerDisplay,
  ProjectManagerLookup,
} from '../types';

// ============================================================================
// useProjectManagersForProject
// ============================================================================

interface UseProjectManagersForProjectResult {
  managers: ProjectManagerDisplay[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetches the persisted project managers for a single project.
 * Used in the Edit Project modal.
 */
export function useProjectManagersForProject(projectId: string | null): UseProjectManagersForProjectResult {
  const [managers, setManagers] = useState<ProjectManagerDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchManagers = useCallback(async () => {
    if (!projectId) {
      setManagers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('project_managers')
        .select(`
          resource_id,
          resources!inner (
            id,
            external_label,
            first_name,
            last_name
          )
        `)
        .eq('project_id', projectId);

      if (queryError) {
        throw new Error(queryError.message);
      }

      const managerList: ProjectManagerDisplay[] = (data || []).map((row: Record<string, unknown>) => {
        const r = row.resources as Record<string, unknown>;
        const firstName = (r.first_name as string) || '';
        const lastName = (r.last_name as string) || '';
        const displayName = (firstName || lastName)
          ? `${firstName} ${lastName}`.trim()
          : (r.external_label as string) || 'Unknown';

        return {
          resource_id: row.resource_id as string,
          display_name: displayName,
          external_label: (r.external_label as string) || '',
        };
      });

      setManagers(managerList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch project managers');
      setManagers([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchManagers();
  }, [fetchManagers]);

  return { managers, loading, error, refetch: fetchManagers };
}

// ============================================================================
// useProjectManagerMutations
// ============================================================================

interface SaveManagerChangesParams {
  projectId: string;
  additions: { resource_id: string }[];
  removals: string[];  // resource_id array
}

interface UseProjectManagerMutationsResult {
  saveChanges: (params: SaveManagerChangesParams) => Promise<{ success: boolean; error?: string }>;
  isSaving: boolean;
  saveError: string | null;
}

/**
 * Saves staged project manager additions and removals.
 */
export function useProjectManagerMutations(): UseProjectManagerMutationsResult {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveChanges = useCallback(async (params: SaveManagerChangesParams) => {
    const { projectId, additions, removals } = params;
    setIsSaving(true);
    setSaveError(null);

    try {
      // Process removals first
      if (removals.length > 0) {
        const { error: deleteError } = await supabase
          .from('project_managers')
          .delete()
          .eq('project_id', projectId)
          .in('resource_id', removals);

        if (deleteError) {
          throw new Error(deleteError.message);
        }
      }

      // Process additions
      if (additions.length > 0) {
        const rows = additions.map(a => ({
          project_id: projectId,
          resource_id: a.resource_id,
        }));

        const { error: insertError } = await supabase
          .from('project_managers')
          .insert(rows);

        if (insertError) {
          throw new Error(insertError.message);
        }
      }

      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save manager changes';
      setSaveError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { saveChanges, isSaving, saveError };
}

// ============================================================================
// useAllProjectManagers
// ============================================================================

interface UseAllProjectManagersResult {
  /** Map from internal project UUID to array of manager display names */
  managerLookup: ProjectManagerLookup;
  loading: boolean;
  error: string | null;
  /** Refetch all project manager associations */
  refetch: () => void;
}

/**
 * Fetches ALL project-manager associations for the Projects page table column.
 * Returns a Map<internalUUID, string[]> for efficient lookup per project row.
 */
export function useAllProjectManagers(): UseAllProjectManagersResult {
  const [managerLookup, setManagerLookup] = useState<ProjectManagerLookup>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('project_managers')
        .select(`
          project_id,
          resources!inner (
            first_name,
            last_name,
            external_label
          )
        `);

      if (queryError) {
        throw new Error(queryError.message);
      }

      const lookup: ProjectManagerLookup = new Map();

      for (const row of (data || [])) {
        const r = (row as Record<string, unknown>).resources as Record<string, unknown>;
        const projectId = (row as Record<string, unknown>).project_id as string;
        const firstName = (r.first_name as string) || '';
        const lastName = (r.last_name as string) || '';
        const displayName = (firstName || lastName)
          ? `${firstName} ${lastName}`.trim()
          : (r.external_label as string) || 'Unknown';

        const existing = lookup.get(projectId) || [];
        existing.push(displayName);
        lookup.set(projectId, existing);
      }

      setManagerLookup(lookup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch project managers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { managerLookup, loading, error, refetch: fetchAll };
}
