// =============================================================================
// Zero-week classification
// =============================================================================
// A company-week that produced no timesheet entries is either:
//
//   'expected'  — the company legitimately logged nothing (paused client,
//                 company-wide holiday, a project only just opted in). Silent.
//   'anomalous' — the company was actively logging hours until now, so an
//                 empty week means something broke upstream. Loud.
//
// This is the exact distinction that was missing on 2026-09-10, when a ClickUp
// permission change blanked four weeks of attribution and the weekly report
// simply skipped the affected company with a bare `continue` — no row, no
// error, and a successful return code. Nothing alerted for four weeks.
//
// Kept pure and dependency-free so it can be unit tested with the project's
// node --test runner. The send-weekly-revenue-report edge function carries a
// replicated copy (Deno cannot import from src/), following the same
// convention as the billing helpers replicated from src/utils/billing.ts.
// Keep the two in sync; the tests here are the specification.
// =============================================================================

export type ZeroWeekClassification = 'expected' | 'anomalous';

/** Hours reported in each of the prior weeks that has a weekly_reports row. */
export type PriorWeekHours = readonly number[];

/** How many of the prior weeks actually reported hours. */
export function countWeeksWithHours(priorWeekHours: PriorWeekHours): number {
  return priorWeekHours.reduce((count, hours) => (hours > 0 ? count + 1 : count), 0);
}

/** Total hours across the prior weeks, rounded to 2dp for display. */
export function sumPriorWeekHours(priorWeekHours: PriorWeekHours): number {
  const total = priorWeekHours.reduce((sum, hours) => sum + (hours > 0 ? hours : 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Classify a company-week that produced no entries.
 *
 * Any prior week with hours makes today's silence anomalous. No prior week
 * with hours — including no history at all, which is a newly enabled company —
 * makes it expected.
 */
export function classifyZeroWeek(priorWeekHours: PriorWeekHours): ZeroWeekClassification {
  return countWeeksWithHours(priorWeekHours) >= 1 ? 'anomalous' : 'expected';
}
