import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ActiveStatusHistoryEntry } from '../types';

interface UseActiveStatusHistoryReturn {
  history: ActiveStatusHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch active status history for a specific project.
 * Returns all status records ordered by status_month descending.
 */
export function useActiveStatusHistory(projectId: string | null): UseActiveStatusHistoryReturn {
  const [history, setHistory] = useState<ActiveStatusHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!projectId) {
      setHistory([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('project_monthly_active_status')
        .select('status_month, is_active, created_at, updated_at')
        .eq('project_id', projectId)
        .order('status_month', { ascending: false });

      if (fetchError) throw fetchError;

      const mapped: ActiveStatusHistoryEntry[] = (data || []).map((row) => ({
        statusMonth: row.status_month,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      setHistory(mapped);
    } catch (err) {
      console.error('Error fetching active status history:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch active status history');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    history,
    isLoading,
    error,
    refetch: fetchHistory,
  };
}

/**
 * Format a status month string for display.
 * Input: "2026-01-01" -> Output: "Jan 2026"
 */
export function formatStatusMonth(statusMonth: string): string {
  const date = new Date(statusMonth + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Get display label for active status.
 */
export function getActiveStatusLabel(isActive: boolean): string {
  return isActive ? 'Active' : 'Inactive';
}

/**
 * Get description for active status.
 */
export function getActiveStatusDescription(isActive: boolean): string {
  return isActive
    ? 'Minimum hours are billed even if actual hours are lower'
    : 'Only bill actual hours worked (no minimum padding)';
}
