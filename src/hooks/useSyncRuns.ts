import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface SyncRun {
  id: string;
  sync_type: string;
  sync_run_id: string | null;
  started_at: string;
  completed_at: string;
  success: boolean;
  source_total: number;
  manifest_total: number;
  deleted_count: number;
  source_hours: number | null;
  manifest_hours: number | null;
  error_message: string | null;
  summary: Record<string, unknown> | null;
  created_at: string;
}

interface UseSyncRunsResult {
  syncRuns: SyncRun[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch the last 60 sync runs ordered by completed_at DESC.
 */
export function useSyncRuns(): UseSyncRunsResult {
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSyncRuns = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('sync_runs')
        .select('*')
        .order('completed_at', { ascending: false })
        .limit(60);

      if (queryError) {
        throw new Error(queryError.message);
      }

      setSyncRuns((data as SyncRun[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sync runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSyncRuns();
  }, [fetchSyncRuns]);

  return { syncRuns, loading, error, refetch: fetchSyncRuns };
}
