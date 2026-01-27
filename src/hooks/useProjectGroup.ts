import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  ProjectGroupRole,
  ProjectGroupMemberDisplay,
  ProjectGroupGetResult,
  UnassociatedProject,
} from '../types';

interface UseProjectGroupResult {
  /** Project's role in the grouping system */
  role: ProjectGroupRole;
  /** Group ID if this project is a primary (null otherwise) */
  groupId: string | null;
  /** Member projects if this project is a primary */
  members: ProjectGroupMemberDisplay[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refetch group data */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch project group data for a specific project.
 * Returns the project's role (primary/member/unassociated) and its group members if primary.
 */
export function useProjectGroup(projectId: string | null): UseProjectGroupResult {
  const [role, setRole] = useState<ProjectGroupRole>('unassociated');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<ProjectGroupMemberDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroupData = useCallback(async () => {
    if (!projectId) {
      setRole('unassociated');
      setGroupId(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_project_group_get', {
        p_project_id: projectId,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const result = data as ProjectGroupGetResult;

      if (result && result.success) {
        setRole(result.role);
        setGroupId(result.group_id);

        // Parse members from the result
        if (result.members && Array.isArray(result.members)) {
          const memberList: ProjectGroupMemberDisplay[] = result.members.map((m) => ({
            member_project_id: m.member_project_id,
            project_id: m.project_id,
            project_name: m.project_name,
            added_at: m.added_at,
          }));
          setMembers(memberList);
        } else {
          setMembers([]);
        }
      } else {
        // No group data - project is unassociated
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
  }, [projectId]);

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

interface UseUnassociatedProjectsResult {
  /** List of unassociated projects available for grouping */
  projects: UnassociatedProject[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Fetch/refresh the list */
  fetch: (excludeProjectId?: string) => Promise<void>;
}

/**
 * Hook to fetch projects available for adding to a group.
 * Only returns unassociated projects (not already a primary or member).
 */
export function useUnassociatedProjects(): UseUnassociatedProjectsResult {
  const [projects, setProjects] = useState<UnassociatedProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async (excludeProjectId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_list_unassociated_projects', {
        p_exclude_project_id: excludeProjectId || null,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const projectList: UnassociatedProject[] = (data || []).map((p: {
        id: string;
        project_id: string;
        project_name: string;
      }) => ({
        id: p.id,
        project_id: p.project_id,
        project_name: p.project_name,
      }));

      setProjects(projectList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch unassociated projects');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    projects,
    loading,
    error,
    fetch: fetchProjects,
  };
}
