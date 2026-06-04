/**
 * useInvestorProfitEfficiency — Profitability & efficiency series for the
 * Investor Dashboard, computed entirely in the database.
 *
 * Calls get_investor_margin_by_month(p_start, p_end). ALL calculations happen
 * in SQL; this hook only fetches ready-to-render rows and maps Postgres
 * bigint/numeric (which arrive as string|number) to numbers for charts.
 *
 * Return shape is the agreed FRONTEND/BACKEND CONTRACT — the page depends on
 * it and it must not change: { rows, loading, error }.
 *
 * @official 2026-06-04
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface InvestorProfitEfficiencyRow {
  month: string;
  combined_revenue_cents: number;
  timesheet_revenue_cents: number;
  labor_cost_cents: number;
  all_in_profit_cents: number;
  all_in_margin_pct: number;
  ts_profit_cents: number;
  ts_margin_pct: number;
  /**
   * Labor-cost coverage. NULL is PRESERVED (not coerced to 0): null/undefined
   * means the month is NOT fully cost-verified (CANNOT-VERIFY). The page treats
   * anything that is not >= 100 as unverified, so null correctly flags the month
   * as not-fully-verified rather than a false 100%.
   */
  cost_coverage_pct: number | null;
  resource_count: number;
  revenue_per_resource_cents: number;
  profit_per_resource_cents: number;
}

export interface UseInvestorProfitEfficiencyReturn {
  rows: InvestorProfitEfficiencyRow[];
  loading: boolean;
  error: string | null;
}

/** Coerce a possibly-string numeric (Postgres bigint/numeric) to a number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Coerce a possibly-string numeric to a number BUT preserve null/undefined.
 * Used for cost_coverage_pct so a not-verified month stays null (CANNOT-VERIFY)
 * instead of becoming a misleading 0/100. (F5)
 */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

export function useInvestorProfitEfficiency(): UseInvestorProfitEfficiencyReturn {
  const [rows, setRows] = useState<InvestorProfitEfficiencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('get_investor_margin_by_month', {
        p_start: null,
        p_end: null,
      });
      if (!active) return;
      if (rpcError) {
        setError(rpcError.message);
        setRows([]);
      } else {
        const mapped = (Array.isArray(data) ? data : []).map((r) => ({
          month: String(r.summary_month),
          combined_revenue_cents: num(r.combined_revenue_cents),
          timesheet_revenue_cents: num(r.timesheet_revenue_cents),
          labor_cost_cents: num(r.labor_cost_cents),
          all_in_profit_cents: num(r.all_in_profit_cents),
          all_in_margin_pct: num(r.all_in_margin_pct),
          ts_profit_cents: num(r.ts_profit_cents),
          ts_margin_pct: num(r.ts_margin_pct),
          cost_coverage_pct: numOrNull(r.cost_coverage_pct),
          resource_count: num(r.resource_count),
          revenue_per_resource_cents: num(r.revenue_per_resource_cents),
          profit_per_resource_cents: num(r.profit_per_resource_cents),
        }));
        setRows(mapped);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { rows, loading, error };
}

export default useInvestorProfitEfficiency;
