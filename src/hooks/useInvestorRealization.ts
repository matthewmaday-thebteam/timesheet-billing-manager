/**
 * useInvestorRealization — Realization and effective-rate series for the
 * Investor Dashboard, computed entirely in the database.
 *
 * Calls get_investor_realization_by_month(p_start, p_end). ALL calculations
 * happen in SQL; this hook only fetches ready-to-render rows and maps Postgres
 * bigint/numeric (string|number) to numbers. The RPC returns the hours
 * decomposition with `total_*` names; these are mapped to the contract's
 * shorter field names.
 *
 * Return shape is the agreed FRONTEND/BACKEND CONTRACT and must not change.
 *
 * @official 2026-06-04
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface InvestorRealizationRow {
  month: string;
  realization_pct: number;
  effective_rate_cents: number;
  minimum_padding_hours: number;
  unbillable_hours: number;
  carryover_out_hours: number;
  actual_hours: number;
  billed_hours: number;
}

export interface UseInvestorRealizationReturn {
  rows: InvestorRealizationRow[];
  loading: boolean;
  error: string | null;
}

/** Coerce a possibly-string numeric (Postgres bigint/numeric) to a number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

export function useInvestorRealization(): UseInvestorRealizationReturn {
  const [rows, setRows] = useState<InvestorRealizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('get_investor_realization_by_month', {
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
          realization_pct: num(r.realization_pct),
          effective_rate_cents: num(r.effective_rate_cents),
          minimum_padding_hours: num(r.total_minimum_padding_hours),
          unbillable_hours: num(r.total_unbillable_hours),
          carryover_out_hours: num(r.total_carryover_out_hours),
          actual_hours: num(r.total_actual_hours),
          billed_hours: num(r.total_billed_hours),
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

export default useInvestorRealization;
