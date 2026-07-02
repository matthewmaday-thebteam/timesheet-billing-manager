// =============================================================================
// convertToUsd — USD REPORTING layer. ADDITIVE over the EUR normalization layer;
// it NEVER changes or re-reads any EUR/bank math.
// =============================================================================
// Manifest reports in USD, but EUR stays the bank-truth normalization layer. USD
// is derived from the already-normalized EUR amount using a MONTH-DEPENDENT
// EUR→USD rate (expense_fx_rates, keyed by the value-date-derived assigned_month):
//
//     usd_amount = round2(eur_amount × eur_usd)
//
// The rate is month-dependent because the books apply the ECB monthly-average
// EUR/USD rate for the transaction's month (a partial-month daily average for
// the current, not-yet-published month). round2 (half away from zero) is reused
// from convertToEur so the USD and EUR layers round identically — the DB-side
// self-healing fill (fill_pending_usd) uses the equivalent round(x, 2), so every
// row's USD is round(eur_amount × eur_usd, 2) whichever path computed it.
//
// PURE + framework-free. Shared BY COPY with the ingest-expenses edge function
// (supabase/functions/ingest-expenses/_lib). Keep the two copies byte-identical.
// =============================================================================

import { round2 } from './convertToEur.ts';
import type { UsdConversion } from './types.ts';

export function convertToUsd(eurAmount: number, eurUsd: number): UsdConversion {
  return { usdAmount: round2(eurAmount * eurUsd), usdRate: eurUsd };
}
