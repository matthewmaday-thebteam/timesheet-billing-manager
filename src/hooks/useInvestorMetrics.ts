/**
 * useInvestorMetrics - Fetch investor dashboard metrics from the database RPC.
 *
 * Calls get_investor_dashboard_metrics(p_month) which returns pre-calculated
 * revenue metrics, workday counts, and projections for a given month.
 * Replaces frontend-side workday counting and revenue calculations on the
 * Investor Dashboard.
 *
 * @official 2026-04-03
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { MonthSelection } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface InvestorMetricsData {
  combined_total_revenue_cents: number;
  earned_total_revenue_cents: number;
  avg_daily_earned_revenue_cents: number;
  avg_daily_billed_revenue_cents: number;
  total_workdays: number;
  completed_workdays: number;
  remaining_workdays: number;
  company_holiday_count: number;
  projected_earned_revenue_cents: number;
  projected_billed_revenue_cents: number;
  fixed_lump_revenue_cents: number;
}

interface UseInvestorMetricsReturn {
  /** Metrics data from the RPC (null while loading or on error) */
  data: InvestorMetricsData | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatMonthAsISO(month: MonthSelection): string {
  const yyyy = month.year;
  const mm = String(month.month).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

// ============================================================================
// HOOK
// ============================================================================

export function useInvestorMetrics(selectedMonth: MonthSelection): UseInvestorMetricsReturn {
  const [data, setData] = useState<InvestorMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const monthStr = formatMonthAsISO(selectedMonth);

      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_investor_dashboard_metrics', { p_month: monthStr });

      if (rpcError) throw rpcError;

      // RPC returns an array of rows; we expect exactly one
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

      if (!row) {
        // No data for this month — return zeroed metrics
        setData({
          combined_total_revenue_cents: 0,
          earned_total_revenue_cents: 0,
          avg_daily_earned_revenue_cents: 0,
          avg_daily_billed_revenue_cents: 0,
          total_workdays: 0,
          completed_workdays: 0,
          remaining_workdays: 0,
          company_holiday_count: 0,
          projected_earned_revenue_cents: 0,
          projected_billed_revenue_cents: 0,
          fixed_lump_revenue_cents: 0,
        });
      } else {
        setData(row as InvestorMetricsData);
      }
    } catch (err) {
      console.error('Error fetching investor metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch investor metrics');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return {
    data,
    loading,
    error,
  };
}
