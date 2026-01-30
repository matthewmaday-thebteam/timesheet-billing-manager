/**
 * useCarryoverSync - Persists carryover hours to the database
 *
 * When billing is calculated and a project has carryoverOut > 0,
 * this hook writes the carryover to project_carryover_hours so the
 * next month's billing can read it via get_all_project_rates_for_month.
 *
 * @official 2026-01-30
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { MonthlyBillingResult } from '../utils/billingCalculations';
import type { ProjectRateDisplayWithBilling, MonthSelection } from '../types';

interface UseCarryoverSyncParams {
  /** Complete billing result from useUnifiedBilling */
  billingResult: MonthlyBillingResult;
  /** Projects with rates (to map external ID -> internal UUID) */
  projectsWithRates: ProjectRateDisplayWithBilling[];
  /** Currently selected month */
  selectedMonth: MonthSelection;
  /** Whether data is still loading */
  loading: boolean;
}

/**
 * Formats a MonthSelection as ISO date string (YYYY-MM-DD, first of month).
 */
function formatMonthAsISO(month: MonthSelection): string {
  const yyyy = month.year;
  const mm = String(month.month).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

/**
 * Hook that auto-persists carryover results after billing calculation.
 *
 * For each project with carryoverEnabled + maximumHours:
 * - If carryoverOut > 0: upserts into project_carryover_hours
 * - If carryoverOut = 0: deletes stale carryover rows
 */
export function useCarryoverSync({
  billingResult,
  projectsWithRates,
  selectedMonth,
  loading,
}: UseCarryoverSyncParams): void {
  // Track what we've already synced to avoid duplicate calls
  const lastSyncKey = useRef<string>('');

  useEffect(() => {
    if (loading) return;

    // Build a stable key to avoid re-syncing the same data
    const syncKey = `${selectedMonth.year}-${selectedMonth.month}-${billingResult.billedHours}`;
    if (syncKey === lastSyncKey.current) return;

    // Build lookup: externalProjectId -> internal UUID
    const externalToInternalId = new Map<string, string>();
    // Build lookup: externalProjectId -> project config (for carryover checks)
    const projectConfigByExternalId = new Map<string, ProjectRateDisplayWithBilling>();

    for (const p of projectsWithRates) {
      if (p.externalProjectId && p.projectId) {
        externalToInternalId.set(p.externalProjectId, p.projectId);
        projectConfigByExternalId.set(p.externalProjectId, p);
      }
    }

    // Collect all carryover sync operations
    const syncOps: Array<{
      projectId: string; // internal UUID
      sourceMonth: string;
      carryoverHours: number;
      actualHoursWorked: number;
      maximumApplied: number;
    }> = [];

    const sourceMonth = formatMonthAsISO(selectedMonth);

    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (!project.projectId) continue;

        const config = projectConfigByExternalId.get(project.projectId);
        if (!config) continue;

        // Only sync projects that have carryover enabled with a maximum set
        if (!config.carryoverEnabled || config.maximumHours === null) continue;

        const internalId = externalToInternalId.get(project.projectId);
        if (!internalId) continue;

        syncOps.push({
          projectId: internalId,
          sourceMonth,
          carryoverHours: project.carryoverOut,
          actualHoursWorked: project.roundedHours,
          maximumApplied: config.maximumHours,
        });
      }
    }

    if (syncOps.length === 0) return;

    // Persist all carryover operations
    lastSyncKey.current = syncKey;

    const syncAll = async () => {
      for (const op of syncOps) {
        const { error } = await supabase.rpc('sync_project_carryover', {
          p_project_id: op.projectId,
          p_source_month: op.sourceMonth,
          p_carryover_hours: op.carryoverHours,
          p_actual_hours_worked: op.actualHoursWorked,
          p_maximum_applied: op.maximumApplied,
        });

        if (error) {
          console.error(
            `Failed to sync carryover for project ${op.projectId}:`,
            error
          );
        }
      }
    };

    syncAll();
  }, [billingResult, projectsWithRates, selectedMonth, loading]);
}
