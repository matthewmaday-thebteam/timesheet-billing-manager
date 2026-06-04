/**
 * useInvestorRevenueMix — Revenue-mix (SLA model) and trailing recurring
 * run-rate for the Investor Dashboard, computed entirely in the database.
 *
 * Calls get_investor_revenue_mix(p_start, p_end). ALL calculations happen in
 * SQL; this hook maps the per-month rows into the agreed contract shape and
 * coerces Postgres bigint/numeric (string|number) to numbers — no browser math
 * beyond that cents→number coercion.
 *
 * SLA buckets (per migration 123): recurring = SLA/timesheet hourly revenue +
 * recurring fixed billings (subscription/service_fee/license); one_off =
 * milestone overrides (delivery) + unlinked revenue_milestone billings;
 * reimbursement = pass-through. By construction
 * recurring + one_off + reimbursement == combined per month.
 *
 * recurring_run_rate_cents is a trailing-average estimate of the ongoing
 * recurring base (AVG of recurring_cents over the last 3 completed months);
 * it is identical on every row, so it is read off the first row.
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
  one_off_cents: number;
  reimbursement_cents: number;
  combined_cents: number;
}

export interface UseInvestorRevenueMixReturn {
  byMonth: InvestorRevenueMixMonth[];
  /**
   * Trailing-average estimate of the ongoing recurring base = AVG of
   * recurring_cents over the last 3 completed months (fewer if less data).
   * Identical on every RPC row; read off the first row.
   */
  recurring_run_rate_cents: number;
  loading: boolean;
  error: string | null;
}

/** Coerce a possibly-string numeric (Postgres bigint/numeric) to a number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

interface RevenueMixRpcRow {
  summary_month: string;
  recurring_cents: number | string | null;
  one_off_cents: number | string | null;
  reimbursement_cents: number | string | null;
  combined_cents: number | string | null;
  reconciliation_delta_cents: number | string | null;
  recurring_run_rate_cents: number | string | null;
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
        const rows = (Array.isArray(data) ? data : []) as RevenueMixRpcRow[];
        setByMonth(
          rows.map((r) => ({
            month: String(r.summary_month),
            recurring_cents: num(r.recurring_cents),
            one_off_cents: num(r.one_off_cents),
            reimbursement_cents: num(r.reimbursement_cents),
            combined_cents: num(r.combined_cents),
          })),
        );
        setRunRate(rows.length > 0 ? num(rows[0].recurring_run_rate_cents) : 0);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { byMonth, recurring_run_rate_cents: runRate, loading, error };
}

export default useInvestorRevenueMix;
