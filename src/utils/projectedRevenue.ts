/**
 * projectedRevenue - Pure utility for computing projected annual revenue.
 *
 * Extracts the IDENTICAL formula from InvestorDashboardPage.tsx so that both
 * the Dashboard and the Investor page produce the same number.
 *
 * Formula:
 *   projectedAnnualRevenue = ytdRevenue
 *     + (avgDailyRevenue * remainingYearWorkdays)
 *     - (ftVacationDays * 8 * avgRate)
 *     - (ptVacationDays * 5 * avgRate)
 *
 * @official 2026-04-04
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ProjectedRevenueInputs {
  /** Year-to-date combined revenue in dollars */
  ytdRevenue: number;
  /** Average daily earned revenue (through yesterday) in dollars */
  avgDailyRevenue: number;
  /** Remaining workdays from today through Dec 31, excluding weekends and holidays */
  remainingYearWorkdays: number;
  /** Remaining full-time employee PTO working days (rest of year) */
  ftVacationDays: number;
  /** Remaining part-time employee PTO working days (rest of year) */
  ptVacationDays: number;
  /** Average billing rate across projects with rate > 0 (dollars/hour) */
  avgRate: number;
}

// ============================================================================
// PURE FUNCTION
// ============================================================================

/**
 * Calculate projected annual revenue using the shared formula.
 *
 * This is a pure function with no side effects. It can be unit-tested
 * independently of React hooks and Supabase.
 *
 * @param inputs - All intermediate values needed for the calculation
 * @returns Projected annual revenue in dollars
 */
export function calculateProjectedAnnualRevenue(inputs: ProjectedRevenueInputs): number {
  const {
    ytdRevenue,
    avgDailyRevenue,
    remainingYearWorkdays,
    ftVacationDays,
    ptVacationDays,
    avgRate,
  } = inputs;

  return (
    ytdRevenue
    + (avgDailyRevenue * remainingYearWorkdays)
    - (ftVacationDays * 8 * avgRate)
    - (ptVacationDays * 5 * avgRate)
  );
}
