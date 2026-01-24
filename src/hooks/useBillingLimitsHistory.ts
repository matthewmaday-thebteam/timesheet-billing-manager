import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { BillingLimitsHistoryEntry } from '../types';

interface UseBillingLimitsHistoryReturn {
  history: BillingLimitsHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch billing limits history for a specific project.
 * Returns all limits records ordered by limits_month descending.
 */
export function useBillingLimitsHistory(projectId: string | null): UseBillingLimitsHistoryReturn {
  const [history, setHistory] = useState<BillingLimitsHistoryEntry[]>([]);
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
        .from('project_monthly_billing_limits')
        .select('limits_month, minimum_hours, maximum_hours, carryover_enabled, carryover_max_hours, carryover_expiry_months, created_at, updated_at')
        .eq('project_id', projectId)
        .order('limits_month', { ascending: false });

      if (fetchError) throw fetchError;

      const mapped: BillingLimitsHistoryEntry[] = (data || []).map((row) => ({
        limitsMonth: row.limits_month,
        minimumHours: row.minimum_hours,
        maximumHours: row.maximum_hours,
        carryoverEnabled: row.carryover_enabled,
        carryoverMaxHours: row.carryover_max_hours,
        carryoverExpiryMonths: row.carryover_expiry_months,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      setHistory(mapped);
    } catch (err) {
      console.error('Error fetching billing limits history:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch billing limits history');
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
 * Format a limits month string for display.
 * Input: "2026-01-01" -> Output: "Jan 2026"
 */
export function formatLimitsMonth(limitsMonth: string): string {
  const date = new Date(limitsMonth + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Format billing limits for compact display.
 * Returns "10h / 40h" or "— / 40h" or "10h / —" or "—"
 */
export function formatLimitsDisplay(
  minimumHours: number | null,
  maximumHours: number | null
): string {
  if (minimumHours === null && maximumHours === null) {
    return '—';
  }

  const minDisplay = minimumHours !== null ? `${minimumHours}h` : '—';
  const maxDisplay = maximumHours !== null ? `${maximumHours}h` : '—';

  return `${minDisplay} / ${maxDisplay}`;
}
