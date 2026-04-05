/**
 * Raw Source Parsing Utilities
 *
 * Parse Clockify and ClickUp JSON exports into normalized entries
 * for validation against processed billing data.
 */

import type {
  NormalizedEntry,
  RawClockifyExport,
  RawClickUpExport,
  ProjectEntryGroup,
} from './types';

/**
 * Parse Clockify JSON export into normalized entries.
 *
 * Clockify format:
 * - Array wrapper with single object containing timeentries
 * - Duration is in seconds
 * - Date is ISO string in timeInterval.start
 *
 * @param content - Raw JSON string from clockify.txt
 * @returns Array of normalized entries
 */
export function parseClockify(content: string): NormalizedEntry[] {
  const data = JSON.parse(content) as RawClockifyExport[];

  // Handle both array wrapper and direct object
  const exportData = Array.isArray(data) ? data[0] : data;

  if (!exportData?.timeentries || !Array.isArray(exportData.timeentries)) {
    throw new Error('Invalid Clockify format: missing timeentries array');
  }

  return exportData.timeentries.map((entry) => ({
    source: 'clockify' as const,
    entryId: entry._id,
    projectId: entry.projectId || 'unknown',
    projectName: entry.projectName || 'Unknown Project',
    clientId: entry.clientId || 'unknown',
    clientName: entry.clientName || 'Unknown Client',
    taskName: entry.description || 'No Task',
    userName: entry.userName || 'Unknown User',
    minutes: Math.ceil(entry.timeInterval.duration / 60),  // seconds to whole minutes (matches n8n sync)
    date: entry.timeInterval.start.split('T')[0],  // Extract YYYY-MM-DD
  }));
}

/**
 * Parse ClickUp JSON export into normalized entries.
 *
 * ClickUp format:
 * - Array wrapper with single object containing timeentries + lookups
 * - Duration is in milliseconds as string
 * - Start is timestamp in milliseconds as string
 * - Space = Project (ClickUp spaces are equivalent to projects)
 * - Client is derived from space name (same as project for ClickUp)
 *
 * @param content - Raw JSON string from clickup.txt
 * @returns Array of normalized entries
 */
export function parseClickUp(content: string): NormalizedEntry[] {
  const data = JSON.parse(content) as RawClickUpExport[];

  // Handle both array wrapper and direct object
  const exportData = Array.isArray(data) ? data[0] : data;

  if (!exportData?.timeentries || !Array.isArray(exportData.timeentries)) {
    throw new Error('Invalid ClickUp format: missing timeentries array');
  }

  const { timeentries, spaceLookup = {} } = exportData;

  return timeentries.map((entry) => {
    const spaceId = entry.task_location?.space_id || 'unknown';
    const spaceName = spaceLookup[spaceId] || 'Unknown Project';

    return {
      source: 'clickup' as const,
      entryId: entry.id,
      projectId: spaceId,
      projectName: spaceName,
      clientId: spaceId,  // Use space as both project and client for ClickUp
      clientName: spaceName,
      taskName: entry.task?.name || 'No Task',
      userName: entry.user?.username || 'Unknown User',
      minutes: Math.ceil(Math.floor(parseInt(entry.duration, 10) / 1000) / 60),  // ms → seconds → whole minutes (matches n8n sync)
      date: new Date(parseInt(entry.start, 10)).toISOString().split('T')[0],
    };
  });
}

/**
 * Parse raw source content based on detected format.
 * Attempts to auto-detect whether the content is Clockify or ClickUp format.
 *
 * @param content - Raw JSON string
 * @param hint - Optional hint for format ('clockify' or 'clickup')
 * @returns Array of normalized entries
 */
