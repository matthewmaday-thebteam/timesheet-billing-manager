import { useState, useCallback } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { useTimesheetData } from '../hooks/useTimesheetData';
import { getUnderHoursResources, getProratedExpectedHours, getWorkingDaysInfo } from '../utils/calculations';
import { getBillingRates, calculateTotalRevenue } from '../utils/billing';
import { DateRangeFilter } from './DateRangeFilter';
import { StatsOverview } from './StatsOverview';
import { ProjectCard } from './ProjectCard';
import { BillingRatesTable } from './BillingRatesTable';
import { UnderHoursModal } from './UnderHoursModal';
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

  const { projects, resources, loading, error, refetch } = useTimesheetData(dateRange);

  // Use the earlier of: end of selected range or today
  const effectiveEndDate = dateRange.end > new Date() ? new Date() : dateRange.end;
  const expectedHours = getProratedExpectedHours(effectiveEndDate);
  const workingDays = getWorkingDaysInfo(effectiveEndDate);
  const underHoursItems = getUnderHoursResources(resources, effectiveEndDate);

  // Calculate revenue (re-calculates when ratesVersion changes)
  const rates = getBillingRates();
  const totalRevenue = calculateTotalRevenue(projects, rates);
  // Use ratesVersion to ensure React sees this as a dependency
  void ratesVersion;

  return (
    <>
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Page Header */}
        <section>
          <div className="flex justify-between items-end mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-[#000000]">
              Timesheet Dashboard
            </h2>
            <button
              onClick={refetch}
              className="px-3 py-1.5 text-sm border border-[#EAEAEA] rounded-md hover:bg-[#FAFAFA] transition-colors text-[#000000] focus:ring-1 focus:ring-black focus:outline-none"
            >
              Refresh
            </button>
          </div>
        </section>

        <DateRangeFilter dateRange={dateRange} onChange={setDateRange} />

        {error && (
          <div className="p-4 bg-[#FFFFFF] border border-[#EE0000] rounded-lg">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#EE0000]" />
              <span className="text-sm text-[#EE0000]">Error loading data: {error}</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#EAEAEA] border-t-[#000000]" />
            <span className="ml-3 text-sm text-[#666666]">Loading timesheet data...</span>
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
                <h2 className="text-lg font-semibold tracking-tight text-[#000000]">
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
                <h2 className="text-lg font-semibold tracking-tight text-[#000000]">
                  Projects
                </h2>
              </div>
              {projects.length === 0 ? (
                <div className="text-center py-8 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
                  <p className="text-sm text-[#666666]">No timesheet data found for this period</p>
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
        expectedHours={expectedHours}
        workingDaysElapsed={workingDays.elapsed}
        workingDaysTotal={workingDays.total}
      />
    </>
  );
}
