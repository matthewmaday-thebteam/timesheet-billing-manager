// =============================================================================
// parseTimeOffDays — BambooHR time-off request amount -> days
// =============================================================================
// BambooHR reports a request's amount as `{ unit: 'days' | 'hours', amount }`
// (amount is usually a numeric string). Some policies (e.g. Parental) are
// tracked in HOURS, so the unit must be honoured: employee_time_off.total_days
// is numeric(5,2) and stores days.
//
//   bare number / numeric string -> days, unchanged (legacy shape)
//   unit 'days'                  -> days, unchanged
//   unit 'hours'                 -> hours / 8, rounded to 2 decimals
//   any other or missing unit    -> throws (no silent fallback)
//
// A missing/empty amount is 0, matching the previous inline parsing.
// =============================================================================

export const HOURS_PER_WORKDAY = 8;

type RawTimeOffAmount =
  | { unit?: unknown; amount?: number | string | null }
  | number
  | string
  | null
  | undefined;

export function parseTimeOffDays(rawAmount: unknown, requestId: unknown): number {
  const reqAmount = rawAmount as RawTimeOffAmount;
  if (typeof reqAmount !== 'object' || reqAmount === null) {
    return Number(reqAmount || 0);
  }

  const amount = Number(reqAmount.amount || 0);
  switch (reqAmount.unit) {
    case 'days':
      return amount;
    case 'hours':
      return Math.round((amount / HOURS_PER_WORKDAY) * 100) / 100;
    default:
      throw new Error(
        `BambooHR time-off request ${String(requestId)} has unsupported amount unit ` +
        `${JSON.stringify(reqAmount.unit)} (expected "days" or "hours")`,
      );
  }
}
