import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface UseCanonicalProjectExternalIdsResult {
  /**
   * Map from project internal UUID to its canonical primary's external project_id.
   * Includes primary, standalone, AND member projects — members map to their primary's
   * external id so milestone billings (which point at any project) resolve correctly.
   */
  internalToExternalId: Map<string, string>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to build a canonical project-id resolution map for revenue/billing lookups.
 *
 * Combines the `projects` table (UUID + external project_id) with `v_project_canonical`
 * (UUID -> canonical primary UUID, role). For every project we resolve to the canonical
 * primary's external id. Standalone/primary projects map to their own external id;
 * member projects map to their primary's external id.
 */
export function useCanonicalProjectExternalIds(): UseCanonicalProjectExternalIdsResult {
  const [internalToExternalId, setInternalToExternalId] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [projectsResult, canonicalResult] = await Promise.all([
        supabase.from('projects').select('id, project_id'),
        supabase.from('v_project_canonical').select('project_id, canonical_project_id'),
      ]);

      if (projectsResult.error) throw new Error(projectsResult.error.message);

      // Build internal UUID -> external project_id lookup from projects
      const uuidToExternal = new Map<string, string>();
      for (const p of projectsResult.data || []) {
        uuidToExternal.set(p.id, p.project_id);
      }

      // Start with each project mapping to its own external id (covers primaries + standalones)
      const map = new Map<string, string>();
      for (const [uuid, ext] of uuidToExternal) {
        map.set(uuid, ext);
      }

      // For members, override with the primary's external id.
      // The view is optional — if unavailable, members simply map to their own external id.
      if (canonicalResult.error) {
        if (!canonicalResult.error.message.includes('does not exist')) {
          console.warn('v_project_canonical query failed:', canonicalResult.error.message);
        }
      } else {
        for (const row of canonicalResult.data || []) {
          const primaryExternal = uuidToExternal.get(row.canonical_project_id);
          if (primaryExternal) {
            map.set(row.project_id, primaryExternal);
          }
        }
      }

      setInternalToExternalId(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load canonical project mapping');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    internalToExternalId,
    loading,
    error,
  };
}
