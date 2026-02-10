/**
 * useSummaryBilling - Read billing results from project_monthly_summary table
 *
 * This hook reads pre-calculated billing results from the database summary table
 * and formats them to match the same MonthlyBillingResult shape used by
 * useUnifiedBilling (which calculates in the browser).
 *
 * Purpose: Shadow-read hook for comparing database-calculated billing against
 * frontend-calculated billing during the migration from Task 033.
 *
 * @official 2026-02-10
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { roundHours, roundCurrency } from '../utils/billing';
import type {
  MonthlyBillingResult,
  CompanyBillingResult,
  ProjectBillingResult,
} from '../utils/billingCalculations';
import type { MonthSelection, RoundingIncrement } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/** Raw row from project_monthly_summary joined with projects and companies */
interface SummaryRow {
  id: string;
  summary_month: string;
  project_id: string;
  company_id: string;

  // Hours
  actual_minutes: number;
  rounded_minutes: number;
  actual_hours: number;
  rounded_hours: number;
  carryover_in_hours: number;
  adjusted_hours: number;
  billed_hours: number;
  unbillable_hours: number;
  carryover_out_hours: number;
  minimum_padding_hours: number;

  // Flags
  minimum_applied: boolean;
  maximum_applied: boolean;
  has_billing_limits: boolean;
  is_active_used: boolean;

  // Revenue (cents)
  base_revenue_cents: number;
  billed_revenue_cents: number;

  // Config snapshot
  rate_used: number;
  rate_source: string;
  rounding_used: number;
  minimum_hours_config: number | null;
  maximum_hours_config: number | null;
  carryover_enabled_config: boolean;

  // Metadata
  resource_count: number;
  task_count: number;
  source_entry_count: number;
  calculated_at: string;
  calculation_version: string;

  // Joined fields
  projects: {
    project_name: string;
    project_id: string; // external project_id
  };
  companies: {
    client_id: string;
    client_name: string;
    display_name: string | null;
  };
}

interface UseSummaryBillingOptions {
  selectedMonth: MonthSelection;
}

