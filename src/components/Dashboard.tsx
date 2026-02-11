import { useState, useMemo, useCallback, useEffect } from 'react';
import { format } from 'date-fns';
import { useTimesheetData } from '../hooks/useTimesheetData';
import { useProjects } from '../hooks/useProjects';
import { useProjectTableEntities } from '../hooks/useProjectTableEntities';
import { useMonthlyRates } from '../hooks/useMonthlyRates';
import { useBilling } from '../hooks/useBilling';
import { useBillings } from '../hooks/useBillings';
import { useCombinedRevenue } from '../hooks/useCombinedRevenue';
import { useCanonicalCompanyMapping } from '../hooks/useCanonicalCompanyMapping';
import { useEmployeeTableEntities } from '../hooks/useEmployeeTableEntities';
import { useTimeOff } from '../hooks/useTimeOff';
import { useUtilizationMetrics } from '../hooks/useUtilizationMetrics';
import { useAuth } from '../contexts/AuthContext';
import { useDateFilter } from '../contexts/DateFilterContext';
import { supabase } from '../lib/supabase';
import type { BulgarianHoliday } from '../types';
import { getUnderHoursResources, getProratedExpectedHours, getWorkingDaysInfo } from '../utils/calculations';
import { buildDbRateLookup } from '../utils/billing';
import { RangeSelector } from './RangeSelector';
import { DashboardChartsRow } from './DashboardChartsRow';
import { StatsOverview } from './StatsOverview';
import { UnderHoursModal } from './UnderHoursModal';
import { Spinner } from './Spinner';
import { Button } from './Button';
import { Card } from './Card';
import { DailyHoursChart } from './atoms/charts/DailyHoursChart';
import type { MonthSelection } from '../types';
import { HISTORICAL_MONTHS } from '../config/chartConfig';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function Dashboard() {
  const { user } = useAuth();
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  // Modal state for under hours
  const [isUnderHoursModalOpen, setIsUnderHoursModalOpen] = useState(false);

  // Get user's name for greeting
  const firstName = user?.user_metadata?.first_name || '';
  const lastName = user?.user_metadata?.last_name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'User';

  const { entries, projects, resources: resourceSummaries, projectCanonicalIdLookup, userIdToDisplayNameLookup, loading, error, refetch } = useTimesheetData(
    dateRange,
    { extendedMonths: HISTORICAL_MONTHS }
  );
  const { projects: dbProjects } = useProjects();

  // Fetch canonical project count from v_project_table_entities (per Formulas page definition)
  const { projects: canonicalProjects } = useProjectTableEntities();

  // Fetch employee entities (excludes grouped members to avoid double-counting)
  const { entities: employees } = useEmployeeTableEntities();

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

  // Fetch fixed billings for the date range (same as Revenue page)
  const { companyBillings, isLoading: billingsLoading } = useBillings({ dateRange });

  // Compute combined revenue for all 12 chart months using same calculation as Revenue page
  const { combinedRevenueByMonth, loading: combinedRevenueLoading } = useCombinedRevenue({
    dateRange,
    extendedMonths: HISTORICAL_MONTHS,
  });

  // Get canonical company mapping
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // For under-hours calculation, use yesterday to avoid partial day issues
  // (e.g., at 7am no hours are booked yet, making everyone appear behind)
  // Exception: first day of month - use today since there's no yesterday in this month
  const now = new Date();
  const isFirstDayOfMonth = now.getDate() === 1;
  let effectiveToday: Date;
  if (isFirstDayOfMonth) {
    effectiveToday = now;
  } else {
    effectiveToday = new Date(now);
    effectiveToday.setDate(effectiveToday.getDate() - 1);
  }
  const effectiveEndDate = dateRange.end > effectiveToday ? effectiveToday : dateRange.end;
  const expectedHours = getProratedExpectedHours(effectiveEndDate);
  const workingDays = getWorkingDaysInfo(effectiveEndDate);
  const allUnderHoursItems = getUnderHoursResources(resourceSummaries, effectiveEndDate);

  // Build set of billable employee names (Full-time/Part-time only, excludes vendors/contractors)
  const billableEmployeeNames = useMemo(() => {
    const names = new Set<string>();
    for (const emp of employees) {
      const empType = emp.employment_type?.name;
      if (empType === 'Full-time' || empType === 'Part-time') {
        const displayName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.external_label;
        names.add(displayName);
        // Also add external_label in case that's used for matching
        if (emp.external_label) {
          names.add(emp.external_label);
        }
      }
    }
    return names;
  }, [employees]);

  // Filter under hours items to exclude vendors/contractors
  const underHoursItems = useMemo(() =>
    allUnderHoursItems.filter(item =>
      billableEmployeeNames.has(item.displayName) || billableEmployeeNames.has(item.userName)
    ),
    [allUnderHoursItems, billableEmployeeNames]
  );

  // Build database rate lookup by external project_id (fallback for projects not in monthly rates)
  const dbRateLookup = useMemo(() => buildDbRateLookup(dbProjects), [dbProjects]);

  // Helper to get canonical company name (ID-only lookup, no name fallbacks)
  const getCanonicalCompanyName = useCallback((clientId: string): string => {
    const canonicalInfo = clientId ? getCanonicalCompany(clientId) : null;
    return canonicalInfo?.canonicalDisplayName || 'Unknown';
  }, [getCanonicalCompany]);

  // Use billing from summary table
  const { totalRevenue, billingResult } = useBilling({
    selectedMonth,
  });

  // Build lookup: internal UUID -> externalProjectId (same as Revenue page)
  const internalToExternalId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsWithRates) {
      if (p.projectId && p.externalProjectId) {
        map.set(p.projectId, p.externalProjectId);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Build lookup: externalProjectId -> milestone billing data (same as Revenue page)
  const milestoneByExternalProjectId = useMemo(() => {
    const map = new Map<string, { totalCents: number; billingId: string }>();
    for (const company of companyBillings) {
      for (const billing of company.billings) {
        if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
          const externalId = internalToExternalId.get(billing.linkedProjectId);
          if (externalId) {
            // Sum if multiple milestones for same project
            const existing = map.get(externalId);
            map.set(externalId, {
              totalCents: (existing?.totalCents || 0) + billing.totalCents,
              billingId: billing.id,
            });
          }
        }
      }
    }
    return map;
  }, [companyBillings, internalToExternalId]);

  // Calculate filtered billing cents (excludes linked milestones) - same as Revenue page
  const filteredBillingCents = useMemo(() => {
    let total = 0;
    for (const company of companyBillings) {
      for (const billing of company.billings) {
        // Exclude linked milestones (they're accounted for in milestoneAdjustment)
        if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
          const externalId = internalToExternalId.get(billing.linkedProjectId);
          if (externalId) continue; // Skip linked milestones
        }
        total += billing.totalCents;
      }
    }
    return total;
  }, [companyBillings, internalToExternalId]);

  // Calculate milestone adjustment for total (same as Revenue page)
  // When a project has a linked milestone, replace timesheet revenue with milestone amount
  const milestoneAdjustment = useMemo(() => {
    let adjustment = 0;
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          const milestone = milestoneByExternalProjectId.get(project.projectId);
          if (milestone) {
            // Replace timesheet revenue with milestone: add milestone, subtract timesheet
            adjustment += (milestone.totalCents / 100) - project.billedRevenue;
          }
        }
      }
    }
    return adjustment;
  }, [billingResult.companies, milestoneByExternalProjectId]);

  // Combined total revenue (time-based + filtered fixed billings + milestone adjustments)
  // This matches the exact calculation in RevenuePage
  const combinedTotalRevenue = totalRevenue + (filteredBillingCents / 100) + milestoneAdjustment;

  // Utilization metrics (shared hook — same calculation as EmployeesPage)
  const utilizationMetrics = useUtilizationMetrics({
    dateRange,
    holidays,
    employees,
    timeOff,
    entries,
    projectsWithRates,
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

        <RangeSelector
          variant="dateRange"
          dateRange={dateRange}
          onChange={setDateRange}
          controlledMode={mode}
          controlledSelectedMonth={filterSelectedMonth}
          onFilterChange={setFilter}
        />

        {/* Stats Overview - Above Charts */}
        {loading || billingsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
            <span className="ml-3 text-sm text-vercel-gray-400">
              {loading ? 'Loading timesheet data...' : 'Loading billings...'}
            </span>
          </div>
        ) : (
          <StatsOverview
            projects={projects}
            projectCount={canonicalProjects.length}
            resources={resourceSummaries}
            underHoursCount={underHoursItems.length}
            totalRevenue={combinedTotalRevenue}
            utilizationPercent={utilizationMetrics.utilizationPercent}
            onUnderHoursClick={() => setIsUnderHoursModalOpen(true)}
          />
        )}

        {/* Charts Section: Resources + Trends with consistent internal spacing */}
        <div className="space-y-4">
          {/* Resources Charts: Hours by Resource + Top 5 lists */}
          <DashboardChartsRow
            resources={resourceSummaries}
            entries={entries}
            projectRates={dbRateLookup}
            projectCanonicalIdLookup={projectCanonicalIdLookup}
            userIdToDisplayNameLookup={userIdToDisplayNameLookup}
            billingResult={billingResult}
            combinedRevenueByMonth={combinedRevenueByMonth}
            loading={loading || billingsLoading || combinedRevenueLoading}
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
            projectRates={dbRateLookup}
            projectCanonicalIdLookup={projectCanonicalIdLookup}
            userIdToDisplayNameLookup={userIdToDisplayNameLookup}
            billingResult={billingResult}
            combinedRevenueByMonth={combinedRevenueByMonth}
            loading={loading || billingsLoading || combinedRevenueLoading}
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
        getCanonicalCompanyName={getCanonicalCompanyName}
      />
    </>
  );
}
