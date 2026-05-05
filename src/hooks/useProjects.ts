import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Project, ProjectFormData } from '../types';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);

  // Fetch all projects
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('projects')
        .select('*')
        .order('project_name', { ascending: true });

      if (fetchError) throw fetchError;
      setProjects(data || []);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Update project rate
  const updateProject = useCallback(async (id: string, data: ProjectFormData): Promise<boolean> => {
    setIsOperating(true);
    setError(null);

    // Find current project for optimistic update
    const currentProject = projects.find(p => p.id === id);
    if (!currentProject) {
      setError('Project not found');
      setIsOperating(false);
      return false;
    }

    // Optimistic update
    const updatedProject = { ...currentProject, rate: data.rate, updated_at: new Date().toISOString() };
    setProjects(prev => prev.map(p => p.id === id ? updatedProject : p));

    try {
      const { error: updateError } = await supabase
        .from('projects')
        .update({ rate: data.rate })
        .eq('id', id);

      if (updateError) throw updateError;
      return true;
    } catch (err) {
      console.error('Error updating project:', err);
      setError(err instanceof Error ? err.message : 'Failed to update project');
      // Rollback optimistic update
      setProjects(prev => prev.map(p => p.id === id ? currentProject : p));
      return false;
    } finally {
      setIsOperating(false);
    }
  }, [projects]);

  // Create a new manually-originated project
  const createProject = useCallback(async (input: {
    companyUuid: string;
    projectName: string;
    rate?: number | null;
  }): Promise<Project | null> => {
    setIsOperating(true);
    setError(null);

    const previousProjects = [...projects];
    const projectId = 'manual_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    try {
      // Fetch the chosen company's legacy keys so the project participates in
      // legacy joins (e.g. get_all_project_rates_for_month joins p.client_id
      // = c.client_id). Without this, manual projects appear "Unassigned" on
      // surfaces that haven't migrated to the canonical company_id FK.
      const { data: companyRow, error: companyError } = await supabase
        .from('companies')
        .select('client_id, client_name')
        .eq('id', input.companyUuid)
        .single();

      if (companyError) throw companyError;
      if (!companyRow) {
        throw new Error('Selected company not found');
      }

      // Set first_seen_month at insert so the project appears on the Rates
      // page from creation. get_all_project_rates_for_month filters out rows
      // with NULL first_seen_month, and get_effective_project_rate falls back
      // to the $45 default — without this, time entries arriving later would
      // silently bill at $45/hr with no admin-visible rate-setting surface.
      const now = new Date();
      const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

      const { data, error: insertError } = await supabase
        .from('projects')
        .insert({
          project_id: projectId,
          project_name: input.projectName.trim(),
          company_id: input.companyUuid,
          client_id: companyRow.client_id,
          client_name: companyRow.client_name,
          first_seen_month: firstOfMonth,
          manual_origin: true,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;

      const created = data as Project;
      setProjects(prev => [...prev, created]);

      // Set the rate for the current month if requested. If this fails after
      // the insert, leave the project in place and surface the error — the
      // project is still valid, only the rate write failed.
      if (input.rate != null && input.rate >= 0) {
        const { error: rateError } = await supabase.rpc('set_project_rate_for_month', {
          p_project_id: created.id,
          p_month: firstOfMonth,
          p_rate: input.rate,
        });

        if (rateError) {
          setError(rateError.message);
        }
      }

      return created;
    } catch (err) {
      console.error('Error creating project:', err);
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setProjects(previousProjects);
      return null;
    } finally {
      setIsOperating(false);
    }
  }, [projects]);

  // Get rate for a project (with fallback)
  const getProjectRate = useCallback((projectId: string): number => {
    const project = projects.find(p => p.project_id === projectId);
    // If project exists and has a rate (including 0), use it; otherwise fallback to $45
    if (project && project.rate !== null) {
      return project.rate;
    }
    return 45; // Default fallback rate
  }, [projects]);

  // Build a rate lookup map for efficient access
  const buildRateLookup = useCallback((): Map<string, number> => {
    const lookup = new Map<string, number>();
    projects.forEach(project => {
      // Only add to lookup if rate is explicitly set (including 0)
      if (project.rate !== null) {
        lookup.set(project.project_id, project.rate);
      }
    });
    return lookup;
  }, [projects]);

  return {
    projects,
    loading,
    error,
    isOperating,
    fetchProjects,
    updateProject,
    createProject,
    getProjectRate,
    buildRateLookup,
  };
}
