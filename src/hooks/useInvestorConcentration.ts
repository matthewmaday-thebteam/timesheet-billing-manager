/**
 * useInvestorConcentration — Client concentration series for the Investor
 * Dashboard, computed entirely in the database.
 *
 * Calls get_investor_concentration(p_start, p_end, p_top_n). The RPC returns a
 * single result set discriminated by row_kind ('trend' | 'breakdown' | 'ytd');
 * this hook splits it into the agreed contract shape { byMonth, latest, ytd }
 * and maps Postgres numerics to numbers. No arithmetic beyond that mapping.
 *
 * Return shape is the agreed FRONTEND/BACKEND CONTRACT and must not change.
 *
 * @official 2026-06-04
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface InvestorConcentrationMonth {
  month: string;
  top1_pct: number;
  top5_pct: number;
}

export interface InvestorConcentrationCompany {
  company_name: string;
  revenue_cents: number;
  pct: number;
}

export interface InvestorConcentrationYtd {
  top1_pct: number;
  top5_pct: number;
}

export interface UseInvestorConcentrationReturn {
  byMonth: InvestorConcentrationMonth[];
  latest: InvestorConcentrationCompany[];
  ytd: InvestorConcentrationYtd;
  loading: boolean;
  error: string | null;
}

/** Coerce a possibly-string numeric (Postgres bigint/numeric) to a number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

interface ConcentrationRpcRow {
  row_kind: string;
  summary_month: string;
  company_name: string | null;
  revenue_cents: number | string | null;
  pct: number | string | null;
  top1_pct: number | string | null;
  top5_pct: number | string | null;
  total_revenue_cents: number | string | null;
}

export function useInvestorConcentration(): UseInvestorConcentrationReturn {
  const [byMonth, setByMonth] = useState<InvestorConcentrationMonth[]>([]);
  const [latest, setLatest] = useState<InvestorConcentrationCompany[]>([]);
  const [ytd, setYtd] = useState<InvestorConcentrationYtd>({ top1_pct: 0, top5_pct: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('get_investor_concentration', {
        p_start: null,
        p_end: null,
      });
      if (!active) return;
      if (rpcError) {
        setError(rpcError.message);
        setByMonth([]);
        setLatest([]);
        setYtd({ top1_pct: 0, top5_pct: 0 });
      } else {
        const rows = (Array.isArray(data) ? data : []) as ConcentrationRpcRow[];
        setByMonth(
          rows
            .filter((r) => r.row_kind === 'trend')
            .map((r) => ({
              month: String(r.summary_month),
              top1_pct: num(r.top1_pct),
              top5_pct: num(r.top5_pct),
            })),
        );
        setLatest(
          rows
            .filter((r) => r.row_kind === 'breakdown')
            .map((r) => ({
              company_name: r.company_name ?? 'Unknown',
              revenue_cents: num(r.revenue_cents),
              pct: num(r.pct),
            })),
        );
        const ytdRow = rows.find((r) => r.row_kind === 'ytd');
        setYtd({
          top1_pct: num(ytdRow?.top1_pct),
          top5_pct: num(ytdRow?.top5_pct),
        });
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { byMonth, latest, ytd, loading, error };
}

export default useInvestorConcentration;
