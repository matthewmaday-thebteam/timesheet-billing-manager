/**
 * useBilling - Wrapper hook that delegates between frontend and summary billing.
 *
 * Always calls BOTH hooks (React rules — no conditional calls).
 * Returns data from the active source based on BillingSourceContext mode.
 *
 * In 'parallel' mode: returns frontend data but logs any discrepancies to console.
 *
 * @official 2026-02-10
 */

import { useMemo } from 'react';
import { useUnifiedBilling, type UnmatchedProject } from './useUnifiedBilling';
import { useSummaryBilling } from './useSummaryBilling';
import { useBillingSource, type BillingSource } from '../contexts/BillingSourceContext';
import type { MonthlyBillingResult, CompanyInput } from '../utils/billingCalculations';
import type { TimesheetEntry, ProjectRateDisplayWithBilling, MonthSelection } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface UseBillingParams {
  /** Raw timesheet entries (needed for frontend mode) */
  entries: TimesheetEntry[];
  /** Projects with billing configuration (needed for frontend mode) */
  projectsWithRates: ProjectRateDisplayWithBilling[];
  /** Canonical ID lookup (needed for frontend mode) */
  projectCanonicalIdLookup?: Map<string, string>;
  /** Selected month (needed for summary mode) */
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
  /** Billing inputs (frontend mode only, empty array in summary mode) */
  billingInputs: CompanyInput[];
  /** Unmatched projects (frontend mode only, empty in summary mode) */
  unmatchedProjects: UnmatchedProject[];
  /** Whether all projects matched (always true in summary mode) */
  allProjectsMatched: boolean;
  /** Which source is active */
  source: BillingSource;
  /** Whether the active source is loading (always false for frontend) */
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
  entries,
  projectsWithRates,
  projectCanonicalIdLookup,
  selectedMonth,
}: UseBillingParams): UseBillingResult {
  const { source } = useBillingSource();

  // Always call both hooks (React rules — no conditional calls)
  const frontend = useUnifiedBilling({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
  });

  const summary = useSummaryBilling({ selectedMonth });

  // Log discrepancies in parallel mode
  useMemo(() => {
    if (source !== 'parallel') return;
    if (summary.isLoading || !summary.billingResult) return;

    const feRevenue = frontend.totalRevenue;
    const suRevenue = summary.totalRevenue;
    const feHours = frontend.totalBilledHours;
    const suHours = summary.totalBilledHours;

    const revenueDiff = Math.abs(feRevenue - suRevenue);
    const hoursDiff = Math.abs(feHours - suHours);

    if (revenueDiff > 0.005 || hoursDiff > 0.005) {
      console.warn(
        '[useBilling] PARALLEL MODE DISCREPANCY:',
        {
          revenue: { frontend: feRevenue, summary: suRevenue, diff: feRevenue - suRevenue },
          hours: { frontend: feHours, summary: suHours, diff: feHours - suHours },
        }
      );
    } else {
      console.debug('[useBilling] Parallel mode: frontend and summary match.');
    }
  }, [source, frontend.totalRevenue, frontend.totalBilledHours, summary.totalRevenue, summary.totalBilledHours, summary.isLoading, summary.billingResult]);

  // Return data from the active source
  if (source === 'summary') {
    return {
      billingResult: summary.billingResult ?? EMPTY_BILLING_RESULT,
      totalRevenue: summary.totalRevenue,
      totalBilledHours: summary.totalBilledHours,
      totalActualHours: summary.totalActualHours,
      billingInputs: [],
      unmatchedProjects: [],
      allProjectsMatched: true,
      source: 'summary',
      isLoading: summary.isLoading,
    };
  }

  // 'frontend' or 'parallel' — return frontend data
  return {
    billingResult: frontend.billingResult,
    totalRevenue: frontend.totalRevenue,
    totalBilledHours: frontend.totalBilledHours,
    totalActualHours: frontend.totalActualHours,
    billingInputs: frontend.billingInputs,
    unmatchedProjects: frontend.unmatchedProjects,
    allProjectsMatched: frontend.allProjectsMatched,
    source: source === 'parallel' ? 'frontend' : 'frontend',
    isLoading: false,
  };
}
