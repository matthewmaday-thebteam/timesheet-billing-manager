/**
 * useUnifiedBilling - Single source of truth for billing calculations
 *
 * This hook provides consistent billing calculations across all components.
 * Use this instead of calculating revenue/hours manually.
 *
 * @official 2026-01-24
 */

import { useMemo } from 'react';
import {
  buildBillingInputs,
  calculateMonthlyBilling,
  DEFAULT_BILLING_CONFIG,
  type CompanyInput,
  type MonthlyBillingResult,
  type ProjectBillingConfig,
} from '../utils/billingCalculations';
import { DEFAULT_ROUNDING_INCREMENT, getEffectiveRate } from '../utils/billing';
import type { TimesheetEntry, ProjectRateDisplayWithBilling, RoundingIncrement } from '../types';

interface UseUnifiedBillingParams {
  /** Raw timesheet entries */
  entries: TimesheetEntry[];
  /** Projects with billing configuration from useMonthlyRates */
  projectsWithRates: ProjectRateDisplayWithBilling[];
  /** Fallback rate lookup by project name */
  fallbackRateLookup?: Map<string, number>;
  /** Function to get canonical company name (optional) */
  getCanonicalCompanyName?: (clientId: string, clientName: string) => string;
}

interface UseUnifiedBillingResult {
  /** Complete billing result with all levels */
  billingResult: MonthlyBillingResult;
  /** Total billed revenue for the month */
  totalRevenue: number;
  /** Total billed hours for the month */
  totalBilledHours: number;
  /** Total actual hours for the month */
  totalActualHours: number;
  /** Billing inputs (for debugging/inspection) */
  billingInputs: CompanyInput[];
}

/**
 * Hook to calculate unified billing across all components.
 *
 * Usage:
 * ```tsx
 * const { totalRevenue, billingResult } = useUnifiedBilling({
 *   entries,
 *   projectsWithRates,
 * });
 * ```
 */
export function useUnifiedBilling({
  entries,
  projectsWithRates,
  fallbackRateLookup,
  getCanonicalCompanyName,
}: UseUnifiedBillingParams): UseUnifiedBillingResult {
  // Build lookup maps from projectsWithRates
  const billingConfigByProjectId = useMemo(() => {
    const map = new Map<string, ProjectBillingConfig>();

    for (const p of projectsWithRates) {
      if (p.externalProjectId) {
        const config: ProjectBillingConfig = {
          rate: p.effectiveRate,
          rounding: (p.effectiveRounding as RoundingIncrement) ?? DEFAULT_ROUNDING_INCREMENT,
          minimumHours: p.minimumHours,
          maximumHours: p.maximumHours,
          isActive: p.isActive,
          carryoverEnabled: p.carryoverEnabled,
          carryoverHoursIn: p.carryoverHoursIn ?? 0,
          carryoverMaxHours: p.carryoverMaxHours,
          carryoverExpiryMonths: p.carryoverExpiryMonths,
        };
        map.set(p.externalProjectId, config);
      }
    }

    return map;
  }, [projectsWithRates]);

  const billingConfigByProjectName = useMemo(() => {
    const map = new Map<string, ProjectBillingConfig>();

    for (const p of projectsWithRates) {
      const config: ProjectBillingConfig = {
        rate: p.effectiveRate,
        rounding: (p.effectiveRounding as RoundingIncrement) ?? DEFAULT_ROUNDING_INCREMENT,
        minimumHours: p.minimumHours,
        maximumHours: p.maximumHours,
        isActive: p.isActive,
        carryoverEnabled: p.carryoverEnabled,
        carryoverHoursIn: p.carryoverHoursIn ?? 0,
        carryoverMaxHours: p.carryoverMaxHours,
        carryoverExpiryMonths: p.carryoverExpiryMonths,
      };
      map.set(p.projectName, config);
    }

    return map;
  }, [projectsWithRates]);

  // Build billing inputs and calculate
  const { billingInputs, billingResult } = useMemo(() => {
    // Helper to get billing config
    const getBillingConfig = (projectId: string, projectName: string): ProjectBillingConfig => {
      // Try by project ID first (most reliable)
      let config = billingConfigByProjectId.get(projectId);

      // Fall back to project name
      if (!config) {
        config = billingConfigByProjectName.get(projectName);
      }

      // Fall back to default with rate lookup
      if (!config) {
        const rate = fallbackRateLookup
          ? getEffectiveRate(projectName, fallbackRateLookup, {})
          : 0;

        return {
          ...DEFAULT_BILLING_CONFIG,
          rate,
        };
      }

      return config;
    };

    // Helper to get company name
    const getCompanyName = (clientId: string, clientName: string): string => {
      if (getCanonicalCompanyName) {
        return getCanonicalCompanyName(clientId, clientName);
      }
      return clientName || 'Unassigned';
    };

    // Build inputs
    const inputs = buildBillingInputs({
      entries,
      getBillingConfig,
      getCompanyName,
    });

    // Calculate billing
    const result = calculateMonthlyBilling(inputs);

    return {
      billingInputs: inputs,
      billingResult: result,
    };
  }, [
    entries,
    billingConfigByProjectId,
    billingConfigByProjectName,
    fallbackRateLookup,
    getCanonicalCompanyName,
  ]);

  return {
    billingResult,
    totalRevenue: billingResult.billedRevenue,
    totalBilledHours: billingResult.billedHours,
    totalActualHours: billingResult.actualHours,
    billingInputs,
  };
}

export default useUnifiedBilling;
