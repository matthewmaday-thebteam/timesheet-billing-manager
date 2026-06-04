/**
 * useInvestorUtilization — Utilization (include-contractors basis) series for
 * the Investor Dashboard, computed entirely in the database.
 *
 * Calls get_investor_utilization_by_month(p_start, p_end). ALL calculations
 * happen in SQL; this hook only fetches ready-to-render rows and maps Postgres
 * numerics (string|number) to numbers.
 *
 * This is the INCLUDE-CONTRACTORS basis and intentionally differs from the
 * page's existing FT+PT-only inline utilization number (which is NOT modified).
 *
 * Return shape is the agreed FRONTEND/BACKEND CONTRACT and must not change.
 *
 * @official 2026-06-04
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface InvestorUtilizationRow {
  month: string;
  utilization_pct: number;
  worked_hours: number;
  available_hours: number;
  resource_count: number;
}

export interface UseInvestorUtilizationReturn {
  rows: InvestorUtilizationRow[];
  loading: boolean;
  error: string | null;
}

/** Coerce a possibly-string numeric (Postgres bigint/numeric) to a number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

export function useInvestorUtilization(): UseInvestorUtilizationReturn {
  const [rows, setRows] = useState<InvestorUtilizationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('get_investor_utilization_by_month', {
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
          utilization_pct: num(r.utilization_pct),
          worked_hours: num(r.worked_hours),
          available_hours: num(r.available_hours),
          resource_count: num(r.resource_count),
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

export default useInvestorUtilization;