interface UseSummaryBillingReturn {
  /** Billing result in the same shape as useUnifiedBilling */
  billingResult: MonthlyBillingResult | null;
  /** Total billed revenue (dollars, not cents) */
  totalRevenue: number;
  /** Total billed hours */
  totalBilledHours: number;
  /** Total actual hours */
  totalActualHours: number;
  /** Raw summary rows (for detailed inspection) */
  summaryRows: SummaryRow[];
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Re-fetch data */
  refetch: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatMonthAsISO(month: MonthSelection): string {
  const yyyy = month.year;
  const mm = String(month.month).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

/**
 * Convert a SummaryRow to ProjectBillingResult shape.
 * Revenue is converted from cents to dollars.
 */
function rowToProjectResult(row: SummaryRow): ProjectBillingResult {
  return {
    projectId: row.projects.project_id, // external project_id
    projectName: row.projects.project_name,

    actualMinutes: row.actual_minutes,
    roundedMinutes: row.rounded_minutes,
    actualHours: Number(row.actual_hours),
    roundedHours: Number(row.rounded_hours),

    carryoverIn: Number(row.carryover_in_hours),
    adjustedHours: Number(row.adjusted_hours),
    billedHours: Number(row.billed_hours),
    unbillableHours: Number(row.unbillable_hours),
    carryoverOut: Number(row.carryover_out_hours),
    minimumPadding: Number(row.minimum_padding_hours),

    minimumApplied: row.minimum_applied,
    maximumApplied: row.maximum_applied,
    hasBillingLimits: row.has_billing_limits,

    baseRevenue: roundCurrency(row.base_revenue_cents / 100),
    billedRevenue: roundCurrency(row.billed_revenue_cents / 100),

    rate: Number(row.rate_used),
    rounding: row.rounding_used as RoundingIncrement,

    // Summary table doesn't store task-level breakdown
    tasks: [],
    billingResult: null,
  };
}

// ============================================================================
// HOOK
// ============================================================================

export function useSummaryBilling({
  selectedMonth,
}: UseSummaryBillingOptions): UseSummaryBillingReturn {
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const monthStr = formatMonthAsISO(selectedMonth);

      const { data, error: queryError } = await supabase
        .from('project_monthly_summary')
        .select(`
          *,
          projects!inner (project_name, project_id),
          companies!inner (client_id, client_name, display_name)
        `)
        .eq('summary_month', monthStr)
        .order('company_id')
        .order('project_id');

      if (queryError) throw queryError;

      setSummaryRows((data as SummaryRow[]) || []);
    } catch (err) {
      console.error('Error fetching summary billing:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch summary billing');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Transform summary rows into MonthlyBillingResult shape
  const billingResult = useMemo<MonthlyBillingResult | null>(() => {
    if (summaryRows.length === 0) return null;

    // Group rows by company client_id (external ID, matches useUnifiedBilling grouping)
    const companyMap = new Map<string, {
      companyId: string;
      companyName: string;
      rows: SummaryRow[];
    }>();

    for (const row of summaryRows) {
      const clientId = row.companies.client_id;
      if (!companyMap.has(clientId)) {
        companyMap.set(clientId, {
          companyId: clientId,
          companyName: row.companies.display_name || row.companies.client_name,
          rows: [],
        });
      }
      companyMap.get(clientId)!.rows.push(row);
    }

    // Build company results
    const companies: CompanyBillingResult[] = [];

    for (const [, companyData] of companyMap) {
      const projectResults = companyData.rows.map(rowToProjectResult);

      const companyResult: CompanyBillingResult = {
        companyId: companyData.companyId,
        companyName: companyData.companyName,

        actualMinutes: projectResults.reduce((s, p) => s + p.actualMinutes, 0),
        roundedMinutes: projectResults.reduce((s, p) => s + p.roundedMinutes, 0),
        actualHours: roundHours(projectResults.reduce((s, p) => s + p.actualHours, 0)),
        roundedHours: roundHours(projectResults.reduce((s, p) => s + p.roundedHours, 0)),
        adjustedHours: roundHours(projectResults.reduce((s, p) => s + p.adjustedHours, 0)),
        billedHours: roundHours(projectResults.reduce((s, p) => s + p.billedHours, 0)),
        unbillableHours: roundHours(projectResults.reduce((s, p) => s + p.unbillableHours, 0)),

        baseRevenue: roundCurrency(projectResults.reduce((s, p) => s + p.baseRevenue, 0)),
        billedRevenue: roundCurrency(projectResults.reduce((s, p) => s + p.billedRevenue, 0)),

        projects: projectResults,
      };

      companies.push(companyResult);
    }

    // Build monthly result
    const result: MonthlyBillingResult = {
      actualMinutes: companies.reduce((s, c) => s + c.actualMinutes, 0),
      roundedMinutes: companies.reduce((s, c) => s + c.roundedMinutes, 0),
      actualHours: roundHours(companies.reduce((s, c) => s + c.actualHours, 0)),
      roundedHours: roundHours(companies.reduce((s, c) => s + c.roundedHours, 0)),
      adjustedHours: roundHours(companies.reduce((s, c) => s + c.adjustedHours, 0)),
      billedHours: roundHours(companies.reduce((s, c) => s + c.billedHours, 0)),
      unbillableHours: roundHours(companies.reduce((s, c) => s + c.unbillableHours, 0)),

      baseRevenue: roundCurrency(companies.reduce((s, c) => s + c.baseRevenue, 0)),
      billedRevenue: roundCurrency(companies.reduce((s, c) => s + c.billedRevenue, 0)),

      companies,
    };

    return result;
  }, [summaryRows]);

  const totalRevenue = billingResult?.billedRevenue ?? 0;
  const totalBilledHours = billingResult?.billedHours ?? 0;
  const totalActualHours = billingResult?.actualHours ?? 0;

  return {
    billingResult,
    totalRevenue,
    totalBilledHours,
    totalActualHours,
    summaryRows,
    isLoading,
    error,
    refetch: fetchSummary,
  };
}

export default useSummaryBilling;
