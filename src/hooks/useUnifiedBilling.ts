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
  /** Function to get canonical company name (ID-only lookup) */
  getCanonicalCompanyName?: (clientId: string) => string;
  /** Lookup from external project_id to canonical external project_id (for member → primary mapping) */
  projectCanonicalIdLookup?: Map<string, string>;
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
  projectCanonicalIdLookup,
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

  // Build lookup from canonical project ID to project name
  const projectNameByCanonicalId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsWithRates) {
      if (p.externalProjectId) {
        map.set(p.externalProjectId, p.projectName);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Build billing inputs and calculate, tracking unmatched projects
  const { billingInputs, billingResult, unmatchedProjects } = useMemo(() => {
    // Track unmatched projects
    const unmatched = new Map<string, UnmatchedProject>();

    // Helper to get canonical project ID (maps member project IDs to their primary)
    const getCanonicalProjectId = (projectId: string): string => {
      if (!projectId) return projectId;
      // If we have a canonical lookup, use it to map member → primary
      if (projectCanonicalIdLookup) {
        return projectCanonicalIdLookup.get(projectId) || projectId;
      }
      return projectId;
    };

    // Helper to get company name (ID-only lookup)
    const getCompanyName = (clientId: string): string => {
      if (getCanonicalCompanyName) {
        return getCanonicalCompanyName(clientId);
      }
      return 'Unknown';
    };

    // First pass: identify all unmatched projects and their minutes
    const projectMinutes = new Map<string, { projectName: string; totalMinutes: number }>();
    for (const entry of entries) {
      const projectId = entry.project_id || '';
      const canonicalId = getCanonicalProjectId(projectId);
      // Use project ID as key - no name fallback. Entries without project_id get grouped under '__empty__'
      const key = projectId || '__empty__';

      if (!projectMinutes.has(key)) {
        // Store project ID as identifier, not name
        projectMinutes.set(key, { projectName: projectId || '(no ID)', totalMinutes: 0 });
      }
      projectMinutes.get(key)!.totalMinutes += entry.total_minutes;

      // Check if this project is matched (using canonical ID)
      if (!projectId || !billingConfigByProjectId.has(canonicalId)) {
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

    // Filter and transform entries to use canonical project IDs and names
    const matchedEntries = entries
      .filter(entry => {
        const projectId = entry.project_id;
        if (!projectId) return false;
        const canonicalId = getCanonicalProjectId(projectId);
        return billingConfigByProjectId.has(canonicalId);
      })
      .map(entry => {
        // Transform entry to use canonical project ID and name
        const canonicalId = getCanonicalProjectId(entry.project_id!);
        const canonicalName = projectNameByCanonicalId.get(canonicalId) || canonicalId;
        return {
          ...entry,
          project_id: canonicalId,
          project_name: canonicalName,
        };
      });

    // Build inputs with matched entries (now using canonical project IDs and names)
    const inputs = buildBillingInputs({
      entries: matchedEntries,
      getBillingConfig: (projectId) => {
        // This should always succeed since we filtered to matched entries
        // projectId is now the canonical ID
        const config = billingConfigByProjectId.get(projectId);
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
    projectNameByCanonicalId,
    getCanonicalCompanyName,
    projectCanonicalIdLookup,
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
