import { startOfWeek, format } from 'date-fns';
import { getWorkingDaysInMonth } from './holidays';
import type { TimesheetEntry, ProjectSummary, ResourceSummary, TaskSummary } from '../types';

export function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return hours.toFixed(1);
}

export function getWeekKey(dateStr: string): string {
  const date = new Date(dateStr);
  const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  return format(weekStart, 'yyyy-MM-dd');
}

export function aggregateByProject(
  entries: TimesheetEntry[],
  displayNameLookup?: Map<string, string>
): ProjectSummary[] {
  const projectMap = new Map<string, {
    totalMinutes: number;
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
    // Get or create project
    if (!projectMap.has(entry.project_name)) {
      projectMap.set(entry.project_name, {
        totalMinutes: 0,
        resourceMap: new Map(),
      });
    }
    const project = projectMap.get(entry.project_name)!;
    project.totalMinutes += entry.total_minutes;

    // Get or create resource
    if (!project.resourceMap.has(entry.user_name)) {
      project.resourceMap.set(entry.user_name, {
        totalMinutes: 0,
        weeklyMinutes: new Map(),
        taskMap: new Map(),
      });
    }
    const resource = project.resourceMap.get(entry.user_name)!;
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
        displayName: displayNameLookup?.get(userName) || userName,
        totalMinutes: resourceData.totalMinutes,
        weeklyMinutes: resourceData.weeklyMinutes,
        tasks: tasks.sort((a, b) => b.totalMinutes - a.totalMinutes),
      });
    }
    projects.push({
      projectName,
      totalMinutes: projectData.totalMinutes,
      resources: resources.sort((a, b) => b.totalMinutes - a.totalMinutes),
    });
  }

  return projects.sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export function aggregateByResource(
  entries: TimesheetEntry[],
  displayNameLookup?: Map<string, string>
): ResourceSummary[] {
  const resourceMap = new Map<string, {
    totalMinutes: number;
    weeklyMinutes: Map<string, number>;
    taskMap: Map<string, {
      totalMinutes: number;
      entries: { date: string; minutes: number }[];
    }>;
  }>();

  for (const entry of entries) {
    if (!resourceMap.has(entry.user_name)) {
      resourceMap.set(entry.user_name, {
        totalMinutes: 0,
        weeklyMinutes: new Map(),
        taskMap: new Map(),
      });
    }
    const resource = resourceMap.get(entry.user_name)!;
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
    resources.push({
      userName,
      displayName: displayNameLookup?.get(userName) || userName,
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
