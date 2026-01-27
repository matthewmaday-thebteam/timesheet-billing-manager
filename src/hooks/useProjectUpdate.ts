import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface ProjectUpdateData {
  target_hours?: number;
}

interface UseProjectUpdateResult {
  updateProject: (id: string, data: ProjectUpdateData) => Promise<{ success: boolean; error?: string }>;
  isUpdating: boolean;
  error: string | null;
}

/**
 * Hook to update project fields.
 * Updates the projects table directly.
 */
export function useProjectUpdate(): UseProjectUpdateResult {
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateProject = useCallback(async (id: string, data: ProjectUpdateData) => {
    setIsUpdating(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('projects')
        .update(data)
        .eq('id', id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update project';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsUpdating(false);
    }
  }, []);

  return {
    updateProject,
    isUpdating,
    error,
  };
}
