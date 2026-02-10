/**
 * useCombinedRevenueByMonth - Computes combined revenue for each month in the chart range.
 *
 * Replicates the Revenue page's combinedTotalRevenue formula for all 12 months:
 *   combinedRevenue = totalRevenue + filteredBillingCents/100 + milestoneAdjustment
 *
 * Where:
 *   - totalRevenue = unified billing result using that month's effective rates
 *   - filteredBillingCents = billing transactions EXCLUDING linked milestones
 *   - milestoneAdjustment = (milestone amount - project timesheet revenue) for linked milestones
 *
 * @official 2026-02-09
 */

import { useState, useEffect, useMemo } from 'react';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from '../lib/supabase';
import {
  buildBillingInputs,
  calculateMonthlyBilling,
  DEFAULT_BILLING_CONFIG,
  type ProjectBillingConfig,
  type CanonicalCompanyResult,
} from '../utils/billingCalculations';
import { DEFAULT_ROUNDING_INCREMENT } from '../utils/billing';
import type { TimesheetEntry, ProjectRateDisplayWithBilling, RoundingIncrement, DateRange } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface BillingTransactionDetail {
  monthKey: string;
  amountCents: number;
  billingType: string;
  linkedProjectId: string | null;
}

interface UseCombinedRevenueByMonthParams {
  dateRange: DateRange;
  extendedMonths: number;
  extendedEntries: TimesheetEntry[];
  projectCanonicalIdLookup?: Map<string, string>;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Transform raw RPC result into ProjectRateDisplayWithBilling[].
 * Extracted from useMonthlyRates for reuse.
 */
function transformRateData(rows: Record<string, unknown>[]): ProjectRateDisplayWithBilling[] {
  return rows.map((row) => {
    let effectiveRounding: RoundingIncrement = 15;
    if (row.effective_rounding !== null && row.effective_rounding !== undefined) {
      const numValue = typeof row.effective_rounding === 'number'
        ? row.effective_rounding
        : Number(row.effective_rounding);
      if ([0, 5, 15, 30].includes(numValue)) {
        effectiveRounding = numValue as RoundingIncrement;
      }
    }

    return {
      projectId: row.project_id as string,
      externalProjectId: row.external_project_id as string,
      projectName: row.project_name as string,
      clientId: (row.client_id as string) || null,
      clientName: (row.client_name as string) || null,
      canonicalClientId: (row.canonical_client_id as string) || null,
      canonicalClientName: (row.canonical_client_name as string) || null,
      firstSeenMonth: (row.first_seen_month as string) || null,
      effectiveRate: row.effective_rate as number,
      source: (row.source as string) || 'default',
      sourceMonth: (row.source_month as string) || null,
      existedInSelectedMonth: row.existed_in_month as boolean,
      hasExplicitRateThisMonth: row.source === 'explicit',
      effectiveRounding,
      roundingSource: ((row.rounding_source as string) ?? 'default'),
      roundingSourceMonth: (row.rounding_source_month as string) || null,
      hasExplicitRoundingThisMonth: row.rounding_source === 'explicit',
      minimumHours: (row.minimum_hours as number) ?? null,
      maximumHours: (row.maximum_hours as number) ?? null,
      carryoverEnabled: (row.carryover_enabled as boolean) ?? false,
      carryoverMaxHours: (row.carryover_max_hours as number) ?? null,
      carryoverExpiryMonths: (row.carryover_expiry_months as number) ?? null,
      limitsSource: ((row.limits_source as string) ?? 'default'),
      limitsSourceMonth: (row.limits_source_month as string) ?? null,
      hasExplicitLimitsThisMonth: row.limits_source === 'explicit',
      isActive: (row.is_active as boolean) ?? true,
      activeSource: ((row.active_source as string) ?? 'default'),
      activeSourceMonth: (row.active_source_month as string) ?? null,
      hasExplicitActiveThisMonth: row.active_source === 'explicit',
      carryoverHoursIn: (row.carryover_hours_in as number) ?? 0,
      carryoverSources: [],
    } as ProjectRateDisplayWithBilling;
  });
}

/**
 * Compute unified billing for a set of entries and rates.
 * Replicates useUnifiedBilling's core logic as a pure function.
 */
function computeUnifiedBilling(
  entries: TimesheetEntry[],
  projectsWithRates: ProjectRateDisplayWithBilling[],
  projectCanonicalIdLookup?: Map<string, string>,
) {
  // Build billing config map
  const billingConfigByProjectId = new Map<string, ProjectBillingConfig>();
  for (const p of projectsWithRates) {
    if (p.externalProjectId) {
      billingConfigByProjectId.set(p.externalProjectId, {
        rate: p.effectiveRate,
        rounding: (p.effectiveRounding as RoundingIncrement) ?? DEFAULT_ROUNDING_INCREMENT,
        minimumHours: p.minimumHours,
        maximumHours: p.maximumHours,
        isActive: p.isActive,
        carryoverEnabled: p.carryoverEnabled,
        carryoverHoursIn: p.carryoverHoursIn ?? 0,
        carryoverMaxHours: p.carryoverMaxHours,
        carryoverExpiryMonths: p.carryoverExpiryMonths,
      });
    }
  }

  // Build project name lookup
  const projectNameByCanonicalId = new Map<string, string>();
  for (const p of projectsWithRates) {
    if (p.externalProjectId) {
      projectNameByCanonicalId.set(p.externalProjectId, p.projectName);
    }
  }

  // Build canonical company lookup
  const canonicalCompanyByProjectId = new Map<string, CanonicalCompanyResult>();
  for (const p of projectsWithRates) {
    if (p.externalProjectId) {
      const clientId = p.canonicalClientId || p.clientId;
      const clientName = p.canonicalClientName || p.clientName;
      canonicalCompanyByProjectId.set(p.externalProjectId, {
        canonicalClientId: clientId || '__UNASSIGNED__',
        canonicalDisplayName: clientName || 'Unassigned',
      });
    }
  }

  const getCanonicalProjectId = (projectId: string): string => {
    if (!projectId) return projectId;
    return projectCanonicalIdLookup?.get(projectId) || projectId;
  };

  const getCanonicalCompanyByProject = (projectId: string): CanonicalCompanyResult => {
    return canonicalCompanyByProjectId.get(projectId) || {
      canonicalClientId: '__UNASSIGNED__',
      canonicalDisplayName: 'Unassigned',
    };
  };

  // Map entries to canonical project IDs
  const allEntries = entries
    .filter(entry => !!entry.project_id)
    .map(entry => {
      const canonicalId = getCanonicalProjectId(entry.project_id!);
      const canonicalName = projectNameByCanonicalId.get(canonicalId) || entry.project_name;
      return { ...entry, project_id: canonicalId, project_name: canonicalName };
    });

  // Build billing inputs
  const inputs = buildBillingInputs({
    entries: allEntries,
    getBillingConfig: (projectId) => billingConfigByProjectId.get(projectId) || DEFAULT_BILLING_CONFIG,
    getCanonicalCompanyByProject,
  });

  // Inject carryover-only projects
  const projectIdsInInputs = new Set<string>();
  for (const company of inputs) {
    for (const project of company.projects) {
      if (project.projectId) projectIdsInInputs.add(project.projectId);
    }
  }
  for (const [externalId, config] of billingConfigByProjectId) {
    if (config.carryoverHoursIn > 0 && !projectIdsInInputs.has(externalId)) {
      const companyInfo = getCanonicalCompanyByProject(externalId);
      const projectName = projectNameByCanonicalId.get(externalId) || externalId;
      let companyInput = inputs.find(c => c.companyId === companyInfo.canonicalClientId);
      if (!companyInput) {
        companyInput = {
          companyId: companyInfo.canonicalClientId,
          companyName: companyInfo.canonicalDisplayName,
          projects: [],
        };
        inputs.push(companyInput);
      }
      companyInput.projects.push({
        projectId: externalId,
        projectName,
        tasks: [],
        billingConfig: config,
      });
    }
  }

  const billingResult = calculateMonthlyBilling(inputs);
  return { totalRevenue: billingResult.billedRevenue, billingResult };
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that computes combined revenue for each month in the chart range.
 * Uses the same calculation pipeline as the Revenue page:
 *   combinedRevenue = unifiedBillingRevenue + filteredBillings + milestoneAdjustment
 */
export function useCombinedRevenueByMonth({
  dateRange,
  extendedMonths,
  extendedEntries,
  projectCanonicalIdLookup,
}: UseCombinedRevenueByMonthParams): {
  combinedRevenueByMonth: Map<string, number>;
  loading: boolean;
} {
  // State for rate configs per month
  const [allMonthsRates, setAllMonthsRates] = useState<Map<string, ProjectRateDisplayWithBilling[]>>(new Map());
  const [ratesLoading, setRatesLoading] = useState(true);

  // State for billing transactions
  const [rawBillingTransactions, setRawBillingTransactions] = useState<BillingTransactionDetail[]>([]);
  const [billingsLoading, setBillingsLoading] = useState(true);

  // Fetch rate configs for all months in the chart range (parallel RPCs)
  useEffect(() => {
    async function fetchAllRates() {
      setRatesLoading(true);
      const extStart = startOfMonth(subMonths(dateRange.start, extendedMonths));

      // Build list of month dates to fetch (always extends to current month for MTD)
      const months: string[] = [];
      let current = new Date(extStart);
      const endDate = new Date(Math.max(dateRange.end.getTime(), endOfMonth(new Date()).getTime()));
      while (current <= endDate) {
        months.push(format(current, 'yyyy-MM-dd'));
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      }

      // Fetch all months in parallel
      const results = await Promise.all(
        months.map(monthStr =>
          supabase.rpc('get_all_project_rates_for_month', { p_month: monthStr })
        )
      );

      const ratesMap = new Map<string, ProjectRateDisplayWithBilling[]>();
      for (let i = 0; i < months.length; i++) {
        const monthKey = months[i].substring(0, 7);
        const data = results[i].data || [];
        ratesMap.set(monthKey, transformRateData(data));
      }
      setAllMonthsRates(ratesMap);
      setRatesLoading(false);
    }
    fetchAllRates();
  }, [dateRange, extendedMonths]);

  // Fetch billing transactions via RPC (same as Revenue page's useBillings)
  useEffect(() => {
    async function fetchBillingTransactions() {
      setBillingsLoading(true);
      const extStart = startOfMonth(subMonths(dateRange.start, extendedMonths));
      const startStr = format(extStart, 'yyyy-MM-dd');
      const endStr = format(new Date(Math.max(dateRange.end.getTime(), endOfMonth(new Date()).getTime())), 'yyyy-MM-dd');

      const { data } = await supabase.rpc('get_billings_with_transactions', {
        p_start_month: startStr,
        p_end_month: endStr,
      });

      const transactions: BillingTransactionDetail[] = [];
      for (const row of (data as Record<string, unknown>[]) || []) {
        if (!row.transaction_id || row.amount_cents === null) continue;
        transactions.push({
          monthKey: (row.transaction_month as string).substring(0, 7),
          amountCents: row.amount_cents as number,
          billingType: (row.billing_type as string) || '',
          linkedProjectId: (row.linked_project_id as string) || null,
        });
      }
      setRawBillingTransactions(transactions);
      setBillingsLoading(false);
    }
    fetchBillingTransactions();
  }, [dateRange, extendedMonths]);

  // Compute combined revenue per month
  const combinedRevenueByMonth = useMemo(() => {
    const map = new Map<string, number>();
    if (allMonthsRates.size === 0) return map;

    // Group entries by month
    const entriesByMonth = new Map<string, TimesheetEntry[]>();
    for (const entry of extendedEntries) {
      const monthKey = entry.work_date.substring(0, 7);
      if (!entriesByMonth.has(monthKey)) entriesByMonth.set(monthKey, []);
      entriesByMonth.get(monthKey)!.push(entry);
    }

    // Group billing transactions by month
    const billingTxnsByMonth = new Map<string, BillingTransactionDetail[]>();
    for (const txn of rawBillingTransactions) {
      if (!billingTxnsByMonth.has(txn.monthKey)) billingTxnsByMonth.set(txn.monthKey, []);
      billingTxnsByMonth.get(txn.monthKey)!.push(txn);
    }

    // For each month, replicate the Revenue page calculation
    for (const [monthKey, rates] of allMonthsRates) {
      const monthEntries = entriesByMonth.get(monthKey) || [];

      // Step 1: Compute unified billing (same as useUnifiedBilling)
      const { totalRevenue, billingResult } = computeUnifiedBilling(
        monthEntries, rates, projectCanonicalIdLookup
      );

      // Step 2: Build internal UUID -> external project ID map for this month
      const intToExt = new Map<string, string>();
      for (const p of rates) {
        if (p.projectId && p.externalProjectId) {
          intToExt.set(p.projectId, p.externalProjectId);
        }
      }

      // Step 3: Process billing transactions — separate linked milestones from other billings
      const monthTxns = billingTxnsByMonth.get(monthKey) || [];
      let filteredBillingCents = 0;
      const milestoneByProject = new Map<string, number>();

      for (const txn of monthTxns) {
        if (txn.billingType === 'revenue_milestone' && txn.linkedProjectId) {
          const extId = intToExt.get(txn.linkedProjectId);
          if (extId) {
            const canonicalId = projectCanonicalIdLookup?.get(extId) || extId;
            const existing = milestoneByProject.get(canonicalId) || 0;
            milestoneByProject.set(canonicalId, existing + txn.amountCents);
            continue; // Don't add linked milestones to filtered billing
          }
        }
        filteredBillingCents += txn.amountCents;
      }

      // Step 4: Compute milestone adjustment (same formula as Revenue page)
      // milestone adjustment = (milestone amount - project timesheet revenue) for linked projects
      let milestoneAdjustment = 0;
      for (const company of billingResult.companies) {
        for (const project of company.projects) {
          if (project.projectId) {
            const milestoneCents = milestoneByProject.get(project.projectId);
            if (milestoneCents !== undefined) {
              milestoneAdjustment += (milestoneCents / 100) - project.billedRevenue;
            }
          }
        }
      }

      // Step 5: Combined revenue = timesheet + filtered billings + milestone adjustment
      const combinedRevenue = totalRevenue + (filteredBillingCents / 100) + milestoneAdjustment;
      map.set(monthKey, combinedRevenue);
    }

    return map;
  }, [allMonthsRates, extendedEntries, rawBillingTransactions, projectCanonicalIdLookup]);

  return {
    combinedRevenueByMonth,
    loading: ratesLoading || billingsLoading,
  };
}
