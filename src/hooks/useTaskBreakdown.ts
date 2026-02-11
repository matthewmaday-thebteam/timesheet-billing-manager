/**
 * useTaskBreakdown - Fetch task-level hour breakdown for a given month
 *
 * Queries v_timesheet_entries grouped by canonical project + task_name.
 * Resolves member projects to their primary so task hours align with
 * project_monthly_summary aggregation.
 *
 * Returns a Map keyed by external project_id (canonical) with arrays
 * of { taskName, actualMinutes } per task. Rounding/revenue must be
 * applied by the consumer using the project's rate and rounding config.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { MonthSelection } from '../types';

export interface TaskBreakdownEntry {
  taskName: string;
  actualMinutes: number;
}

interface UseTaskBreakdownOptions {
  selectedMonth: MonthSelection;
  /** When provided, filter entries to this date range instead of the full month */
  dateRange?: { start: string; end: string };
  /** When true, skip fetching entirely (returns empty map) */
  skip?: boolean;
}

interface UseTaskBreakdownReturn {
  /** Map of canonical external project_id → task breakdown entries */
  tasksByProject: Map<string, TaskBreakdownEntry[]>;
  isLoading: boolean;
  error: string | null;
}

export function useTaskBreakdown({
  selectedMonth,
  dateRange,
  skip = false,
}: UseTaskBreakdownOptions): UseTaskBreakdownReturn {
  const [tasksByProject, setTasksByProject] = useState<Map<string, TaskBreakdownEntry[]>>(new Map());
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
      // Determine date bounds: use dateRange if provided, otherwise full month
      let rangeStart: string;
      let rangeEnd: string;
      let useExclusiveEnd: boolean;

      if (dateRange) {
        rangeStart = dateRange.start;
        rangeEnd = dateRange.end;
        useExclusiveEnd = false; // inclusive end for week ranges
      } else {
        const yyyy = selectedMonth.year;
        const mm = String(selectedMonth.month).padStart(2, '0');
        rangeStart = `${yyyy}-${mm}-01`;
        rangeEnd = selectedMonth.month === 12
          ? `${yyyy + 1}-01-01`
          : `${yyyy}-${String(selectedMonth.month + 1).padStart(2, '0')}-01`;
        useExclusiveEnd = true; // exclusive end for month ranges (< next month)
      }

      // Build the entries query with appropriate date filtering
      let entriesQuery = supabase
        .from('v_timesheet_entries')
        .select('project_id, task_name, total_minutes')
        .gte('work_date', rangeStart);

      if (useExclusiveEnd) {
        entriesQuery = entriesQuery.lt('work_date', rangeEnd);
      } else {
        entriesQuery = entriesQuery.lte('work_date', rangeEnd);
      }

      // Fetch entries and project group mapping in parallel
      const [entriesResult, projectsResult, groupMembersResult] = await Promise.all([
        entriesQuery,

        // All projects (for external → internal ID mapping)
        supabase
          .from('projects')
          .select('id, project_id'),

        // Project group members (for member → primary resolution)
        supabase
          .from('project_group_members')
          .select('member_project_id, group:project_groups!inner(primary_project_id)'),
      ]);

      if (entriesResult.error) throw entriesResult.error;
      if (projectsResult.error) throw projectsResult.error;
      if (groupMembersResult.error) throw groupMembersResult.error;

      // Build external_project_id → internal UUID lookup
      const externalToInternal = new Map<string, string>();
      const internalToExternal = new Map<string, string>();
      for (const p of projectsResult.data || []) {
        externalToInternal.set(p.project_id, p.id);
        internalToExternal.set(p.id, p.project_id);
      }

      // Build member internal UUID → primary external project_id lookup
      const memberToPrimaryExternal = new Map<string, string>();
      for (const gm of groupMembersResult.data || []) {
        const group = gm.group as unknown as { primary_project_id: string };
        const primaryExternal = internalToExternal.get(group.primary_project_id);
        if (primaryExternal) {
          memberToPrimaryExternal.set(gm.member_project_id, primaryExternal);
        }
      }

      // Group entries by canonical external project_id + task_name
      const grouped = new Map<string, Map<string, number>>();

      for (const entry of entriesResult.data || []) {
        if (!entry.project_id || entry.total_minutes <= 0) continue;

        // Resolve to canonical: check if this external project_id is a member
        const internalId = externalToInternal.get(entry.project_id);
        let canonicalExternal = entry.project_id;
        if (internalId && memberToPrimaryExternal.has(internalId)) {
          canonicalExternal = memberToPrimaryExternal.get(internalId)!;
        }

        const taskName = entry.task_name || 'No Task';

        if (!grouped.has(canonicalExternal)) {
          grouped.set(canonicalExternal, new Map());
        }
        const taskMap = grouped.get(canonicalExternal)!;
        taskMap.set(taskName, (taskMap.get(taskName) || 0) + entry.total_minutes);
      }

      // Convert to result format
      const result = new Map<string, TaskBreakdownEntry[]>();
      for (const [projectId, taskMap] of grouped) {
        const tasks: TaskBreakdownEntry[] = [];
        for (const [taskName, actualMinutes] of taskMap) {
          tasks.push({ taskName, actualMinutes });
        }
        // Sort by minutes descending
        tasks.sort((a, b) => b.actualMinutes - a.actualMinutes);
        result.set(projectId, tasks);
      }

      setTasksByProject(result);
    } catch (err) {
      console.error('Error fetching task breakdown:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch task breakdown');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, dateRange?.start, dateRange?.end, skip]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasksByProject, isLoading, error };
}
