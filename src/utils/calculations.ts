import { startOfWeek, endOfWeek, format, addWeeks, isBefore, isAfter, startOfMonth, endOfMonth } from 'date-fns';
import { getWorkingDaysInMonth } from './holidays';
import type { TimesheetEntry, ProjectSummary, ResourceSummary, TaskSummary } from '../types';

// ============================================================================
// Week Option Utilities
// ============================================================================

export interface WeekOption {
  label: string;       // "Week of Feb 2"
  value: string;       // "2026-02-02" (Monday date as key)
  startDate: string;   // "2026-02-02" (clamped to month start if needed)
  endDate: string;     // "2026-02-08" (clamped to month end if needed)
}

/**
 * Get week options for a given month. Each week starts on Monday (matching getWeekKey).
 * Start/end dates are clamped to the month boundaries.
 */
export function getWeekOptionsForMonth(year: number, month: number): WeekOption[] {
  const monthStart = startOfMonth(new Date(year, month - 1));
  const monthEnd = endOfMonth(new Date(year, month - 1));

  const options: WeekOption[] = [];
  // Start from the Monday of the week containing the 1st of the month
  let weekMonday = startOfWeek(monthStart, { weekStartsOn: 1 });

  while (!isAfter(weekMonday, monthEnd)) {
    const weekSunday = endOfWeek(weekMonday, { weekStartsOn: 1 });

    // Clamp to month boundaries
    const clampedStart = isBefore(weekMonday, monthStart) ? monthStart : weekMonday;
    const clampedEnd = isAfter(weekSunday, monthEnd) ? monthEnd : weekSunday;

    // Label uses the clamped start date: "Week of Feb 2"
    const label = `Week of ${format(clampedStart, 'MMM d')}`;

    options.push({
      label,
      value: format(weekMonday, 'yyyy-MM-dd'),
      startDate: format(clampedStart, 'yyyy-MM-dd'),
      endDate: format(clampedEnd, 'yyyy-MM-dd'),
    });

    weekMonday = addWeeks(weekMonday, 1);
  }

  return options;
}

export function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return hours.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getWeekKey(dateStr: string): string {
  const date = new Date(dateStr);
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  return format(weekStart, 'yyyy-MM-dd');
}

/**
 * Helper to get the grouping key for a resource.
 * Uses user_id -> displayName mapping (from associations) if available,
 * otherwise falls back to user_name.
 */
function getResourceKey(
  entry: TimesheetEntry,
  userIdToDisplayNameLookup?: Map<string, string>
): string {
  // If we have associations, check if this user_id maps to a resource
  if (userIdToDisplayNameLookup && entry.user_id) {
    const associatedName = userIdToDisplayNameLookup.get(entry.user_id);
    if (associatedName) {
      return associatedName;
    }
  }
  // Fall back to user_name from the entry
  return entry.user_name;
}

