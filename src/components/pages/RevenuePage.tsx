import { useState, useMemo, useCallback } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useProjects } from '../../hooks/useProjects';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { calculateProjectRevenue, formatCurrency, buildDbRateLookupByName, getEffectiveRate, applyRounding, DEFAULT_ROUNDING_INCREMENT } from '../../utils/billing';
import { DateRangeFilter } from '../DateRangeFilter';
import { RevenueTable } from '../atoms/RevenueTable';
import { Spinner } from '../Spinner';
import { Button } from '../Button';
import type { DateRange, MonthSelection, RoundingIncrement } from '../../types';

export function RevenuePage() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  const { projects, entries, loading, error } = useTimesheetData(dateRange);
  const { projects: dbProjects } = useProjects();

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates (which now includes rounding data)
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Build rounding lookup by EXTERNAL project ID (Clockify/ClickUp ID)
  // This matches the project_id in timesheet entries
  const roundingByProjectId = useMemo(() => {
    const map = new Map<string, RoundingIncrement>();

    for (const p of projectsWithRates) {
      // Use externalProjectId, not projectId (UUID)
      if (p.externalProjectId) {
        const roundingValue = typeof p.effectiveRounding === 'number'
          ? p.effectiveRounding
          : Number(p.effectiveRounding);
        if ([0, 5, 15, 30].includes(roundingValue)) {
          map.set(p.externalProjectId, roundingValue as RoundingIncrement);
        }
      }
    }

    return map;
  }, [projectsWithRates]);

  // Calculate total revenue
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);
  const totalRevenue = useMemo(() => {
    // Get rounding for each project and apply it
    return projects.reduce((sum, p) => {
      // Find the project in projectsWithRates by name to get its rounding
      const projectData = projectsWithRates.find(pr => pr.projectName === p.projectName);
      const rounding = projectData?.effectiveRounding ?? DEFAULT_ROUNDING_INCREMENT;
      return sum + calculateProjectRevenue(p, {}, dbRateLookup, rounding);
    }, 0);
  }, [projects, dbRateLookup, projectsWithRates]);

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    // Build CSV data from entries
    const csvRows: string[][] = [];

    // Title row
    csvRows.push([`Revenue for the month of ${format(dateRange.start, 'MMMM yyyy')}`]);

    // Header row
    csvRows.push(['Company', 'Project', 'Task', 'Actual', 'Hours', 'Rounding', 'Rate ($/hr)', 'Revenue']);

    // Data rows - aggregate by company/project/task
    const taskMap = new Map<string, { company: string; project: string; projectId: string | null; task: string; minutes: number; rate: number }>();

    for (const entry of entries) {
      const company = entry.client_name || 'Unassigned';
      const project = entry.project_name;
      const projectId = entry.project_id;
      const task = entry.task_name || 'No Task';
      const key = `${company}|${project}|${task}`;

      const rate = getEffectiveRate(project, dbRateLookup, {});

      if (taskMap.has(key)) {
        taskMap.get(key)!.minutes += entry.total_minutes;
      } else {
        taskMap.set(key, { company, project, projectId, task, minutes: entry.total_minutes, rate });
      }
    }

    // Group tasks by project to apply rounding at project level
    const projectMap = new Map<string, { company: string; project: string; projectId: string | null; tasks: { task: string; minutes: number }[]; rate: number; totalMinutes: number }>();

    for (const item of taskMap.values()) {
      const projectKey = `${item.company}|${item.project}`;
      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, {
          company: item.company,
          project: item.project,
          projectId: item.projectId,
          tasks: [],
          rate: item.rate,
          totalMinutes: 0,
        });
      }
      const proj = projectMap.get(projectKey)!;
      proj.tasks.push({ task: item.task, minutes: item.minutes });
      proj.totalMinutes += item.minutes;
    }

    // Convert to CSV rows sorted by company, project, task
    const sortedProjects = Array.from(projectMap.values()).sort((a, b) => {
      if (a.company !== b.company) return a.company.localeCompare(b.company);
      return a.project.localeCompare(b.project);
    });

    for (const proj of sortedProjects) {
      // Get rounding for this project
      const rounding = proj.projectId && roundingByProjectId.has(proj.projectId)
        ? roundingByProjectId.get(proj.projectId)!
        : DEFAULT_ROUNDING_INCREMENT;

      const incLabel = rounding === 0 ? '—' : `${rounding}m`;

      // Sort tasks by minutes
      proj.tasks.sort((a, b) => b.minutes - a.minutes);

      for (const task of proj.tasks) {
        // Apply rounding to each task individually
        const roundedTaskMinutes = applyRounding(task.minutes, rounding);
        const actualHours = (task.minutes / 60).toFixed(2);
        const roundedHours = (roundedTaskMinutes / 60).toFixed(2);
        const taskRevenue = ((roundedTaskMinutes / 60) * proj.rate).toFixed(2);

        csvRows.push([
          proj.company,
          proj.project,
          task.task,
          actualHours,
          roundedHours,
          incLabel,
          proj.rate.toFixed(2),
          taskRevenue,
        ]);
      }
    }

    // Convert to CSV string
    const csvContent = csvRows
      .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `revenue-${format(dateRange.start, 'yyyy-MM')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [entries, dbRateLookup, roundingByProjectId, dateRange.start]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Revenue</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Revenue for the month of <span className="text-bteam-brand font-medium">{format(dateRange.start, 'MMMM yyyy')}</span>
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(totalRevenue)}</span>
          </div>
        )}
      </div>

      {/* Date Range Filter with Export */}
      <DateRangeFilter
        dateRange={dateRange}
        onChange={setDateRange}
        hideCustomRange={true}
        rightContent={
          <Button
            variant="secondary"
            onClick={handleExportCSV}
            disabled={loading || entries.length === 0}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </Button>
        }
      />

      {/* Error State */}
      {error && (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-error">{error}</span>
          </div>
        </div>
      )}

      {/* Billing Rates Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading timesheet data...</span>
        </div>
      ) : (
        <RevenueTable
          entries={entries}
          roundingByProjectId={roundingByProjectId}
        />
      )}
    </div>
  );
}
