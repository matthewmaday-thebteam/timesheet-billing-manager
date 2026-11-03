// =============================================================================
// Invoiced-month lock — the gate in front of every EOM report write
// =============================================================================
// A company-month is "locked" once it has been invoiced
// (`is_company_month_locked(p_company_id, p_month)`, owned by the DB layer).
// A locked month's eom_reports row and storage CSV are the invoiced record and
// must never be overwritten by this function:
//
//   backfill               -> locked company-months are skipped
//   { year, month }        -> locked companies are skipped
//   { year, month, cid }   -> 409, with a message pointing at the lock override
//
// A lock check that ERRORS is never read as "open": it becomes a failed
// result (which raises eom_report_failed) or a 500 — no silent fallback.
// =============================================================================

import type { RpcClient } from '../../_shared/billingAlerts.ts';

export interface CompanyMonth {
  companyId: string;
  year: number;
  month: number;
}

/** 'YYYY-MM' — the month half of the eom_report_failed entity_id. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 'YYYY-MM-01' — the `date` form the billing RPCs take. */
export function monthStartDate(year: number, month: number): string {
  return `${monthKey(year, month)}-01`;
}

/** Resolves true/false, or throws with context. Never guesses. */
export type IsMonthLockedFn = (companyId: string, year: number, month: number) => Promise<boolean>;

/** Binds `is_company_month_locked(p_company_id uuid, p_month date) returns boolean`. */
export function makeIsCompanyMonthLocked(client: RpcClient): IsMonthLockedFn {
  return async (companyId, year, month) => {
    const pMonth = monthStartDate(year, month);
    const { data, error } = await client.rpc('is_company_month_locked', {
      p_company_id: companyId,
      p_month: pMonth,
    });
    if (error) {
      throw new Error(`is_company_month_locked(${companyId}, ${pMonth}): ${error.message}`);
    }
    if (typeof data !== 'boolean') {
      throw new Error(
        `is_company_month_locked(${companyId}, ${pMonth}) returned ${JSON.stringify(data)}, expected boolean`,
      );
    }
    return data;
  };
}

export type LockState =
  | { kind: 'open' }
  | { kind: 'locked' }
  | { kind: 'error'; message: string };

export async function checkMonthLock(isLocked: IsMonthLockedFn, cm: CompanyMonth): Promise<LockState> {
  try {
    return (await isLocked(cm.companyId, cm.year, cm.month)) ? { kind: 'locked' } : { kind: 'open' };
  } catch (err) {
    return { kind: 'error', message: `Lock check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Carried on a 'skipped' result so callers can tell a lock from "no data". */
export const MONTH_LOCKED_SKIP_REASON = 'month_locked';

export const MONTH_LOCKED_SKIP_MESSAGE =
  'Month is locked (invoiced) — existing report preserved, nothing regenerated';

/** The 409 body for an explicit regenerate of a locked company-month. */
export function lockedRegenerateRefusal(
  companyLabel: string,
  year: number,
  month: number,
): { status: 409; body: { error: string; reason: typeof MONTH_LOCKED_SKIP_REASON } } {
  return {
    status: 409,
    body: {
      error:
        `The ${monthKey(year, month)} report for ${companyLabel} cannot be regenerated: the month is ` +
        `locked because it has been invoiced, and its report is the invoiced record. ` +
        `If a regeneration is genuinely required, apply a billing lock override for this ` +
        `company-month in the database first.`,
      reason: MONTH_LOCKED_SKIP_REASON,
    },
  };
}