export function parseRawSource(
  content: string,
  hint?: 'clockify' | 'clickup'
): NormalizedEntry[] {
  const data = JSON.parse(content);
  const exportData = Array.isArray(data) ? data[0] : data;

  // Use hint if provided
  if (hint === 'clockify') {
    return parseClockify(content);
  }
  if (hint === 'clickup') {
    return parseClickUp(content);
  }

  // Auto-detect based on structure
  // ClickUp has spaceLookup/folderLookup, Clockify doesn't
  if (exportData.spaceLookup || exportData.folderLookup) {
    return parseClickUp(content);
  }

  // Clockify entries have timeInterval with duration in seconds
  if (exportData.timeentries?.[0]?.timeInterval?.duration !== undefined) {
    return parseClockify(content);
  }

  // ClickUp entries have duration as string in milliseconds
  if (exportData.timeentries?.[0]?.duration !== undefined) {
    return parseClickUp(content);
  }

  throw new Error('Unable to detect source format. Please specify clockify or clickup.');
}

/**
 * Group normalized entries by project.
 *
 * @param entries - Array of normalized entries
 * @returns Array of project entry groups
 */
export function groupEntriesByProject(entries: NormalizedEntry[]): ProjectEntryGroup[] {
  const groupMap = new Map<string, ProjectEntryGroup>();

  for (const entry of entries) {
    // Create unique key combining source, client, and project
    const key = `${entry.source}:${entry.clientId}:${entry.projectId}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        clientId: entry.clientId,
        clientName: entry.clientName,
        projectId: entry.projectId,
        projectName: entry.projectName,
        source: entry.source,
        entries: [],
        totalMinutes: 0,
      });
    }

    const group = groupMap.get(key)!;
    group.entries.push(entry);
    group.totalMinutes += entry.minutes;
  }

  // Sort by client name, then project name
  return Array.from(groupMap.values()).sort((a, b) => {
    const clientCompare = a.clientName.localeCompare(b.clientName);
    if (clientCompare !== 0) return clientCompare;
    return a.projectName.localeCompare(b.projectName);
  });
}

/**
 * Group entries by task within a project.
 * Used for per-task rounding calculations.
 *
 * @param entries - Array of normalized entries for a single project
 * @returns Map of task name to total minutes
 */
export function groupEntriesByTask(entries: NormalizedEntry[]): Map<string, number> {
  const taskMap = new Map<string, number>();

  for (const entry of entries) {
    const taskName = entry.taskName || 'No Task';
    taskMap.set(taskName, (taskMap.get(taskName) || 0) + entry.minutes);
  }

  return taskMap;
}

/**
 * Filter entries by date range.
 *
 * @param entries - Array of normalized entries
 * @param startDate - Start date (inclusive) YYYY-MM-DD
 * @param endDate - End date (inclusive) YYYY-MM-DD
 * @returns Filtered array of entries
 */
export function filterEntriesByDateRange(
  entries: NormalizedEntry[],
  startDate: string,
  endDate: string
): NormalizedEntry[] {
  return entries.filter((entry) => {
    return entry.date >= startDate && entry.date <= endDate;
  });
}

/**
 * Filter entries for a specific month.
 *
 * @param entries - Array of normalized entries
 * @param year - Year (e.g., 2026)
 * @param month - Month (1-12)
 * @returns Filtered array of entries
 */
export function filterEntriesByMonth(
  entries: NormalizedEntry[],
  year: number,
  month: number
): NormalizedEntry[] {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return filterEntriesByDateRange(entries, startDate, endDate);
}

/**
 * Get unique months from entries.
 *
 * @param entries - Array of normalized entries
 * @returns Array of { year, month } sorted chronologically
 */
export function getUniqueMonths(entries: NormalizedEntry[]): Array<{ year: number; month: number }> {
  const monthSet = new Set<string>();

  for (const entry of entries) {
    const [year, month] = entry.date.split('-');
    monthSet.add(`${year}-${month}`);
  }

  return Array.from(monthSet)
    .map((str) => {
      const [year, month] = str.split('-').map(Number);
      return { year, month };
    })
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
}
