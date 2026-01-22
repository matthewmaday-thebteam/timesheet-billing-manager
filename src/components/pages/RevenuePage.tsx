import { useState, useMemo, useCallback } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useProjects } from '../../hooks/useProjects';
import { calculateProjectRevenue, formatCurrency, buildDbRateLookupByName, getEffectiveRate } from '../../utils/billing';
import { DateRangeFilter } from '../DateRangeFilter';
import { RevenueTable } from '../atoms/RevenueTable';
import { Spinner } from '../Spinner';
import { Button } from '../Button';
import type { DateRange } from '../../types';

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

  // Calculate total revenue
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);
  const totalRevenue = useMemo(() => {
    return projects.reduce(
      (sum, p) => sum + calculateProjectRevenue(p, {}, dbRateLookup),
      0
    );
  }, [projects, dbRateLookup]);

  // Export to CSV
  const handleExportCSV = useCallback(() => {
    // Build CSV data from entries
    const csvRows: string[][] = [];

    // Header row
    csvRows.push(['Company', 'Project', 'Task', 'Hours', 'Rate', 'Revenue']);

    // Data rows - aggregate by company/project/task
    const taskMap = new Map<string, { company: string; project: string; task: string; minutes: number; rate: number }>();

    for (const entry of entries) {
      const company = entry.client_name || 'Unassigned';
      const project = entry.project_name;
      const task = entry.task_name || 'No Task';
      const key = `${company}|${project}|${task}`;

      const rate = getEffectiveRate(project, dbRateLookup, {});

      if (taskMap.has(key)) {
        taskMap.get(key)!.minutes += entry.total_minutes;
      } else {
        taskMap.set(key, { company, project, task, minutes: entry.total_minutes, rate });
      }
    }

    // Convert to CSV rows sorted by company, project, task
    const sortedEntries = Array.from(taskMap.values()).sort((a, b) => {
      if (a.company !== b.company) return a.company.localeCompare(b.company);
      if (a.project !== b.project) return a.project.localeCompare(b.project);
      return a.task.localeCompare(b.task);
    });

    for (const item of sortedEntries) {
      const hours = (item.minutes / 60).toFixed(2);
      const revenue = ((item.minutes / 60) * item.rate).toFixed(2);
      csvRows.push([
        item.company,
        item.project,
        item.task,
        hours,
        item.rate.toFixed(2),
        revenue,
      ]);
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
  }, [entries, dbRateLookup, dateRange.start]);

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
        />
      )}
    </div>
  );
}
