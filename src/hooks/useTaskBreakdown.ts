/**
 * useTaskBreakdown - Fetch task-level hour breakdown for a given month
 *
 * Monthly mode (no dateRange): reads pre-computed task totals from Layer 4
 * (`task_monthly_totals`), exposing both `roundedEntryMinutes` and
 * `roundedTaskMinutes` per task plus the project-month's
 * `effectiveRoundingMode`. The display layer picks the column matching the
 * mode so the children sum exactly equals the parent (which is computed
 * upstream by the billing engine from the same Layer 4 source).
 *
 * Weekly mode (dateRange provided): `task_monthly_totals` is monthly only,
 * so weekly task hours are summed directly from `timesheet_daily_rollups`
 * (Layer 1) using the per-entry `rounded_minutes` written at sync time.
 * No client-side rounding is performed — re-rounding the sum would diverge
 * from the per-entry contract.
 *
 * Returns a Map keyed by canonical external project_id (resolved via
 * project_groups so member projects fold into their primary).
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAllRows';
import type { MonthSelection, RoundingMode } from '../types';

export interface TaskBreakdownEntry {
  taskName: string;
  /** Raw minutes worked (sum of unrounded daily totals). */
  actualMinutes: number;
  /** Per-entry rounded minutes (sum of `tdr.rounded_minutes` over entries in the period). */
  roundedEntryMinutes: number;
  /** Task-aggregate rounded minutes (sum of actual then rounded once). Monthly mode only. */
  roundedTaskMinutes: number;
}

export interface ProjectTaskBreakdown {
  /** Effective rounding mode for this project-month, sourced from the same hierarchy as the billing engine. */
  effectiveRoundingMode: RoundingMode;
  tasks: TaskBreakdownEntry[];
}

interface UseTaskBreakdownOptions {
  selectedMonth: MonthSelection;
  /** When provided, filter entries to this date range instead of the full month (weekly mode). */
  dateRange?: { start: string; end: string };
  /** When true, skip fetching entirely (returns empty map). */
  skip?: boolean;
}

interface UseTaskBreakdownReturn {
  /** Map of canonical external project_id → task breakdown for that project-month. */
  tasksByProject: Map<string, ProjectTaskBreakdown>;
  isLoading: boolean;
  error: string | null;
}

const FALLBACK_BREAKDOWN: ProjectTaskBreakdown = {
  effectiveRoundingMode: 'task',
  tasks: [],
};

