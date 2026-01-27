import { useState, useMemo, useCallback, useEffect } from 'react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { useTimesheetData } from '../hooks/useTimesheetData';
import { useProjects } from '../hooks/useProjects';
import { useProjectTableEntities } from '../hooks/useProjectTableEntities';
import { useMonthlyRates } from '../hooks/useMonthlyRates';
import { useUnifiedBilling } from '../hooks/useUnifiedBilling';
import { useCanonicalCompanyMapping } from '../hooks/useCanonicalCompanyMapping';
import { useResources } from '../hooks/useResources';
import { useTimeOff } from '../hooks/useTimeOff';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { BulgarianHoliday } from '../types';
import { getUnderHoursResources, getProratedExpectedHours, getWorkingDaysInfo } from '../utils/calculations';
import { buildDbRateLookup } from '../utils/billing';
import { RangeSelector } from './atoms/RangeSelector';
import { DashboardChartsRow } from './DashboardChartsRow';
import { StatsOverview } from './StatsOverview';
import { ProjectCard } from './ProjectCard';
import { UnderHoursModal } from './UnderHoursModal';
import { Spinner } from './Spinner';
import { Button } from './Button';
import { Card } from './Card';
import { DailyHoursChart } from './atoms/charts/DailyHoursChart';
import type { DateRange, MonthSelection } from '../types';
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

  const { entries, projects, resources: resourceSummaries, monthlyAggregates, projectCanonicalIdLookup, userIdToDisplayNameLookup, loading, error, refetch } = useTimesheetData(
    dateRange,
    { extendedMonths: HISTORICAL_MONTHS }
  );
  const { projects: dbProjects } = useProjects();

  // Fetch canonical project count from v_project_table_entities (per Formulas page definition)
  const { projects: canonicalProjects } = useProjectTableEntities();

  // Fetch actual employee/resource data for expected hours calculation
  const { resources: employees } = useResources();

  // Fetch time-off data for the selected period
  const { timeOff } = useTimeOff({
    startDate: dateRange.start,
    endDate: dateRange.end,
    approvedOnly: true,
  });

  // Fetch holidays for the selected month
  const [holidays, setHolidays] = useState<BulgarianHoliday[]>([]);
  useEffect(() => {
    async function fetchHolidays() {
      const year = dateRange.start.getFullYear();
      const { data } = await supabase
        .from('bulgarian_holidays')
        .select('*')
        .eq('year', year);
      setHolidays(data || []);
    }
    fetchHolidays();
  }, [dateRange.start]);

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Get canonical company mapping
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // Use the earlier of: end of selected range or today
  const effectiveEndDate = dateRange.end > new Date() ? new Date() : dateRange.end;
  const expectedHours = getProratedExpectedHours(effectiveEndDate);
  const workingDays = getWorkingDaysInfo(effectiveEndDate);
  const underHoursItems = getUnderHoursResources(resourceSummaries, effectiveEndDate);

  // Build database rate lookup by external project_id (fallback for projects not in monthly rates)
  const dbRateLookup = useMemo(() => buildDbRateLookup(dbProjects), [dbProjects]);

  // Helper to get canonical company name (ID-only lookup, no name fallbacks)
  const getCanonicalCompanyName = useCallback((clientId: string, _clientName: string): string => {
    const canonicalInfo = clientId ? getCanonicalCompany(clientId) : null;
    return canonicalInfo?.canonicalDisplayName || 'Unknown';
  }, [getCanonicalCompany]);

  // Use unified billing calculation - single source of truth
  // CRITICAL: ID-based lookups only, no name fallbacks
  const { totalRevenue, billingResult } = useUnifiedBilling({
    entries,
    projectsWithRates,
    getCanonicalCompanyName,
    projectCanonicalIdLookup,
  });

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

        <RangeSelector variant="dateRange" dateRange={dateRange} onChange={setDateRange} />

        {/* Stats Overview - Above Charts */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
            <span className="ml-3 text-sm text-vercel-gray-400">Loading timesheet data...</span>
          </div>
        ) : (
          <StatsOverview
            projects={projects}
            projectCount={canonicalProjects.length}
            resources={resourceSummaries}
            underHoursCount={underHoursItems.length}
            totalRevenue={totalRevenue}
            onUnderHoursClick={() => setIsUnderHoursModalOpen(true)}
          />
        )}

        {/* Charts Section: Resources + Trends with consistent internal spacing */}
        <div className="space-y-4">
          {/* Resources Charts: Hours by Resource + Top 5 lists */}
          <DashboardChartsRow
            resources={resourceSummaries}
            entries={entries}
            monthlyAggregates={monthlyAggregates}
            projectRates={dbRateLookup}
            projectCanonicalIdLookup={projectCanonicalIdLookup}
            billingResult={billingResult}
            currentMonthRevenue={totalRevenue}
            loading={loading}
            section="resources"
          />

          {/* Daily Hours Chart */}
          <Card variant="default" padding="lg">
            <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
              Resource Utilization - {format(dateRange.start, 'MMMM yyyy')}
            </h3>
            <DailyHoursChart
              entries={entries}
              startDate={dateRange.start}
              endDate={dateRange.end}
              holidays={holidays}
              resources={employees}
              timeOff={timeOff}
            />
          </Card>

          {/* Trend Charts: Revenue Trend + MoM + CAGR */}
          <DashboardChartsRow
            resources={resourceSummaries}
            entries={entries}
            monthlyAggregates={monthlyAggregates}
            projectRates={dbRateLookup}
            projectCanonicalIdLookup={projectCanonicalIdLookup}
            billingResult={billingResult}
            currentMonthRevenue={totalRevenue}
            loading={loading}
            section="trends"
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
        userIdToDisplayNameLookup={userIdToDisplayNameLookup}
      />
    </>
  );
}
