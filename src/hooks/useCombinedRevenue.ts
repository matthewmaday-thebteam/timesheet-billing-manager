/**
 * useCombinedRevenue - Reads combined revenue from the summary table.
 *
 * Delegates to useSummaryCombinedRevenueByMonth which queries
 * v_combined_revenue_by_company_month.
 * The frontend multi-month calculator (useCombinedRevenueByMonth) has been removed.
 *
 * @official 2026-02-10
 */

import { useSummaryCombinedRevenueByMonth } from './useSummaryCombinedRevenueByMonth';
import type { DateRange } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface UseCombinedRevenueParams {
  /** Date range for the current month */
  dateRange: DateRange;
  /** Number of historical months for charts */
  extendedMonths: number;
}

// ============================================================================
// HOOK
// ============================================================================

export function useCombinedRevenue({
  dateRange,
  extendedMonths,
}: UseCombinedRevenueParams): {
  combinedRevenueByMonth: Map<string, number>;
  loading: boolean;
} {
  return useSummaryCombinedRevenueByMonth({
    dateRange,
    extendedMonths,
  });
}
