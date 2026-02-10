/**
 * useBilling - Reads billing data from the summary table.
 *
 * Delegates to useSummaryBilling which reads from project_monthly_summary.
 * The frontend billing engine (useUnifiedBilling) has been removed.
 *
 * @official 2026-02-10
 */

import { useSummaryBilling } from './useSummaryBilling';
import type { MonthlyBillingResult } from '../utils/billingCalculations';
import type { MonthSelection } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface UseBillingParams {
  /** Selected month */
  selectedMonth: MonthSelection;
}

interface UseBillingResult {
  /** Complete billing result */
  billingResult: MonthlyBillingResult;
  /** Total billed revenue */
  totalRevenue: number;
  /** Total billed hours */
  totalBilledHours: number;
  /** Total actual hours */
  totalActualHours: number;
  /** Whether the data is still loading */
  isLoading: boolean;
}

// ============================================================================
// EMPTY BILLING RESULT (used when summary returns null)
// ============================================================================

const EMPTY_BILLING_RESULT: MonthlyBillingResult = {
  actualMinutes: 0,
  roundedMinutes: 0,
  actualHours: 0,
  roundedHours: 0,
  adjustedHours: 0,
  billedHours: 0,
  unbillableHours: 0,
  baseRevenue: 0,
  billedRevenue: 0,
  companies: [],
};

// ============================================================================
// HOOK
// ============================================================================

export function useBilling({
  selectedMonth,
}: UseBillingParams): UseBillingResult {
  const summary = useSummaryBilling({ selectedMonth });

  return {
    billingResult: summary.billingResult ?? EMPTY_BILLING_RESULT,
    totalRevenue: summary.totalRevenue,
    totalBilledHours: summary.totalBilledHours,
    totalActualHours: summary.totalActualHours,
    isLoading: summary.isLoading,
  };
}
