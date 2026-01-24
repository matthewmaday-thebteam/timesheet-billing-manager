import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RoundingHistoryEntry, RoundingIncrement } from '../types';

interface UseRoundingHistoryReturn {
  history: RoundingHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch rounding history for a specific project.
 * Returns all rounding records ordered by rounding_month descending.
 */
export function useRoundingHistory(projectId: string | null): UseRoundingHistoryReturn {
  const [history, setHistory] = useState<RoundingHistoryEntry[]>([]);
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
        .from('project_monthly_rounding')
        .select('rounding_month, rounding_increment, created_at, updated_at')
        .eq('project_id', projectId)
        .order('rounding_month', { ascending: false });

      if (fetchError) throw fetchError;

      const mapped: RoundingHistoryEntry[] = (data || []).map((row) => ({
        roundingMonth: row.rounding_month,
        roundingIncrement: row.rounding_increment as RoundingIncrement,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      setHistory(mapped);
    } catch (err) {
      console.error('Error fetching rounding history:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch rounding history');
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
 * Format a rounding month string for display.
 * Input: "2026-01-01" -> Output: "Jan 2026"
 */
export function formatRoundingMonth(roundingMonth: string): string {
  const date = new Date(roundingMonth + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Get display label for a rounding increment.
 */
export function getRoundingLabel(increment: RoundingIncrement): string {
  switch (increment) {
    case 0:
      return 'Actual';
    case 5:
      return '5 min';
    case 15:
      return '15 min';
    case 30:
      return '30 min';
    default:
      return `${increment} min`;
  }
}

/**
 * Get full display label for a rounding increment.
 */
export function getRoundingLabelFull(increment: RoundingIncrement): string {
  switch (increment) {
    case 0:
      return 'Actual (no rounding)';
    case 5:
      return '5 minutes';
    case 15:
      return '15 minutes';
    case 30:
      return '30 minutes';
    default:
      return `${increment} minutes`;
  }
}
