/**
 * useSummaryCombinedRevenueByMonth - SQL-based multi-month revenue query.
 *
 * Replaces running billing calculations 12x in-browser with a single DB query
 * against `v_combined_revenue_by_company_month`.
 *
 * Returns the same shape as `useCombinedRevenueByMonth` so it can be swapped in
 * via the `useCombinedRevenue` wrapper hook.
 *
 * @official 2026-02-10
 */

import { useState, useEffect, useMemo } from 'react';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from '../lib/supabase';
import type { DateRange } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface UseSummaryCombinedRevenueByMonthParams {
  dateRange: DateRange;
  extendedMonths: number;
}

interface CombinedRevenueRow {
  summary_month: string;
  combined_revenue_cents: number;
}

// ============================================================================
// HOOK
// ============================================================================

export function useSummaryCombinedRevenueByMonth({
  dateRange,
  extendedMonths,
}: UseSummaryCombinedRevenueByMonthParams): {
  combinedRevenueByMonth: Map<string, number>;
  loading: boolean;
} {
  const [rows, setRows] = useState<CombinedRevenueRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Compute the date range for the query
  const startMonth = useMemo(() => {
    return format(startOfMonth(subMonths(dateRange.start, extendedMonths)), 'yyyy-MM-dd');
  }, [dateRange.start, extendedMonths]);

  const endMonth = useMemo(() => {
    // Extend to current month to match useCombinedRevenueByMonth behavior
    const maxEnd = new Date(Math.max(dateRange.end.getTime(), endOfMonth(new Date()).getTime()));
    return format(maxEnd, 'yyyy-MM-dd');
  }, [dateRange.end]);

  useEffect(() => {
    async function fetchCombinedRevenue() {
      setLoading(true);

      // Query the view, grouping by month to get total combined revenue
      // The view is per-company-month, so we SUM across companies for each month
      const { data, error } = await supabase
        .from('v_combined_revenue_by_company_month')
        .select('summary_month, combined_revenue_cents')
        .gte('summary_month', startMonth)
        .lte('summary_month', endMonth);

      if (error) {
        console.error('[useSummaryCombinedRevenueByMonth] Query error:', error);
        setRows([]);
      } else {
        setRows((data as CombinedRevenueRow[]) || []);
      }

      setLoading(false);
    }

    fetchCombinedRevenue();
  }, [startMonth, endMonth]);

  // Aggregate rows by month (the view returns per-company, we need per-month totals)
  const combinedRevenueByMonth = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of rows) {
      // summary_month is a DATE like '2026-01-01', extract 'YYYY-MM'
      const monthKey = row.summary_month.substring(0, 7);
      const dollars = (row.combined_revenue_cents ?? 0) / 100;
      const current = map.get(monthKey) ?? 0;
      map.set(monthKey, current + dollars);
    }

    return map;
  }, [rows]);

  return { combinedRevenueByMonth, loading };
}
