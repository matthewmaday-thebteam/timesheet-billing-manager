import { useState, useMemo, useCallback, useEffect } from 'react';
import { format } from 'date-fns';
import { useEmployeeTotals } from '../hooks/useEmployeeTotals';
import { useEmployeeDailyTotals } from '../hooks/useEmployeeDailyTotals';
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
import { getProratedExpectedHours, getWorkingDaysInfo } from '../utils/calculations';
import type { UnderHoursResource } from '../utils/calculations';
import { RangeSelector } from './RangeSelector';
import { DashboardChartsRow } from './DashboardChartsRow';
import { StatsOverview } from './StatsOverview';
import { UnderHoursModal } from './UnderHoursModal';
import { Spinner } from './Spinner';
import { Button } from './Button';
import { Card } from './Card';
import { Alert } from './Alert';
import { Badge } from './Badge';
import { DailyHoursChart } from './atoms/charts/DailyHoursChart';
import type { MonthSelection } from '../types';
import type { SyncAlert } from '../hooks/useSyncAlerts';
import { useProjectedAnnualRevenue } from '../hooks/useProjectedAnnualRevenue';
import { HISTORICAL_MONTHS } from '../config/chartConfig';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

interface DashboardProps {
  /** Active sync alerts to display at the top */
  syncAlerts?: SyncAlert[];
  /** Whether sync alerts are still loading */
  syncAlertsLoading?: boolean;
  /** Callback to dismiss an alert */
  onDismissAlert?: (alertId: string) => Promise<void>;
}

