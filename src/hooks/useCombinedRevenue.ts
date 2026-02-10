/**
 * useCombinedRevenue - Wrapper that delegates between frontend and summary
 * combined revenue hooks.
 *
 * Same delegation pattern as useBilling:
 * - Always calls both hooks (React rules)
 * - Returns data from the active source based on BillingSourceContext
 * - In 'parallel' mode: returns frontend data, logs discrepancies
 *
 * @official 2026-02-10
 */

import { useMemo } from 'react';
import { useCombinedRevenueByMonth } from './useCombinedRevenueByMonth';
import { useSummaryCombinedRevenueByMonth } from './useSummaryCombinedRevenueByMonth';
import { useBillingSource } from '../contexts/BillingSourceContext';
import type { TimesheetEntry, DateRange } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface UseCombinedRevenueParams {
  /** Date range for the current month */
  dateRange: DateRange;
  /** Number of historical months for charts */
  extendedMonths: number;
  /** Extended entries covering the full chart range (needed for frontend mode) */
  extendedEntries: TimesheetEntry[];
  /** Canonical ID lookup (needed for frontend mode) */
  projectCanonicalIdLookup?: Map<string, string>;
}

// ============================================================================
// HOOK
// ============================================================================

export function useCombinedRevenue({
  dateRange,
  extendedMonths,
  extendedEntries,
  projectCanonicalIdLookup,
}: UseCombinedRevenueParams): {
  combinedRevenueByMonth: Map<string, number>;
  loading: boolean;
} {
  const { source } = useBillingSource();

  // Always call both hooks (React rules — no conditional calls)
  const frontend = useCombinedRevenueByMonth({
    dateRange,
    extendedMonths,
    extendedEntries,
    projectCanonicalIdLookup,
  });

  const summary = useSummaryCombinedRevenueByMonth({
    dateRange,
    extendedMonths,
  });

  // Log discrepancies in parallel mode
  useMemo(() => {
    if (source !== 'parallel') return;
    if (frontend.loading || summary.loading) return;

    const feMap = frontend.combinedRevenueByMonth;
    const suMap = summary.combinedRevenueByMonth;

    // Collect all month keys
    const allKeys = new Set([...feMap.keys(), ...suMap.keys()]);
    const discrepancies: Array<{ month: string; frontend: number; summary: number; diff: number }> = [];

    for (const key of allKeys) {
      const feVal = feMap.get(key) ?? 0;
      const suVal = suMap.get(key) ?? 0;
      if (Math.abs(feVal - suVal) > 0.50) { // $0.50 tolerance for rounding across many projects
        discrepancies.push({ month: key, frontend: feVal, summary: suVal, diff: feVal - suVal });
      }
    }

    if (discrepancies.length > 0) {
      console.warn('[useCombinedRevenue] PARALLEL MODE DISCREPANCIES:', discrepancies);
    } else {
      console.debug('[useCombinedRevenue] Parallel mode: all months match.');
    }
  }, [source, frontend.combinedRevenueByMonth, frontend.loading, summary.combinedRevenueByMonth, summary.loading]);

  // Return data from the active source
  if (source === 'summary') {
    return {
      combinedRevenueByMonth: summary.combinedRevenueByMonth,
      loading: summary.loading,
    };
  }

  // 'frontend' or 'parallel' — return frontend data
  return {
    combinedRevenueByMonth: frontend.combinedRevenueByMonth,
    loading: frontend.loading,
  };
}
