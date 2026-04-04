/**
 * useSyncAlerts - Fetch and manage sync reconciliation alerts.
 *
 * Provides active (unresolved, undismissed) alerts for dashboard display
 * and a dismiss function that records the dismissal with the current user.
 * Covers alerts from all sync sources: BambooHR and Clockify.
 *
 * @official 2026-04-04
 * @category Hook
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ============================================================================
// TYPES
// ============================================================================

export interface SyncAlert {
  id: string;
  alert_type: 'timeoff_days_mismatch' | 'unmatched_resource' | 'clockify_sync_incomplete' | 'clockify_zero_entries' | 'clockify_high_deletion_count' | 'clockify_hours_mismatch';
  severity: 'warning' | 'error';
  title: string;
  detail: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  metadata: Record<string, unknown>;
  dismissed_at: string | null;
  dismissed_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UseSyncAlertsReturn {
  /** Active alerts (unresolved and undismissed), sorted by severity then date */
  alerts: SyncAlert[];
  /** Count of active alerts for badge display */
  activeCount: number;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Dismiss a single alert by ID */
  dismissAlert: (alertId: string) => Promise<void>;
  /** Refetch alerts */
  refetch: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useSyncAlerts(): UseSyncAlertsReturn {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<SyncAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('sync_alerts')
        .select('*')
        .is('resolved_at', null)
        .is('dismissed_at', null)
        .order('severity', { ascending: true })  // 'error' < 'warning' alphabetically, so ascending puts errors first
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      setAlerts((data as SyncAlert[]) || []);
    } catch (err) {
      console.error('Error fetching sync alerts:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch sync alerts');
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts, refetchTrigger]);

  const dismissAlert = useCallback(async (alertId: string) => {
    try {
      const { error: updateError } = await supabase
        .from('sync_alerts')
        .update({
          dismissed_at: new Date().toISOString(),
          dismissed_by: user?.id || null,
        })
        .eq('id', alertId);

      if (updateError) throw updateError;

      // Optimistically remove from local state
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      console.error('Error dismissing alert:', err);
      throw err;
    }
  }, [user?.id]);

  const refetch = useCallback(() => {
    setRefetchTrigger((n) => n + 1);
  }, []);

  return {
    alerts,
    activeCount: alerts.length,
    loading,
    error,
    dismissAlert,
    refetch,
  };
}

export default useSyncAlerts;