/** ISO month string (YYYY-MM-01) for the first day of the selected month. */
function formatMonthAsISO(month: MonthSelection): string {
  const yyyy = month.year;
  const mm = String(month.month).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

export function useTaskBreakdown({
  selectedMonth,
  dateRange,
  skip = false,
}: UseTaskBreakdownOptions): UseTaskBreakdownReturn {
  const [tasksByProject, setTasksByProject] = useState<Map<string, ProjectTaskBreakdown>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (skip) {
      setTasksByProject(new Map());
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (dateRange) {
        // -----------------------------------------------------------------
        // WEEKLY MODE — task_monthly_totals is monthly only, so we read raw
        // daily rollups and sum per-entry rounded_minutes. We deliberately
        // do NOT call applyRounding here: the per-entry rounded value is
        // the canonical contract for sub-month windows.
        // -----------------------------------------------------------------
        const result = await fetchWeeklyBreakdown(dateRange);
        setTasksByProject(result);
      } else {
        // -----------------------------------------------------------------
        // MONTHLY MODE — read pre-computed Layer 4 totals so the children
        // match the parent (which the billing engine derives from the same
        // table per migration 094).
        // -----------------------------------------------------------------
        const result = await fetchMonthlyBreakdown(selectedMonth);
        setTasksByProject(result);
      }
    } catch (err) {
      console.error('Error fetching task breakdown:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch task breakdown');
      setTasksByProject(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, dateRange?.start, dateRange?.end, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasksByProject, isLoading, error };
}

// ---------------------------------------------------------------------------
// Monthly mode — task_monthly_totals + per-project effective rounding mode
// ---------------------------------------------------------------------------

interface TaskMonthlyTotalsRow {
  project_id: string; // canonical UUID (set by populate_task_monthly_totals)
  task_name: string;
  actual_minutes: number;
  rounded_entry_minutes: number;
  rounded_task_minutes: number;
}

interface ProjectRoundingRow {
  project_id: string; // canonical UUID
  effective_rounding_mode: RoundingMode;
}

async function fetchMonthlyBreakdown(
  selectedMonth: MonthSelection,
): Promise<Map<string, ProjectTaskBreakdown>> {
  const monthStr = formatMonthAsISO(selectedMonth);

  // Layer 4 task totals + per-project rounding mode + internal→external project id map.
  // task_monthly_totals.project_id is already canonical (resolved through
  // project_groups by populate_task_monthly_totals — see mig-093:475-478).
  const tmtQuery = supabase
    .from('task_monthly_totals')
    .select('project_id, task_name, actual_minutes, rounded_entry_minutes, rounded_task_minutes')
    .eq('summary_month', monthStr);

  const [tmtResult, roundingsResult, projectsResult] = await Promise.all([
    fetchAllRows<TaskMonthlyTotalsRow>(tmtQuery),
    supabase.rpc('get_all_project_roundings_for_month', { p_month: monthStr }),
    supabase.from('projects').select('id, project_id'),
  ]);

  if (tmtResult.error) throw tmtResult.error;
  if (roundingsResult.error) throw roundingsResult.error;
  if (projectsResult.error) throw projectsResult.error;

  // Internal canonical UUID → external project_id (string).
  const internalToExternal = new Map<string, string>();
  for (const p of projectsResult.data || []) {
    internalToExternal.set(p.id, p.project_id);
  }

  // Internal canonical UUID → effective_rounding_mode for this month.
  const modeByCanonicalInternalId = new Map<string, RoundingMode>();
  for (const r of (roundingsResult.data as ProjectRoundingRow[] | null) || []) {
    modeByCanonicalInternalId.set(r.project_id, r.effective_rounding_mode);
  }

  // Group task rows by canonical external project_id.
  const grouped = new Map<string, Map<string, TaskBreakdownEntry>>();
  const modeByExternal = new Map<string, RoundingMode>();

  for (const row of tmtResult.data || []) {
    const externalId = internalToExternal.get(row.project_id);
    if (!externalId) {
      // task_monthly_totals references a project the projects table doesn't expose —
      // fail loudly per the no-silent-fallback rule.
      throw new Error(
        `task_monthly_totals references project_id ${row.project_id} which is not present in the projects table`,
      );
    }

    const mode = modeByCanonicalInternalId.get(row.project_id) ?? 'task';
    modeByExternal.set(externalId, mode);

    if (!grouped.has(externalId)) {
      grouped.set(externalId, new Map());
    }
    const taskMap = grouped.get(externalId)!;
    const taskName = row.task_name || 'No Task';

    const existing = taskMap.get(taskName);
    if (existing) {
      // Should not happen given the unique constraint (project_id, task_name, client_id, summary_month),
      // but guard against duplicates (e.g. multiple client_ids for same task) by summing.
      existing.actualMinutes += row.actual_minutes;
      existing.roundedEntryMinutes += row.rounded_entry_minutes;
      existing.roundedTaskMinutes += row.rounded_task_minutes;
    } else {
      taskMap.set(taskName, {
        taskName,
        actualMinutes: row.actual_minutes,
        roundedEntryMinutes: row.rounded_entry_minutes,
        roundedTaskMinutes: row.rounded_task_minutes,
      });
    }
  }

  // Materialize, sorting tasks by actual minutes descending (preserves prior behavior).
  const result = new Map<string, ProjectTaskBreakdown>();
  for (const [externalId, taskMap] of grouped) {
    const tasks = [...taskMap.values()].sort((a, b) => b.actualMinutes - a.actualMinutes);
    result.set(externalId, {
      effectiveRoundingMode: modeByExternal.get(externalId) ?? 'task',
      tasks,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Weekly mode — Layer 1 daily rollups, summing per-entry rounded_minutes.
// ---------------------------------------------------------------------------

interface DailyRollupRow {
  project_id: string | null;
  task_name: string | null;
  total_minutes: number | null;
  rounded_minutes: number | null;
}

async function fetchWeeklyBreakdown(
  dateRange: { start: string; end: string },
): Promise<Map<string, ProjectTaskBreakdown>> {
  // Read directly from timesheet_daily_rollups (table, not the view) because
  // v_timesheet_entries does not expose rounded_minutes. Inclusive end for
  // week ranges, matching the previous behavior.
  const rollupsQuery = supabase
    .from('timesheet_daily_rollups')
    .select('project_id, task_name, total_minutes, rounded_minutes')
    .gte('work_date', dateRange.start)
    .lte('work_date', dateRange.end)
    .gt('total_minutes', 0);

  const [rollupsResult, projectsResult, groupMembersResult] = await Promise.all([
    fetchAllRows<DailyRollupRow>(rollupsQuery),
    supabase.from('projects').select('id, project_id'),
    supabase
      .from('project_group_members')
      .select('member_project_id, group:project_groups!inner(primary_project_id)'),
  ]);

  if (rollupsResult.error) throw rollupsResult.error;
  if (projectsResult.error) throw projectsResult.error;
  if (groupMembersResult.error) throw groupMembersResult.error;

  // External → internal and internal → external project_id maps.
  const externalToInternal = new Map<string, string>();
  const internalToExternal = new Map<string, string>();
  for (const p of projectsResult.data || []) {
    externalToInternal.set(p.project_id, p.id);
    internalToExternal.set(p.id, p.project_id);
  }

  // Member internal UUID → primary external project_id (canonical resolution).
  const memberToPrimaryExternal = new Map<string, string>();
  for (const gm of groupMembersResult.data || []) {
    const group = gm.group as unknown as { primary_project_id: string };
    const primaryExternal = internalToExternal.get(group.primary_project_id);
    if (primaryExternal) {
      memberToPrimaryExternal.set(gm.member_project_id, primaryExternal);
    }
  }

  // Aggregate by canonical external project_id + task_name.
  const grouped = new Map<string, Map<string, TaskBreakdownEntry>>();

  for (const row of rollupsResult.data || []) {
    if (!row.project_id) continue;
    const totalMinutes = row.total_minutes ?? 0;
    if (totalMinutes <= 0) continue;
    // If rounded_minutes is null (legacy rows), treat per-entry rounded as the actual
    // (matches populate_task_monthly_totals' COALESCE in mig-093:474).
    const entryRounded = row.rounded_minutes ?? totalMinutes;

    const internalId = externalToInternal.get(row.project_id);
    let canonicalExternal = row.project_id;
    if (internalId && memberToPrimaryExternal.has(internalId)) {
      canonicalExternal = memberToPrimaryExternal.get(internalId)!;
    }

    const taskName = row.task_name || 'No Task';

    if (!grouped.has(canonicalExternal)) {
      grouped.set(canonicalExternal, new Map());
    }
    const taskMap = grouped.get(canonicalExternal)!;
    const existing = taskMap.get(taskName);
    if (existing) {
      existing.actualMinutes += totalMinutes;
      existing.roundedEntryMinutes += entryRounded;
    } else {
      taskMap.set(taskName, {
        taskName,
        actualMinutes: totalMinutes,
        roundedEntryMinutes: entryRounded,
        // Weekly mode has no concept of "task-aggregate rounding" (that's a monthly
        // construct). Mirror the entry value so consumers reading either field stay
        // internally consistent within the week window.
        roundedTaskMinutes: entryRounded,
      });
    }
  }

  // Weekly mode treats every project as entry-rounded — Layer 1 stores
  // per-entry rounded minutes already, and the weekly path explicitly skips
  // re-rounding the sum.
  const result = new Map<string, ProjectTaskBreakdown>();
  for (const [externalId, taskMap] of grouped) {
    const tasks = [...taskMap.values()].sort((a, b) => b.actualMinutes - a.actualMinutes);
    result.set(externalId, {
      effectiveRoundingMode: 'entry',
      tasks,
    });
  }
  return result;
}

// Re-export for any external consumers that may have imported the fallback shape.
export { FALLBACK_BREAKDOWN };
