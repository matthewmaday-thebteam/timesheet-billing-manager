/**
 * useInvestorRevenueMix — Revenue-mix and committed run-rate series for the
 * Investor Dashboard, computed entirely in the database.
 *
 * Calls get_investor_revenue_mix(p_start, p_end). ALL calculations happen in
 * SQL; this hook splits the per-month rows into the agreed contract shape and
 * maps Postgres bigint/numeric (string|number) to numbers. The committed run
 * rate is identical on every row, so it is read off the first row.
 *
 * Return shape is the agreed FRONTEND/BACKEND CONTRACT and must not change.
 *
 * @official 2026-06-04
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface InvestorRevenueMixMonth {
  month: string;
  recurring_cents: number;
  project_cents: number;
  one_time_cents: number;
  reimbursement_cents: number;
  combined_cents: number;
  /**
   * F1 reconciliation residual = combined − (project+recurring+one_time+
   * reimbursement). Expected 0 when buckets are sourced consistently; surfaced
   * (never folded into project_cents) so a non-zero delta is observable. Additive
   * field — the page contract (month/recurring/project/one_time/reimbursement/
   * combined + run rate) is unchanged.
   */
  reconciliation_delta_cents: number;
}

export interface UseInvestorRevenueMixReturn {
  byMonth: InvestorRevenueMixMonth[];
  committed_monthly_run_rate_cents: number;
  loading: boolean;
  error: string | null;
}

/** Coerce a possibly-string numeric (Postgres bigint/numeric) to a number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

export function useInvestorRevenueMix(): UseInvestorRevenueMixReturn {
  const [byMonth, setByMonth] = useState<InvestorRevenueMixMonth[]>([]);
  const [runRate, setRunRate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('get_investor_revenue_mix', {
        p_start: null,
        p_end: null,
      });
      if (!active) return;
      if (rpcError) {
        setError(rpcError.message);
        setByMonth([]);
        setRunRate(0);
      } else {
        const rows = Array.isArray(data) ? data : [];
        setByMonth(
          rows.map((r) => ({
            month: String(r.summary_month),
            recurring_cents: num(r.recurring_cents),
            project_cents: num(r.project_cents),
            one_time_cents: num(r.one_time_cents),
            reimbursement_cents: num(r.reimbursement_cents),
            combined_cents: num(r.combined_cents),
            reconciliation_delta_cents: num(r.reconciliation_delta_cents),
          })),
        );
        setRunRate(rows.length > 0 ? num(rows[0].committed_monthly_run_rate_cents) : 0);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { byMonth, committed_monthly_run_rate_cents: runRate, loading, error };
}

export default useInvestorRevenueMix;
