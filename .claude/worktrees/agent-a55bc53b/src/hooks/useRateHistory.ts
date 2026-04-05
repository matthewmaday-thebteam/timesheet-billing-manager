import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RateHistoryEntry } from '../types';

interface UseRateHistoryReturn {
  history: RateHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch rate history for a specific project.
 * Returns all rate records ordered by rate_month descending.
 */
export function useRateHistory(projectId: string | null): UseRateHistoryReturn {
  const [history, setHistory] = useState<RateHistoryEntry[]>([]);
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
        .from('project_monthly_rates')
        .select('rate_month, rate, created_at, updated_at')
        .eq('project_id', projectId)
        .order('rate_month', { ascending: false });

      if (fetchError) throw fetchError;

      const mapped: RateHistoryEntry[] = (data || []).map((row) => ({
        rateMonth: row.rate_month,
        rate: row.rate,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      setHistory(mapped);
    } catch (err) {
      console.error('Error fetching rate history:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch rate history');
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
 * Format a rate month string for display.
 * Input: "2026-01-01" -> Output: "Jan 2026"
 */
export function formatRateMonth(rateMonth: string): string {
  const date = new Date(rateMonth + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Format a rate month string for display (long format).
 * Input: "2026-01-01" -> Output: "January 2026"
 */
export function formatRateMonthLong(rateMonth: string): string {
  const date = new Date(rateMonth + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
