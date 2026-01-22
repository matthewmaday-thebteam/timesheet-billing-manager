import { useState, useMemo } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { useTimesheetData } from '../hooks/useTimesheetData';
import { useProjects } from '../hooks/useProjects';
import { useAuth } from '../contexts/AuthContext';
import { getUnderHoursResources, getProratedExpectedHours, getWorkingDaysInfo } from '../utils/calculations';
import { getBillingRates, calculateTotalRevenue, buildDbRateLookupByName } from '../utils/billing';
import { DateRangeFilter } from './DateRangeFilter';
import { DashboardChartsRow } from './DashboardChartsRow';
import { StatsOverview } from './StatsOverview';
import { ProjectCard } from './ProjectCard';
import { EmployeePerformance } from './EmployeePerformance';
import { UnderHoursModal } from './UnderHoursModal';
import { Spinner } from './Spinner';
import { Button } from './Button';
import type { DateRange } from '../types';
import { HISTORICAL_MONTHS } from '../config/chartConfig';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function Dashboard() {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  // Modal state for under hours
  const [isUnderHoursModalOpen, setIsUnderHoursModalOpen] = useState(false);

  // Get user's name for greeting
  const firstName = user?.user_metadata?.first_name || '';
  const lastName = user?.user_metadata?.last_name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'User';

  const { entries, projects, resources, monthlyAggregates, loading, error, refetch } = useTimesheetData(
    dateRange,
    { extendedMonths: HISTORICAL_MONTHS }
  );
  const { projects: dbProjects } = useProjects();

  // Use the earlier of: end of selected range or today
  const effectiveEndDate = dateRange.end > new Date() ? new Date() : dateRange.end;
  const expectedHours = getProratedExpectedHours(effectiveEndDate);
  const workingDays = getWorkingDaysInfo(effectiveEndDate);
  const underHoursItems = getUnderHoursResources(resources, effectiveEndDate);

  // Build database rate lookup
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Calculate revenue
  const rates = getBillingRates();
  const totalRevenue = calculateTotalRevenue(projects, rates, dbRateLookup);

  return (
    <>
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Greeting Section */}
        <section>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-vercel-gray-600">
                {getGreeting()}, {displayName}
              </h1>
              <p className="text-base text-vercel-gray-600 mt-1">
                This is what is going on with <span className="text-bteam-brand font-medium">The B Team</span> today
              </p>
            </div>
            <Button variant="secondary" onClick={refetch}>
              Refresh
            </Button>
          </div>
        </section>

        <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />

        {/* Stats Overview - Above Charts */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
            <span className="ml-3 text-sm text-vercel-gray-400">Loading timesheet data...</span>
          </div>
        ) : (
          <StatsOverview
            projects={projects}
            resources={resources}
            underHoursCount={underHoursItems.length}
            totalRevenue={totalRevenue}
            onUnderHoursClick={() => setIsUnderHoursModalOpen(true)}
          />
        )}

        {/* Charts */}
        <div className="space-y-3">
          <DashboardChartsRow
            resources={resources}
            entries={entries}
            monthlyAggregates={monthlyAggregates}
            projectRates={dbRateLookup}
            loading={loading}
          />

          {error && (
            <div className="p-4 bg-white border border-error rounded-lg">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-error" />
                <span className="text-sm text-error">Error loading data: {error}</span>
              </div>
            </div>
          )}
        </div>

        {!loading && (
          <>

            {/* Itemized Reports Section */}
            <section>
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-lg font-semibold tracking-tight text-vercel-gray-600">
                  Itemized Reports
                </h2>
              </div>
              <div className="space-y-3">
                <EmployeePerformance
                  projects={projects}
                  dbRateLookup={dbRateLookup}
                />
              </div>
            </section>

            {/* Projects Section */}
            <section>
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-lg font-semibold tracking-tight text-vercel-gray-600">
                  Projects
                </h2>
              </div>
              {projects.length === 0 ? (
                <div className="text-center py-8 bg-white rounded-lg border border-vercel-gray-100">
                  <p className="text-sm text-vercel-gray-400">No timesheet data found for this period</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects.map((project) => (
                    <ProjectCard key={project.projectName} project={project} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Under Hours Modal */}
      <UnderHoursModal
        isOpen={isUnderHoursModalOpen}
        onClose={() => setIsUnderHoursModalOpen(false)}
        items={underHoursItems}
        entries={entries}
        expectedHours={expectedHours}
        workingDaysElapsed={workingDays.elapsed}
        workingDaysTotal={workingDays.total}
      />
    </>
  );
}
