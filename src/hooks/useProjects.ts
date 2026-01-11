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
    getProjectRate,
    buildRateLookup,
  };
}
