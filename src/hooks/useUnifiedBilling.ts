/**
 * useUnifiedBilling - Single source of truth for billing calculations
 *
 * This hook provides consistent billing calculations across all components.
 * Use this instead of calculating revenue/hours manually.
 *
 * CRITICAL: All lookups are by ID only. Name-based fallbacks are not allowed.
 * If a project cannot be matched by ID, it is flagged as an error.
 *
 * @official 2026-01-25
 */

import { useMemo } from 'react';
import {
  buildBillingInputs,
  calculateMonthlyBilling,
  type CompanyInput,
  type MonthlyBillingResult,
  type ProjectBillingConfig,
} from '../utils/billingCalculations';
import { DEFAULT_ROUNDING_INCREMENT } from '../utils/billing';
import type { TimesheetEntry, ProjectRateDisplayWithBilling, RoundingIncrement } from '../types';

/**
 * Represents a project that could not be matched by ID
 */
export interface UnmatchedProject {
  /** The project_id from the timesheet entry */
  entryProjectId: string;
  /** The project_name from the timesheet entry (for debugging only) */
  entryProjectName: string;
  /** Total minutes for this unmatched project */
  totalMinutes: number;
}

interface UseUnifiedBillingParams {
  /** Raw timesheet entries */
  entries: TimesheetEntry[];
  /** Projects with billing configuration from useMonthlyRates */
  projectsWithRates: ProjectRateDisplayWithBilling[];
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
  /** Projects that could not be matched by ID - these are DATA ERRORS */
  unmatchedProjects: UnmatchedProject[];
  /** Whether all projects were successfully matched */
  allProjectsMatched: boolean;
}

/**
 * Hook to calculate unified billing across all components.
 *
 * CRITICAL: This hook enforces ID-based lookups only.
 * - All project lookups use externalProjectId
 * - No name-based fallbacks
 * - Unmatched projects are flagged as errors, not silently defaulted
 *
 * Usage:
 * ```tsx
 * const { totalRevenue, billingResult, unmatchedProjects, allProjectsMatched } = useUnifiedBilling({
 *   entries,
 *   projectsWithRates,
 * });
 *
 * if (!allProjectsMatched) {
 *   console.error('Data integrity error: unmatched projects', unmatchedProjects);
 * }
 * ```
 */
export function useUnifiedBilling({
  entries,
  projectsWithRates,
  getCanonicalCompanyName,
}: UseUnifiedBillingParams): UseUnifiedBillingResult {
  // Build lookup map from projectsWithRates - ONLY by external project ID
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

  // Build billing inputs and calculate, tracking unmatched projects
  const { billingInputs, billingResult, unmatchedProjects } = useMemo(() => {
    // Track unmatched projects
    const unmatched = new Map<string, UnmatchedProject>();

    // Helper to get billing config - ID lookup ONLY, no fallbacks
    const getBillingConfig = (projectId: string, projectName: string): ProjectBillingConfig | null => {
      // Empty project ID is a data error
      if (!projectId) {
        const key = `__empty__:${projectName}`;
        if (!unmatched.has(key)) {
          unmatched.set(key, {
            entryProjectId: '(empty)',
            entryProjectName: projectName,
            totalMinutes: 0,
          });
        }
        return null;
      }

      // Look up by project ID only
      const config = billingConfigByProjectId.get(projectId);

      if (!config) {
        // Track this unmatched project
        if (!unmatched.has(projectId)) {
          unmatched.set(projectId, {
            entryProjectId: projectId,
            entryProjectName: projectName,
            totalMinutes: 0,
          });
        }
        return null;
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

    // First pass: identify all unmatched projects and their minutes
    const projectMinutes = new Map<string, { projectName: string; totalMinutes: number }>();
    for (const entry of entries) {
      const projectId = entry.project_id || '';
      const key = projectId || `__empty__:${entry.project_name}`;

      if (!projectMinutes.has(key)) {
        projectMinutes.set(key, { projectName: entry.project_name, totalMinutes: 0 });
      }
      projectMinutes.get(key)!.totalMinutes += entry.total_minutes;

      // Check if this project is matched
      if (!projectId || !billingConfigByProjectId.has(projectId)) {
        if (!unmatched.has(key)) {
          unmatched.set(key, {
            entryProjectId: projectId || '(empty)',
            entryProjectName: entry.project_name,
            totalMinutes: 0,
          });
        }
      }
    }

    // Update unmatched projects with their total minutes
    for (const [key, data] of projectMinutes) {
      if (unmatched.has(key)) {
        unmatched.get(key)!.totalMinutes = data.totalMinutes;
      }
    }

    // Filter entries to only include matched projects for billing calculation
    const matchedEntries = entries.filter(entry => {
      const projectId = entry.project_id;
      return projectId && billingConfigByProjectId.has(projectId);
    });

    // Build inputs with matched entries only
    const inputs = buildBillingInputs({
      entries: matchedEntries,
      getBillingConfig: (projectId, projectName) => {
        // This should always succeed since we filtered to matched entries
        const config = getBillingConfig(projectId, projectName);
        if (!config) {
          // This should never happen after filtering, but be defensive
          throw new Error(`Data integrity error: project ${projectId} not found after filtering`);
        }
        return config;
      },
      getCompanyName,
    });

    // Calculate billing
    const result = calculateMonthlyBilling(inputs);

    return {
      billingInputs: inputs,
      billingResult: result,
      unmatchedProjects: Array.from(unmatched.values()),
    };
  }, [
    entries,
    billingConfigByProjectId,
    getCanonicalCompanyName,
  ]);

  return {
    billingResult,
    totalRevenue: billingResult.billedRevenue,
    totalBilledHours: billingResult.billedHours,
    totalActualHours: billingResult.actualHours,
    billingInputs,
    unmatchedProjects,
    allProjectsMatched: unmatchedProjects.length === 0,
  };
}

export default useUnifiedBilling;