export function Dashboard({ syncAlerts = [], onDismissAlert }: DashboardProps) {
  const { user } = useAuth();
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  // Modal state for under hours
  const [isUnderHoursModalOpen, setIsUnderHoursModalOpen] = useState(false);

  // Get user's name for greeting
  const firstName = user?.user_metadata?.first_name || '';
  const lastName = user?.user_metadata?.last_name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'User';

  // Layer 2: employee_totals for hours metrics, pie chart, top 5, under hours
  const {
    rows: layer2Rows,
    userIdToDisplayNameLookup,
    projectCanonicalIdLookup,
    loading: layer2Loading,
    error: layer2Error,
  } = useEmployeeTotals(dateRange);

  // Layer 3: employee_daily_totals for DailyHoursChart
  const {
    rows: layer3Rows,
    loading: layer3Loading,
  } = useEmployeeDailyTotals(dateRange);

  // Fetch canonical project count from v_project_table_entities (per Formulas page definition)
  const { projects: canonicalProjects } = useProjectTableEntities();

  // Fetch employee entities (excludes grouped members to avoid double-counting)
  const { entities: employees, loading: employeesLoading } = useEmployeeTableEntities();

  // Fetch time-off data for the selected period
  const { timeOff, loading: timeOffLoading } = useTimeOff({
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
  const { projectsWithRates, isLoading: ratesLoading } = useMonthlyRates({ selectedMonth });

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

  // Build set of billable employee names (Full-time/Part-time only, excludes vendors/contractors)
  const billableEmployeeNames = useMemo(() => {
    const names = new Set<string>();
    for (const emp of employees) {
      const empType = emp.employment_type?.name;
      if (empType === 'Full-time' || empType === 'Part-time') {
        const empDisplayName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.external_label;
        names.add(empDisplayName);
        // Also add external_label in case that's used for matching
        if (emp.external_label) {
          names.add(emp.external_label);
        }
      }
    }
    return names;
  }, [employees]);

  // --- Layer 2 aggregates ---

  // Total rounded minutes from Layer 2
  const totalRoundedMinutes = useMemo(() =>
    layer2Rows.reduce((sum, r) => sum + r.rounded_minutes, 0),
    [layer2Rows]
  );

  // Resource count: distinct canonical user names from Layer 2
  const layer2ResourceCount = useMemo(() => {
    const names = new Set<string>();
    for (const row of layer2Rows) {
      const name = userIdToDisplayNameLookup.get(row.user_id) || row.user_name;
      names.add(name);
    }
    return names.size;
  }, [layer2Rows, userIdToDisplayNameLookup]);

  // Under-hours resources from Layer 2 rounded_minutes
  const underHoursItems = useMemo(() => {
    // Aggregate Layer 2 rounded_minutes per canonical employee
    const employeeMinutes = new Map<string, { userName: string; displayName: string; totalMinutes: number }>();
    for (const row of layer2Rows) {
      const displayName = userIdToDisplayNameLookup.get(row.user_id) || row.user_name;
      const existing = employeeMinutes.get(displayName);
      if (existing) {
        existing.totalMinutes += row.rounded_minutes;
      } else {
        employeeMinutes.set(displayName, {
          userName: row.user_name,
          displayName,
          totalMinutes: row.rounded_minutes,
        });
      }
    }

    // Calculate prorated expected using same approach as getUnderHoursResources
    const proratedHours = getProratedExpectedHours(effectiveEndDate);
    const proratedMinutes = proratedHours * 60;

    const items: UnderHoursResource[] = [];
    for (const [, emp] of employeeMinutes) {
      // Only include billable employees (Full-time/Part-time)
      if (!billableEmployeeNames.has(emp.displayName) && !billableEmployeeNames.has(emp.userName)) {
        continue;
      }
      if (emp.totalMinutes < proratedMinutes) {
        const actualHours = emp.totalMinutes / 60;
        items.push({
          userName: emp.userName,
          displayName: emp.displayName,
          actualHours,
          expectedHours: proratedHours,
          deficit: proratedHours - actualHours,
        });
      }
    }

    // Also add billable employees with zero hours (not in Layer 2 at all)
    for (const emp of employees) {
      const empType = emp.employment_type?.name;
      if (empType !== 'Full-time' && empType !== 'Part-time') continue;
      const empDisplayName = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.external_label;
      if (!employeeMinutes.has(empDisplayName)) {
        const proratedHrs = getProratedExpectedHours(effectiveEndDate);
        if (proratedHrs > 0) {
          items.push({
            userName: emp.external_label,
            displayName: empDisplayName,
            actualHours: 0,
            expectedHours: proratedHrs,
            deficit: proratedHrs,
          });
        }
      }
    }

    // Sort by deficit descending
    return items.sort((a, b) => b.deficit - a.deficit);
  }, [layer2Rows, userIdToDisplayNameLookup, effectiveEndDate, billableEmployeeNames, employees]);

  // Synthetic entries for useUtilizationMetrics (same pattern as EmployeesPage lines 97-109)
  const syntheticEntries = useMemo(() => {
    return layer2Rows.map(row => ({
      ...row,
      total_minutes: row.rounded_minutes,
      project_id: row.project_id,
      project_name: row.project_name,
      task_id: null,
      task_key: '',
      synced_at: '',
      project_key: '',
      user_key: '',
    }));
  }, [layer2Rows]);

  // Pie chart data: aggregate Layer 2 rounded_hours per canonical employee
  const pieChartData = useMemo(() => {
    const employeeHours = new Map<string, number>();
    for (const row of layer2Rows) {
      const name = userIdToDisplayNameLookup.get(row.user_id) || row.user_name;
      const current = employeeHours.get(name) || 0;
      employeeHours.set(name, current + row.rounded_hours);
    }

    const pieData = Array.from(employeeHours.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Top 5 + "Other" grouping
    if (pieData.length <= 5) return pieData;
    const top5 = pieData.slice(0, 5);
    const otherValue = pieData.slice(5).reduce((sum, d) => sum + d.value, 0);
    if (otherValue > 0) {
      top5.push({ name: 'Other', value: otherValue, color: 'other' });
    }
    return top5;
  }, [layer2Rows, userIdToDisplayNameLookup]);

  // Build project rate lookup for revenue calculations (keyed by external project ID)
  const projectRateLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of projectsWithRates) {
      if (project.externalProjectId) {
        map.set(project.externalProjectId, project.effectiveRate);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Top 5 by hours from Layer 2
  const topFiveByHours = useMemo(() => {
    const employeeHours = new Map<string, { hours: number; revenue: number }>();
    for (const row of layer2Rows) {
      const name = userIdToDisplayNameLookup.get(row.user_id) || row.user_name;
      const canonicalProjectId = projectCanonicalIdLookup.get(row.project_id) || row.project_id;
      const rate = projectRateLookup.get(canonicalProjectId) ?? 0;
      const revenue = row.rounded_hours * rate;

      const existing = employeeHours.get(name);
      if (existing) {
        existing.hours += row.rounded_hours;
        existing.revenue += revenue;
      } else {
        employeeHours.set(name, { hours: row.rounded_hours, revenue });
      }
    }

    return Array.from(employeeHours.entries())
      .map(([name, stats]) => ({ name, hours: stats.hours, revenue: stats.revenue }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);
  }, [layer2Rows, userIdToDisplayNameLookup, projectCanonicalIdLookup, projectRateLookup]);

  // Top 5 by revenue from Layer 2 (rounded_hours x rate)
  const topFiveByRevenue = useMemo(() => {
    const employeeRevenue = new Map<string, { hours: number; revenue: number }>();
    for (const row of layer2Rows) {
      const name = userIdToDisplayNameLookup.get(row.user_id) || row.user_name;
      const canonicalProjectId = projectCanonicalIdLookup.get(row.project_id) || row.project_id;
      const rate = projectRateLookup.get(canonicalProjectId) ?? 0;
      const revenue = row.rounded_hours * rate;

      const existing = employeeRevenue.get(name);
      if (existing) {
        existing.hours += row.rounded_hours;
        existing.revenue += revenue;
      } else {
        employeeRevenue.set(name, { hours: row.rounded_hours, revenue });
      }
    }

    return Array.from(employeeRevenue.entries())
      .map(([name, stats]) => ({ name, hours: stats.hours, revenue: stats.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [layer2Rows, userIdToDisplayNameLookup, projectCanonicalIdLookup, projectRateLookup]);

  // Layer 3: aggregate employee_daily_totals into dailyHoursByDate for DailyHoursChart
  // Same approach as BurnPage
  const dailyHoursByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of layer3Rows) {
      const current = map.get(row.work_date) || 0;
      map.set(row.work_date, current + row.rounded_hours);
    }
    return map;
  }, [layer3Rows]);

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

  // Projected annual revenue — client-side shared hook (single source of truth for chart bands)
  const { projectedAnnualRevenue } = useProjectedAnnualRevenue();

  // Loading state for utilization inputs (employees, timeOff, holidays, rates)
  const utilizationLoading = employeesLoading || timeOffLoading || ratesLoading;

  // Combined loading for Layer 2/3 data
  const loading = layer2Loading || layer3Loading;
  const error = layer2Error;

  // Utilization metrics (shared hook — same calculation as EmployeesPage)
  // Uses synthetic entries from Layer 2 (rounded_minutes) for consistency
  const utilizationMetrics = useUtilizationMetrics({
    dateRange,
    holidays,
    employees,
    timeOff,
    entries: syntheticEntries as any,
    projectsWithRates,
  });

  // Separate alerts by severity for display ordering
  const errorAlerts = syncAlerts.filter(a => a.severity === 'error');
  const warningAlerts = syncAlerts.filter(a => a.severity === 'warning');

  return (
    <>
      {/* Sync Alerts Banner — Full width, above all content, impossible to miss */}
      {syncAlerts.length > 0 && (
        <div className="bg-error-light border-b-2 border-error">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-6 h-6 text-error flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h2 className="text-lg font-bold text-error-text">
                Sync Alerts
              </h2>
              <Badge variant="error" size="md">
                {syncAlerts.length} {syncAlerts.length === 1 ? 'issue' : 'issues'}
              </Badge>
            </div>

            <div className="space-y-2">
              {/* Error-severity alerts first */}
              {errorAlerts.map((alert) => (
                <Alert
                  key={alert.id}
                  message={alert.title}
                  icon="error"
                  variant="error"
                  onClose={onDismissAlert ? () => onDismissAlert(alert.id) : undefined}
                >
                  {alert.detail && (
                    <p className="text-xs mt-1">{alert.detail}</p>
                  )}
                </Alert>
              ))}

              {/* Warning-severity alerts */}
              {warningAlerts.map((alert) => (
                <Alert
                  key={alert.id}
                  message={alert.title}
                  icon="warning"
                  variant="warning"
                  onClose={onDismissAlert ? () => onDismissAlert(alert.id) : undefined}
                >
                  {alert.metadata && typeof alert.metadata === 'object' && 'bamboo_days' in alert.metadata && (
                    <p className="text-xs mt-1">
                      BambooHR: {String(alert.metadata.bamboo_days)} days | Manifest: {String(alert.metadata.manifest_days)} days
                    </p>
                  )}
                  {alert.metadata && typeof alert.metadata === 'object' && 'clockify_minutes' in alert.metadata && (
                    <p className="text-xs mt-1">
                      Clockify: {String(alert.metadata.clockify_minutes)} min | Manifest: {String(alert.metadata.manifest_minutes)} min
                    </p>
                  )}
                </Alert>
              ))}
            </div>
          </div>
        </div>
      )}

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
            <Button variant="secondary" onClick={() => window.location.reload()}>
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
            totalMinutes={totalRoundedMinutes}
            projectCount={canonicalProjects.length}
            resourceCount={layer2ResourceCount}
            underHoursCount={underHoursItems.length}
            totalRevenue={combinedTotalRevenue}
            utilizationPercent={utilizationMetrics.utilizationPercent}
            utilizationLoading={utilizationLoading}
            onUnderHoursClick={() => setIsUnderHoursModalOpen(true)}
          />
        )}

        {/* Charts Section: Resources + Trends with consistent internal spacing */}
        <div className="space-y-4">
          {/* Resources Charts: Hours by Resource + Top 5 lists (Layer 2) */}
          <DashboardChartsRow
            pieData={pieChartData}
            topFiveByHours={topFiveByHours}
            topFiveByRevenue={topFiveByRevenue}
            combinedRevenueByMonth={combinedRevenueByMonth}
            loading={loading || billingsLoading || combinedRevenueLoading}
            section="resources"
            projectedAnnualRevenue={projectedAnnualRevenue}
          />

          {/* Daily Hours Chart */}
          <Card variant="default" padding="lg">
            <h3 className="text-lg font-semibold text-vercel-gray-600 mb-4">
              Resource Utilization - {format(dateRange.start, 'MMMM yyyy')}
            </h3>
            <DailyHoursChart
              dailyHoursByDate={dailyHoursByDate}
              startDate={dateRange.start}
              endDate={dateRange.end}
              holidays={holidays}
              resources={employees}
              timeOff={timeOff}
            />
          </Card>

          {/* Trend Charts: Revenue Trend + MoM + CAGR (billing engine) */}
          <DashboardChartsRow
            pieData={[]}
            topFiveByHours={[]}
            topFiveByRevenue={[]}
            combinedRevenueByMonth={combinedRevenueByMonth}
            loading={billingsLoading || combinedRevenueLoading}
            section="trends"
            projectedAnnualRevenue={projectedAnnualRevenue}
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
        layer2Rows={layer2Rows}
        expectedHours={expectedHours}
        workingDaysElapsed={workingDays.elapsed}
        workingDaysTotal={workingDays.total}
        userIdToDisplayNameLookup={userIdToDisplayNameLookup}
        getCanonicalCompanyName={getCanonicalCompanyName}
      />
    </>
  );
}
