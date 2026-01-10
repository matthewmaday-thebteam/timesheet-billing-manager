import { useState } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { useTimesheetData } from '../hooks/useTimesheetData';
import { getUnderHoursResources, getProratedExpectedHours, getWorkingDaysInfo } from '../utils/calculations';
import { DateRangeFilter } from './DateRangeFilter';
import { StatsOverview } from './StatsOverview';
import { UnderHoursAlert } from './UnderHoursAlert';
import { ProjectCard } from './ProjectCard';
import type { DateRange } from '../types';

export function Dashboard() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  const { projects, resources, loading, error, refetch } = useTimesheetData(dateRange);

  // Use the earlier of: end of selected range or today
  const effectiveEndDate = dateRange.end > new Date() ? new Date() : dateRange.end;
  const expectedHours = getProratedExpectedHours(effectiveEndDate);
  const workingDays = getWorkingDaysInfo(effectiveEndDate);
  const underHoursItems = getUnderHoursResources(resources, effectiveEndDate);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Timesheet Dashboard</h1>
            <button
              onClick={refetch}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            Error loading data: {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">Loading timesheet data...</span>
          </div>
        ) : (
          <>
            <UnderHoursAlert
              items={underHoursItems}
              expectedHours={expectedHours}
              workingDaysElapsed={workingDays.elapsed}
              workingDaysTotal={workingDays.total}
            />

            <StatsOverview
              projects={projects}
              resources={resources}
              underHoursCount={underHoursItems.length}
            />

            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
              {projects.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-white rounded-lg border border-gray-200">
                  No timesheet data found for this period
                </div>
              ) : (
                projects.map((project) => (
                  <ProjectCard key={project.projectName} project={project} />
                ))
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