export function aggregateByProject(
  entries: TimesheetEntry[],
  displayNameLookup?: Map<string, string>,
  userIdToDisplayNameLookup?: Map<string, string>,
  companyCanonicalLookup?: Map<string, string>,
  projectCanonicalLookup?: Map<string, string>
): ProjectSummary[] {
  const projectMap = new Map<string, {
    totalMinutes: number;
    clientId: string;
    clientName: string;
    resourceMap: Map<string, {
      totalMinutes: number;
      weeklyMinutes: Map<string, number>;
      taskMap: Map<string, {
        totalMinutes: number;
        entries: { date: string; minutes: number }[];
      }>;
    }>;
  }>();

  for (const entry of entries) {
    // Get canonical project name via ID lookup only - no name fallbacks
    // If project_id is missing or not in lookup, use 'Unknown Project'
    const canonicalProjectName = entry.project_id && projectCanonicalLookup?.has(entry.project_id)
      ? projectCanonicalLookup.get(entry.project_id)!
      : entry.project_id || 'Unknown Project';

    // Get canonical company name via ID lookup only - no name fallbacks
    const canonicalCompanyName = entry.client_id && companyCanonicalLookup?.has(entry.client_id)
      ? companyCanonicalLookup.get(entry.client_id)!
      : null;

    // Get or create project (using canonical name for grouping)
    if (!projectMap.has(canonicalProjectName)) {
      projectMap.set(canonicalProjectName, {
        totalMinutes: 0,
        clientId: entry.client_id || '',
        clientName: canonicalCompanyName || 'Unknown',
        resourceMap: new Map(),
      });
    }
    const project = projectMap.get(canonicalProjectName)!;
    project.totalMinutes += entry.total_minutes;

    // Get resource key - uses associations if available
    const resourceKey = getResourceKey(entry, userIdToDisplayNameLookup);

    // Get or create resource
    if (!project.resourceMap.has(resourceKey)) {
      project.resourceMap.set(resourceKey, {
        totalMinutes: 0,
        weeklyMinutes: new Map(),
        taskMap: new Map(),
      });
    }
    const resource = project.resourceMap.get(resourceKey)!;
    resource.totalMinutes += entry.total_minutes;

    // Track weekly minutes
    const weekKey = getWeekKey(entry.work_date);
    resource.weeklyMinutes.set(
      weekKey,
      (resource.weeklyMinutes.get(weekKey) || 0) + entry.total_minutes
    );

    // Get or create task
    if (!resource.taskMap.has(entry.task_name)) {
      resource.taskMap.set(entry.task_name, {
        totalMinutes: 0,
        entries: [],
      });
    }
    const task = resource.taskMap.get(entry.task_name)!;
    task.totalMinutes += entry.total_minutes;
    task.entries.push({ date: entry.work_date, minutes: entry.total_minutes });
  }

  // Convert maps to arrays
  const projects: ProjectSummary[] = [];
  for (const [projectName, projectData] of projectMap) {
    const resources: ResourceSummary[] = [];
    for (const [userName, resourceData] of projectData.resourceMap) {
      const tasks: TaskSummary[] = [];
      for (const [taskName, taskData] of resourceData.taskMap) {
        tasks.push({
          taskName,
          totalMinutes: taskData.totalMinutes,
          entries: taskData.entries.sort((a, b) => b.date.localeCompare(a.date)),
        });
      }
      resources.push({
        userName,
        displayName: displayNameLookup?.get(userName) || 'Unknown',
        totalMinutes: resourceData.totalMinutes,
        weeklyMinutes: resourceData.weeklyMinutes,
        tasks: tasks.sort((a, b) => b.totalMinutes - a.totalMinutes),
      });
    }
    projects.push({
      projectName,
      totalMinutes: projectData.totalMinutes,
      resources: resources.sort((a, b) => b.totalMinutes - a.totalMinutes),
      clientId: projectData.clientId,
      clientName: projectData.clientName,
    });
  }

  return projects.sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export function aggregateByResource(
  entries: TimesheetEntry[],
  displayNameLookup?: Map<string, string>,
  userIdToDisplayNameLookup?: Map<string, string>
): ResourceSummary[] {
  const resourceMap = new Map<string, {
    totalMinutes: number;
    weeklyMinutes: Map<string, number>;
    taskMap: Map<string, {
      totalMinutes: number;
      entries: { date: string; minutes: number }[];
    }>;
  }>();

  // Track which resource keys were resolved from userIdToDisplayNameLookup
  // (meaning the key itself IS already the canonical display name)
  const resolvedFromUserId = new Set<string>();

  for (const entry of entries) {
    // Get resource key - uses associations if available
    const resourceKey = getResourceKey(entry, userIdToDisplayNameLookup);

    // Check if this key was resolved from userIdToDisplayNameLookup
    if (userIdToDisplayNameLookup && entry.user_id) {
      const resolvedName = userIdToDisplayNameLookup.get(entry.user_id);
      if (resolvedName && resolvedName === resourceKey) {
        resolvedFromUserId.add(resourceKey);
      }
    }

    if (!resourceMap.has(resourceKey)) {
      resourceMap.set(resourceKey, {
        totalMinutes: 0,
        weeklyMinutes: new Map(),
        taskMap: new Map(),
      });
    }
    const resource = resourceMap.get(resourceKey)!;
    resource.totalMinutes += entry.total_minutes;

    const weekKey = getWeekKey(entry.work_date);
    resource.weeklyMinutes.set(
      weekKey,
      (resource.weeklyMinutes.get(weekKey) || 0) + entry.total_minutes
    );

    if (!resource.taskMap.has(entry.task_name)) {
      resource.taskMap.set(entry.task_name, {
        totalMinutes: 0,
        entries: [],
      });
    }
    const task = resource.taskMap.get(entry.task_name)!;
    task.totalMinutes += entry.total_minutes;
    task.entries.push({ date: entry.work_date, minutes: entry.total_minutes });
  }

  const resources: ResourceSummary[] = [];
  for (const [userName, data] of resourceMap) {
    const tasks: TaskSummary[] = [];
    for (const [taskName, taskData] of data.taskMap) {
      tasks.push({
        taskName,
        totalMinutes: taskData.totalMinutes,
        entries: taskData.entries.sort((a, b) => b.date.localeCompare(a.date)),
      });
    }

    // If userName was resolved from userIdToDisplayNameLookup, it's already the display name
    // Otherwise, try to look it up in displayNameLookup (keyed by external_label)
    const displayName = resolvedFromUserId.has(userName)
      ? userName
      : (displayNameLookup?.get(userName) || 'Unknown');

    resources.push({
      userName,
      displayName,
      totalMinutes: data.totalMinutes,
      weeklyMinutes: data.weeklyMinutes,
      tasks: tasks.sort((a, b) => b.totalMinutes - a.totalMinutes),
    });
  }

  return resources.sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export interface UnderHoursResource {
  userName: string;
  displayName: string;
  actualHours: number;
  expectedHours: number;
  deficit: number;
}

export function getUnderHoursResources(
  resources: ResourceSummary[],
  endDate: Date,
  monthlyTargetHours: number = 140
): UnderHoursResource[] {
  // Calculate prorated expected hours based on working days (excluding weekends & Bulgarian holidays)
  const { total: totalWorkingDays, elapsed: elapsedWorkingDays } = getWorkingDaysInMonth(endDate);

  // Avoid division by zero
  if (totalWorkingDays === 0) {
    return [];
  }

  const proratedHours = monthlyTargetHours * (elapsedWorkingDays / totalWorkingDays);
  const proratedMinutes = proratedHours * 60;

  const underHours: UnderHoursResource[] = [];

  for (const resource of resources) {
    // totalMinutes is already the sum across all projects for this resource
    if (resource.totalMinutes < proratedMinutes) {
      const actualHours = resource.totalMinutes / 60;
      underHours.push({
        userName: resource.userName,
        displayName: resource.displayName,
        actualHours,
        expectedHours: proratedHours,
        deficit: proratedHours - actualHours,
      });
    }
  }

  // Sort by deficit (largest deficit first)
  return underHours.sort((a, b) => b.deficit - a.deficit);
}

export function getProratedExpectedHours(endDate: Date, monthlyTargetHours: number = 140): number {
  const { total: totalWorkingDays, elapsed: elapsedWorkingDays } = getWorkingDaysInMonth(endDate);

  if (totalWorkingDays === 0) {
    return 0;
  }

  return monthlyTargetHours * (elapsedWorkingDays / totalWorkingDays);
}

export function getWorkingDaysInfo(endDate: Date): { total: number; elapsed: number } {
  return getWorkingDaysInMonth(endDate);
}
