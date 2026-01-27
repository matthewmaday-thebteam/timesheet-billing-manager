import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ProjectWithGrouping, ProjectGroupRole } from '../types';

interface UseProjectTableEntitiesResult {
  /** List of projects for table display (excludes members) */
  projects: ProjectWithGrouping[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refetch projects */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch projects for the Projects table.
 * Uses v_project_table_entities view which filters out member projects.
 */
export function useProjectTableEntities(): UseProjectTableEntitiesResult {
  const [projects, setProjects] = useState<ProjectWithGrouping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('v_project_table_entities')
        .select('*')
        .order('project_name');

      if (queryError) {
        throw new Error(queryError.message);
      }

      const projectList: ProjectWithGrouping[] = (data || []).map((row) => ({
        id: row.id,
        project_id: row.project_id,
        project_name: row.project_name,
        rate: row.rate,
        created_at: row.created_at,
        updated_at: row.updated_at,
        grouping_role: (row.grouping_role || 'unassociated') as ProjectGroupRole,
        group_id: row.group_id,
        member_count: row.member_count || 0,
        company_uuid: row.company_uuid || null,
        company_display_name: row.company_display_name || null,
      }));

      setProjects(projectList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    loading,
    error,
    refetch: fetchProjects,
  };
}
