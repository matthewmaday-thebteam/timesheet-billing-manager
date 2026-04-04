/**
 * useProjectedAnnualRevenue - Fetch projected annual revenue from the database RPC.
 *
 * Calls get_projected_annual_revenue() which returns the single-source-of-truth
 * projected annual revenue value and its intermediate components.
 *
 * Used by both Dashboard and Investor Dashboard for:
 * - The metric card's projected secondary value
 * - Chart bands (+/- 15%) via transformToLineChartData()
 *
 * @official 2026-04-04
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

export interface ProjectedAnnualRevenueData {
  /** Final projected annual revenue in cents */
  projected_annual_revenue_cents: number;
  /** YTD revenue in cents (sum of all current-year monthly revenue) */
  ytd_revenue_cents: number;
  /** Average daily earned revenue in cents (current month) */
  avg_daily_revenue_cents: number;
  /** Remaining year workdays (today through Dec 31, minus holidays) */
  remaining_year_workdays: number;
  /** Full-time employee remaining PTO working days */
  ft_vacation_days: number;
  /** Part-time employee remaining PTO working days */
  pt_vacation_days: number;
  /** Average billing rate across projects with rate > 0 (dollars) */
  avg_rate: number;
  /** Completed workdays in current month */
  completed_workdays: number;
}

export interface UseProjectedAnnualRevenueReturn {
  /** Projected annual revenue in DOLLARS (converted from cents) */
  projectedAnnualRevenue: number | null;
  /** All intermediate components for debugging */
  components: ProjectedAnnualRevenueData | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
}

// ============================================================================
// HOOK
// ============================================================================

export function useProjectedAnnualRevenue(): UseProjectedAnnualRevenueReturn {
  const [components, setComponents] = useState<ProjectedAnnualRevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjection = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_projected_annual_revenue');

      if (rpcError) throw rpcError;

      // RPC returns an array of rows; we expect exactly one
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

      if (!row) {
        setComponents(null);
      } else {
        setComponents(row as ProjectedAnnualRevenueData);
      }
    } catch (err) {
      console.error('Error fetching projected annual revenue:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch projected annual revenue');
      setComponents(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjection();
  }, [fetchProjection]);

  // Convert cents to dollars for the primary return value
  const projectedAnnualRevenue = components
    ? components.projected_annual_revenue_cents / 100
    : null;

  return {
    projectedAnnualRevenue,
    components,
    loading,
    error,
  };
}
