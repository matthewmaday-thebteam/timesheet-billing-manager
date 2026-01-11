import { useState, useCallback, useMemo } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { useTimesheetData } from '../hooks/useTimesheetData';
import { useProjects } from '../hooks/useProjects';
import { getUnderHoursResources, getProratedExpectedHours, getWorkingDaysInfo } from '../utils/calculations';
import { getBillingRates, calculateTotalRevenue, buildDbRateLookupByName } from '../utils/billing';
import { DateRangeFilter } from './DateRangeFilter';
import { StatsOverview } from './StatsOverview';
import { ProjectCard } from './ProjectCard';
import { BillingRatesTable } from './BillingRatesTable';
import { UnderHoursModal } from './UnderHoursModal';
import { Spinner } from './Spinner';
import { Button } from './Button';
import type { DateRange } from '../types';

export function Dashboard() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: startOfMonth(now),
      end: endOfMonth(now),
    };
  });

  // Modal state for under hours
  const [isUnderHoursModalOpen, setIsUnderHoursModalOpen] = useState(false);

  // Force re-render when billing rates change
  const [ratesVersion, setRatesVersion] = useState(0);
  const handleRatesChange = useCallback(() => {
    setRatesVersion(v => v + 1);
  }, []);

  const { entries, projects, resources, loading, error, refetch } = useTimesheetData(dateRange);
  const { projects: dbProjects } = useProjects();

  // Use the earlier of: end of selected range or today
  const effectiveEndDate = dateRange.end > new Date() ? new Date() : dateRange.end;
  const expectedHours = getProratedExpectedHours(effectiveEndDate);
  const workingDays = getWorkingDaysInfo(effectiveEndDate);
  const underHoursItems = getUnderHoursResources(resources, effectiveEndDate);

  // Build database rate lookup
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Calculate revenue (re-calculates when ratesVersion or dbProjects changes)
  const rates = getBillingRates();
  const totalRevenue = calculateTotalRevenue(projects, rates, dbRateLookup);
  // Use ratesVersion to ensure React sees this as a dependency
  void ratesVersion;

  return (
    <>
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Page Header */}
        <section>
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-vercel-gray-600">
              Timesheet Dashboard
            </h2>
            <Button variant="secondary" size="sm" onClick={refetch}>
              Refresh
            </Button>
          </div>
        </section>

        <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />

        {error && (
          <div className="p-4 bg-white border border-error rounded-lg">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-error" />
              <span className="text-sm text-error">Error loading data: {error}</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
            <span className="ml-3 text-sm text-vercel-gray-400">Loading timesheet data...</span>
          </div>
        ) : (
          <>
            <StatsOverview
              projects={projects}
              resources={resources}
              underHoursCount={underHoursItems.length}
              totalRevenue={totalRevenue}
              onUnderHoursClick={() => setIsUnderHoursModalOpen(true)}
            />

            {/* Billing Rates Section */}
            <section>
              <div className="flex justify-between items-end mb-4">
                <h2 className="text-lg font-semibold tracking-tight text-vercel-gray-600">
                  Billing & Revenue
                </h2>
              </div>
              <BillingRatesTable
                projects={projects}
                onRatesChange={handleRatesChange}
              />
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
