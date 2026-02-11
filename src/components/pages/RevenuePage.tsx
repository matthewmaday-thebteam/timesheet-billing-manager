import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useMonthlyRates } from '../../hooks/useMonthlyRates';
import { useBilling } from '../../hooks/useBilling';
import { useBillings } from '../../hooks/useBillings';
import { formatCurrency, applyRounding, roundCurrency } from '../../utils/billing';
import { generateRevenueCSV, downloadCSV } from '../../utils/generateRevenueCSV';
import { useTaskBreakdown } from '../../hooks/useTaskBreakdown';
import { getWeekOptionsForMonth } from '../../utils/calculations';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { RangeSelector } from '../RangeSelector';
import { RevenueTable } from '../atoms/RevenueTable';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { Select } from '../Select';
import type { SelectOption } from '../Select';
import type { MonthSelection } from '../../types';

export function RevenuePage() {
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  const { entries, loading, error } = useTimesheetData(dateRange);

  // Convert dateRange to MonthSelection for the rates hook
  const selectedMonth = useMemo<MonthSelection>(() => ({
    year: dateRange.start.getFullYear(),
    month: dateRange.start.getMonth() + 1,
  }), [dateRange.start]);

  // Fetch monthly rates (which now includes rounding data)
  const { projectsWithRates } = useMonthlyRates({ selectedMonth });

  // Use billing from summary table
  const { totalRevenue, billingResult } = useBilling({
    selectedMonth,
  });

  // Fetch fixed billings for the date range
  const {
    companyBillings,
    isLoading: billingsLoading,
    error: billingsError,
  } = useBillings({ dateRange });

  // Fetch task-level breakdown for the selected month
  const { tasksByProject, isLoading: tasksLoading } = useTaskBreakdown({ selectedMonth });

  // --- Week filter state for Customer Revenue Report ---
  const [customerReportWeek, setCustomerReportWeek] = useState('all');

  // Build week options for the selected month
  const weekOptions = useMemo<SelectOption[]>(() => {
    const weeks = getWeekOptionsForMonth(selectedMonth.year, selectedMonth.month);
    return [
      { value: 'all', label: 'Entire Month' },
      ...weeks.map(w => ({ value: w.value, label: w.label })),
    ];
  }, [selectedMonth]);

  // Get the selected week's date range (for the weekly task query)
  const selectedWeekRange = useMemo(() => {
    if (customerReportWeek === 'all') return undefined;
    const weeks = getWeekOptionsForMonth(selectedMonth.year, selectedMonth.month);
    const week = weeks.find(w => w.value === customerReportWeek);
    return week ? { start: week.startDate, end: week.endDate } : undefined;
  }, [customerReportWeek, selectedMonth]);

  // Fetch weekly task breakdown (only when a specific week is selected)
  const {
    tasksByProject: weeklyTasksByProject,
    isLoading: weeklyTasksLoading,
  } = useTaskBreakdown({
    selectedMonth,
    dateRange: selectedWeekRange,
    skip: customerReportWeek === 'all',
  });

  // Hydrate billing result with task-level data from timesheet_daily_rollups.
  // The summary table doesn't store tasks, so we merge them in here.
  const hydratedBillingResult = useMemo(() => {
    if (tasksByProject.size === 0) return billingResult;

    return {
      ...billingResult,
      companies: billingResult.companies.map(company => ({
        ...company,
        projects: company.projects.map(project => {
          const rawTasks = project.projectId ? tasksByProject.get(project.projectId) : undefined;
          if (!rawTasks || rawTasks.length === 0) return project;

          // Apply per-task rounding and compute revenue using the project's config
          const tasks = rawTasks.map(t => {
            const roundedMinutes = applyRounding(t.actualMinutes, project.rounding);
            const actualHours = t.actualMinutes / 60;
            const roundedHours = roundedMinutes / 60;
            return {
              taskName: t.taskName,
              actualMinutes: t.actualMinutes,
              roundedMinutes,
              actualHours: Math.round(actualHours * 100) / 100,
              roundedHours: Math.round(roundedHours * 100) / 100,
              baseRevenue: roundCurrency(roundedHours * project.rate),
            };
          });

          return { ...project, tasks };
        }),
      })),
    };
  }, [billingResult, tasksByProject]);

  // Build weekly billing result when a specific week is selected.
  // Simple calculation: roundedHours * rate per task. No MIN/MAX, no carryover, no milestones, no fixed billings.
  const weeklyBillingResult = useMemo(() => {
    if (customerReportWeek === 'all' || weeklyTasksByProject.size === 0) return null;

    // Build a lookup from monthly data: projectId → { rate, rounding }
    const projectConfigMap = new Map<string, { rate: number; rounding: number }>();
    for (const company of hydratedBillingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          projectConfigMap.set(project.projectId, {
            rate: project.rate,
            rounding: project.rounding,
          });
        }
      }
    }

    // Build company-level results from weekly task data
    // We need to group weekly projects back into their companies
    const companyMap = new Map<string, {
      companyId: string;
      companyName: string;
      projects: Array<{
        projectId: string;
        projectName: string;
        rate: number;
        rounding: number;
        billedHours: number;
        billedRevenue: number;
        tasks: Array<{
          taskName: string;
          actualMinutes: number;
          roundedMinutes: number;
          actualHours: number;
          roundedHours: number;
          baseRevenue: number;
        }>;
      }>;
      billedHours: number;
      billedRevenue: number;
    }>();

    for (const company of hydratedBillingResult.companies) {
      for (const project of company.projects) {
        if (!project.projectId) continue;
        const weeklyTasks = weeklyTasksByProject.get(project.projectId);
        if (!weeklyTasks || weeklyTasks.length === 0) continue;

        const config = projectConfigMap.get(project.projectId);
        if (!config) continue;

        // Compute per-task rounding and revenue
        const tasks = weeklyTasks.map(t => {
          const roundedMinutes = applyRounding(t.actualMinutes, config.rounding as 0 | 5 | 15 | 30);
          const actualHours = t.actualMinutes / 60;
          const roundedHours = roundedMinutes / 60;
          return {
            taskName: t.taskName,
            actualMinutes: t.actualMinutes,
            roundedMinutes,
            actualHours: Math.round(actualHours * 100) / 100,
            roundedHours: Math.round(roundedHours * 100) / 100,
            baseRevenue: roundCurrency(roundedHours * config.rate),
          };
        });

        const projectBilledHours = tasks.reduce((sum, t) => sum + t.roundedHours, 0);
        const projectBilledRevenue = tasks.reduce((sum, t) => sum + t.baseRevenue, 0);

        if (!companyMap.has(company.companyId)) {
          companyMap.set(company.companyId, {
            companyId: company.companyId,
            companyName: company.companyName,
            projects: [],
            billedHours: 0,
            billedRevenue: 0,
          });
        }
        const companyEntry = companyMap.get(company.companyId)!;
        companyEntry.projects.push({
          projectId: project.projectId,
          projectName: project.projectName,
          rate: config.rate,
          rounding: config.rounding,
          billedHours: projectBilledHours,
          billedRevenue: projectBilledRevenue,
          tasks,
        });
        companyEntry.billedHours += projectBilledHours;
        companyEntry.billedRevenue += projectBilledRevenue;
      }
    }

    return {
      companies: [...companyMap.values()],
      grandTotalHours: [...companyMap.values()].reduce((sum, c) => sum + c.billedHours, 0),
      grandTotalRevenue: [...companyMap.values()].reduce((sum, c) => sum + c.billedRevenue, 0),
    };
  }, [customerReportWeek, weeklyTasksByProject, hydratedBillingResult]);

  // Build lookup: internal UUID -> externalProjectId
  const internalToExternalId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsWithRates) {
      if (p.projectId && p.externalProjectId) {
        map.set(p.projectId, p.externalProjectId);
      }
    }
    return map;
  }, [projectsWithRates]);

  // Build lookup: externalProjectId -> milestone billing data
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

  // Filter out linked milestone billings from display
  const filteredCompanyBillings = useMemo(() => {
    const linkedBillingIds = new Set<string>();
    for (const company of companyBillings) {
      for (const billing of company.billings) {
        if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
          const externalId = internalToExternalId.get(billing.linkedProjectId);
          if (externalId) linkedBillingIds.add(billing.id);
        }
      }
    }

    return companyBillings.map(company => {
      const filteredBillings = company.billings.filter(b => !linkedBillingIds.has(b.id));
      // Recalculate totalCents after filtering
      const filteredTotalCents = filteredBillings.reduce((sum, b) => sum + b.totalCents, 0);
      return {
        ...company,
        billings: filteredBillings,
        totalCents: filteredTotalCents,
      };
    });
  }, [companyBillings, internalToExternalId]);

  // Calculate filtered billing cents (excludes linked milestones)
  const filteredBillingCents = useMemo(() => {
    let total = 0;
    for (const company of filteredCompanyBillings) {
      for (const billing of company.billings) {
        total += billing.totalCents;
      }
    }
    return total;
  }, [filteredCompanyBillings]);

  // Calculate milestone adjustment for header total
  // When a project has a linked milestone, replace timesheet revenue with milestone amount
  const milestoneAdjustment = useMemo(() => {
    let adjustment = 0;
    for (const company of hydratedBillingResult.companies) {
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
  }, [hydratedBillingResult.companies, milestoneByExternalProjectId]);

  // Combined total revenue (time-based + filtered fixed billings + milestone adjustments)
  // Use filteredBillingCents to exclude linked milestones (they're accounted for in milestoneAdjustment)
  const combinedTotalRevenue = totalRevenue + (filteredBillingCents / 100) + milestoneAdjustment;

  // Earned revenue: billed revenue + dollar value of hours rolled over or lost to max cap
  // For milestone projects the milestone IS the earned amount (no rollover concept)
  const rolledOverRevenue = useMemo(() => {
    let extra = 0;
    for (const company of hydratedBillingResult.companies) {
      for (const project of company.projects) {
        // Skip milestone-linked projects — milestone amount is the earned amount
        if (project.projectId && milestoneByExternalProjectId.has(project.projectId)) continue;
        extra += (project.carryoverOut + project.unbillableHours) * project.rate;
      }
    }
    return extra;
  }, [hydratedBillingResult.companies, milestoneByExternalProjectId]);
  const earnedTotalRevenue = combinedTotalRevenue + rolledOverRevenue;

  // --- Detailed Revenue export modal state ---
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());

  // --- Customer Revenue Report modal state ---
  const [showCustomerReportModal, setShowCustomerReportModal] = useState(false);
  const [crCompanyIds, setCrCompanyIds] = useState<Set<string>>(new Set());
  const [crColumns, setCrColumns] = useState({
    tasks: true,
    rate: true,
    projectRevenue: true,
    companyRevenue: true,
  });

  // Build alphabetized company list with revenue for the modal
  const sortedCompaniesForExport = useMemo(() => {
    // Merge time-based companies and fixed-billing-only companies
    const companyMap = new Map<string, { id: string; name: string; revenue: number }>();

    for (const c of hydratedBillingResult.companies) {
      const billingData = filteredCompanyBillings.find(cb => cb.companyClientId === c.companyId);
      const billingCents = billingData?.totalCents || 0;
      let adj = 0;
      for (const project of c.projects) {
        if (project.projectId) {
          const milestone = milestoneByExternalProjectId.get(project.projectId);
          if (milestone) {
            adj += (milestone.totalCents / 100) - project.billedRevenue;
          }
        }
      }
      companyMap.set(c.companyId, {
        id: c.companyId,
        name: c.companyName,
        revenue: c.billedRevenue + (billingCents / 100) + adj,
      });
    }

    // Include fixed-billing-only companies not already in the time-based set
    for (const cb of filteredCompanyBillings) {
      if (!companyMap.has(cb.companyClientId)) {
        companyMap.set(cb.companyClientId, {
          id: cb.companyClientId,
          name: cb.companyName,
          revenue: cb.totalCents / 100,
        });
      }
    }

    return [...companyMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [hydratedBillingResult.companies, filteredCompanyBillings, milestoneByExternalProjectId]);

  // Open modal and select all companies by default
  const handleOpenExportModal = useCallback(() => {
    setSelectedCompanyIds(new Set(sortedCompaniesForExport.map(c => c.id)));
    setShowExportModal(true);
  }, [sortedCompaniesForExport]);

  const handleToggleCompany = useCallback((companyId: string) => {
    setSelectedCompanyIds(prev => {
      const next = new Set(prev);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedCompanyIds(prev => {
      if (prev.size === sortedCompaniesForExport.length) {
        return new Set();
      }
      return new Set(sortedCompaniesForExport.map(c => c.id));
    });
  }, [sortedCompaniesForExport]);

  const handleExportCSV = useCallback(() => {
    const csvContent = generateRevenueCSV({
      billingResult: hydratedBillingResult,
      filteredCompanyBillings,
      milestoneByExternalProjectId,
      monthLabel: format(dateRange.start, 'MMMM yyyy'),
      companyIds: selectedCompanyIds,
    });
    downloadCSV(csvContent, `revenue-${format(dateRange.start, 'yyyy-MM')}.csv`);
    setShowExportModal(false);
  }, [hydratedBillingResult, filteredCompanyBillings, milestoneByExternalProjectId, dateRange.start, selectedCompanyIds]);

  // --- Customer Revenue Report modal handlers ---
  const handleOpenCustomerReportModal = useCallback(() => {
    setCrCompanyIds(new Set(sortedCompaniesForExport.map(c => c.id)));
    setCrColumns({ tasks: true, rate: true, projectRevenue: true, companyRevenue: true });
    setCustomerReportWeek('all');
    setShowCustomerReportModal(true);
  }, [sortedCompaniesForExport]);

  const handleCrToggleCompany = useCallback((companyId: string) => {
    setCrCompanyIds(prev => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }, []);

  const handleCrToggleAll = useCallback(() => {
    setCrCompanyIds(prev => {
      if (prev.size === sortedCompaniesForExport.length) return new Set();
      return new Set(sortedCompaniesForExport.map(c => c.id));
    });
  }, [sortedCompaniesForExport]);

  const handleCrToggleColumn = useCallback((col: keyof typeof crColumns) => {
    setCrColumns(prev => ({ ...prev, [col]: !prev[col] }));
  }, []);

  // Export Customer Revenue Report with column toggles and company filter
  // Hours are split into separate columns per level so Excel SUM won't double-count:
  //   Hours = task-level only, Project Hours = project summaries, Company Hours = company summaries
  const handleExportCustomerRevenue = useCallback(() => {
    const cols = crColumns;
    const isWeekly = customerReportWeek !== 'all' && weeklyBillingResult !== null;
    const csvRows: string[][] = [];

    // Build title with optional week range
    let titleSuffix = format(dateRange.start, 'MMMM yyyy');
    let filenameSuffix = format(dateRange.start, 'yyyy-MM');
    if (isWeekly && selectedWeekRange) {
      const weekStart = new Date(selectedWeekRange.start + 'T00:00:00');
      const weekEnd = new Date(selectedWeekRange.end + 'T00:00:00');
      const startLabel = format(weekStart, 'MMMd');
      const endLabel = format(weekEnd, 'd');
      titleSuffix += ` (Week of ${format(weekStart, 'MMM d')})`;
      filenameSuffix += `_Week_${startLabel}-${endLabel}`;
    }

    // Title row
    csvRows.push([`Customer Revenue Report - ${titleSuffix}`]);

    // Header row — build dynamically based on column toggles
    const header: string[] = ['Company', 'Project'];
    if (cols.tasks) header.push('Task', 'Hours');
    if (cols.rate) header.push('Rate ($/hr)');
    if (cols.projectRevenue) header.push('Project Hours', 'Project Revenue');
    if (cols.companyRevenue) header.push('Company Hours', 'Company Revenue');
    csvRows.push(header);

    // Helper: build an empty row matching column count
    const emptyRow = () => header.map(() => '');

    if (isWeekly) {
      // --- WEEKLY MODE: use weeklyBillingResult (simple rounding * rate, no MIN/MAX/carryover/milestones) ---
      const weeklyCompanies = weeklyBillingResult.companies
        .filter(c => crCompanyIds.has(c.companyId) && c.billedRevenue > 0)
        .sort((a, b) => a.companyName.localeCompare(b.companyName));

      let grandTotalHours = 0;
      let grandTotalRevenue = 0;

      for (const company of weeklyCompanies) {
        grandTotalHours += company.billedHours;
        grandTotalRevenue += company.billedRevenue;

        // Company summary row
        const companyRow = emptyRow();
        companyRow[0] = company.companyName;
        if (cols.companyRevenue) {
          companyRow[header.indexOf('Company Hours')] = company.billedHours.toFixed(2);
          companyRow[header.indexOf('Company Revenue')] = formatCurrency(company.billedRevenue);
        }
        csvRows.push(companyRow);

        // Sort projects alphabetically
        const sortedProjects = [...company.projects].sort((a, b) =>
          a.projectName.localeCompare(b.projectName)
        );

        for (const project of sortedProjects) {
          // Project summary row
          const projectRow = emptyRow();
          projectRow[0] = company.companyName;
          projectRow[1] = project.projectName;
          if (cols.rate) {
            projectRow[header.indexOf('Rate ($/hr)')] = project.rate.toFixed(2);
          }
          if (cols.projectRevenue) {
            projectRow[header.indexOf('Project Hours')] = project.billedHours.toFixed(2);
            projectRow[header.indexOf('Project Revenue')] = formatCurrency(project.billedRevenue);
          }
          csvRows.push(projectRow);

          // Task rows
          if (cols.tasks) {
            const sortedTasks = [...project.tasks].sort((a, b) =>
              b.roundedHours - a.roundedHours
            );
            for (const task of sortedTasks) {
              const taskRow = emptyRow();
              taskRow[0] = company.companyName;
              taskRow[1] = project.projectName;
              taskRow[header.indexOf('Task')] = task.taskName;
              taskRow[header.indexOf('Hours')] = task.roundedHours.toFixed(2);
              if (cols.rate) {
                taskRow[header.indexOf('Rate ($/hr)')] = project.rate.toFixed(2);
              }
              csvRows.push(taskRow);
            }
          }
        }

        // Empty row between companies
        csvRows.push(emptyRow());
      }

      // Total row
      const totalRow = emptyRow();
      totalRow[0] = 'TOTAL';
      if (cols.companyRevenue) {
        totalRow[header.indexOf('Company Hours')] = grandTotalHours.toFixed(2);
        totalRow[header.indexOf('Company Revenue')] = formatCurrency(grandTotalRevenue);
      }
      csvRows.push(totalRow);
    } else {
      // --- MONTHLY MODE: existing logic with milestone adjustments and fixed billings ---
      const filteredCompanies = hydratedBillingResult.companies
        .filter(c => crCompanyIds.has(c.companyId))
        .sort((a, b) => a.companyName.localeCompare(b.companyName));

      let grandTotalHours = 0;
      let grandTotalRevenue = 0;

      for (const company of filteredCompanies) {
        const companyBillingData = filteredCompanyBillings.find(cb => cb.companyClientId === company.companyId);
        const companyBillingCents = companyBillingData?.totalCents || 0;
        let milestoneAdj = 0;
        for (const project of company.projects) {
          if (project.projectId) {
            const milestone = milestoneByExternalProjectId.get(project.projectId);
            if (milestone) {
              milestoneAdj += (milestone.totalCents / 100) - project.billedRevenue;
            }
          }
        }
        const companyTotalRevenue = company.billedRevenue + (companyBillingCents / 100) + milestoneAdj;
        grandTotalHours += company.billedHours;
        grandTotalRevenue += companyTotalRevenue;

        const companyRow = emptyRow();
        companyRow[0] = company.companyName;
        if (cols.companyRevenue) {
          companyRow[header.indexOf('Company Hours')] = company.billedHours.toFixed(2);
          companyRow[header.indexOf('Company Revenue')] = formatCurrency(companyTotalRevenue);
        }
        csvRows.push(companyRow);

        const sortedProjects = [...company.projects].sort((a, b) =>
          a.projectName.localeCompare(b.projectName)
        );

        for (const project of sortedProjects) {
          const milestone = project.projectId
            ? milestoneByExternalProjectId.get(project.projectId)
            : undefined;
          const projectRevenue = milestone
            ? milestone.totalCents / 100
            : project.billedRevenue;

          const projectRow = emptyRow();
          projectRow[0] = company.companyName;
          projectRow[1] = project.projectName;
          if (cols.rate) {
            projectRow[header.indexOf('Rate ($/hr)')] = project.rate.toFixed(2);
          }
          if (cols.projectRevenue) {
            projectRow[header.indexOf('Project Hours')] = project.billedHours.toFixed(2);
            projectRow[header.indexOf('Project Revenue')] = formatCurrency(projectRevenue);
          }
          csvRows.push(projectRow);

          if (cols.tasks) {
            const sortedTasks = [...project.tasks].sort((a, b) =>
              b.roundedHours - a.roundedHours
            );
            for (const task of sortedTasks) {
              const taskRow = emptyRow();
              taskRow[0] = company.companyName;
              taskRow[1] = project.projectName;
              taskRow[header.indexOf('Task')] = task.taskName;
              taskRow[header.indexOf('Hours')] = task.roundedHours.toFixed(2);
              if (cols.rate) {
                taskRow[header.indexOf('Rate ($/hr)')] = project.rate.toFixed(2);
              }
              csvRows.push(taskRow);
            }
          }
        }

        csvRows.push(emptyRow());
      }

      const totalRow = emptyRow();
      totalRow[0] = 'TOTAL';
      if (cols.companyRevenue) {
        totalRow[header.indexOf('Company Hours')] = grandTotalHours.toFixed(2);
        totalRow[header.indexOf('Company Revenue')] = formatCurrency(grandTotalRevenue);
      }
      csvRows.push(totalRow);
    }

    // Convert to CSV string and download
    const csvContent = csvRows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    downloadCSV('\uFEFF' + csvContent, `customer-revenue-${filenameSuffix}.csv`);
    setShowCustomerReportModal(false);
  }, [hydratedBillingResult, filteredCompanyBillings, milestoneByExternalProjectId, dateRange.start, crCompanyIds, crColumns, customerReportWeek, weeklyBillingResult, selectedWeekRange]);

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
        {!loading && !billingsLoading && (
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(combinedTotalRevenue)}</span>
            </div>
            {Math.round(earnedTotalRevenue * 100) !== Math.round(combinedTotalRevenue * 100) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-vercel-gray-300 uppercase tracking-wide">Earned</span>
                <span className="text-lg font-semibold text-vercel-gray-400">{formatCurrency(earnedTotalRevenue)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Range Selector with Export */}
      <RangeSelector
        variant="export"
        dateRange={dateRange}
        onChange={setDateRange}
        exportOptions={[
          { label: 'Detailed Revenue', onClick: handleOpenExportModal },
          { label: 'Customer Revenue Report', onClick: handleOpenCustomerReportModal },
        ]}
        exportDisabled={loading || tasksLoading || entries.length === 0}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
      />

      {/* Error State */}
      {error && <Alert message={error} icon="error" variant="error" />}

      {/* Billings Error */}
      {billingsError && <Alert message={billingsError} icon="error" variant="error" />}

      {/* Billing Rates Table */}
      {loading || billingsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">
            {loading ? 'Loading timesheet data...' : 'Loading billings...'}
          </span>
        </div>
      ) : (
        <RevenueTable
          billingResult={hydratedBillingResult}
          companyBillings={filteredCompanyBillings}
          totalBillingCents={filteredBillingCents}
          milestoneByExternalProjectId={milestoneByExternalProjectId}
        />
      )}

      {/* Customer Revenue Report Modal */}
      <Modal
        isOpen={showCustomerReportModal}
        onClose={() => setShowCustomerReportModal(false)}
        title="Customer Revenue Report"
        maxWidth="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCustomerReportModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleExportCustomerRevenue}
              disabled={crCompanyIds.size === 0 || (customerReportWeek !== 'all' && weeklyTasksLoading)}
            >
              Export
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-vercel-gray-400">
            {format(dateRange.start, 'MMMM yyyy')}
          </p>

          {/* Column toggles */}
          <div>
            <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wide mb-2">Columns</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {([
                ['tasks', 'Tasks'],
                ['rate', 'Rate ($/hr)'],
                ['projectRevenue', 'Project Revenue'],
                ['companyRevenue', 'Company Revenue'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={crColumns[key]}
                    onChange={() => handleCrToggleColumn(key)}
                    className="h-4 w-4 rounded border-vercel-gray-200 text-vercel-gray-600 focus:ring-vercel-gray-600"
                  />
                  <span className="text-sm text-vercel-gray-600">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Week filter */}
          <div>
            <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wide mb-2">Period</p>
            <Select
              value={customerReportWeek}
              onChange={setCustomerReportWeek}
              options={weekOptions}
              className="w-full"
            />
            {customerReportWeek !== 'all' && weeklyTasksLoading && (
              <p className="text-xs text-vercel-gray-300 mt-1">Loading weekly data...</p>
            )}
          </div>

          {/* Company filter */}
          <div>
            <p className="text-xs font-medium text-vercel-gray-400 uppercase tracking-wide mb-2">Companies</p>

            {/* Select All */}
            <label className="flex items-center gap-3 pb-3 border-b border-vercel-gray-100 cursor-pointer">
              <input
                type="checkbox"
                checked={crCompanyIds.size === sortedCompaniesForExport.length}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      crCompanyIds.size > 0 &&
                      crCompanyIds.size < sortedCompaniesForExport.length;
                  }
                }}
                onChange={handleCrToggleAll}
                className="h-4 w-4 rounded border-vercel-gray-200 text-vercel-gray-600 focus:ring-vercel-gray-600"
              />
              <span className="text-sm font-medium text-vercel-gray-600">Select All</span>
            </label>

            {/* Company list */}
            <div className="max-h-72 overflow-y-auto space-y-1 scrollbar-thin mt-2">
              {sortedCompaniesForExport.map(company => (
                <label
                  key={company.id}
                  className="flex items-center gap-3 py-1.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={crCompanyIds.has(company.id)}
                    onChange={() => handleCrToggleCompany(company.id)}
                    className="h-4 w-4 rounded border-vercel-gray-200 text-vercel-gray-600 focus:ring-vercel-gray-600"
                  />
                  <span className="flex-1 text-sm text-vercel-gray-600">{company.name}</span>
                  <span className="text-sm text-vercel-gray-300 tabular-nums">
                    {formatCurrency(company.revenue)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Export CSV Modal */}
      <Modal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Revenue CSV"
        maxWidth="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowExportModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleExportCSV}
              disabled={selectedCompanyIds.size === 0}
            >
              Export
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-vercel-gray-400">
            {format(dateRange.start, 'MMMM yyyy')}
          </p>

          {/* Select All */}
          <label className="flex items-center gap-3 pb-3 border-b border-vercel-gray-100 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedCompanyIds.size === sortedCompaniesForExport.length}
              ref={(el) => {
                if (el) {
                  el.indeterminate =
                    selectedCompanyIds.size > 0 &&
                    selectedCompanyIds.size < sortedCompaniesForExport.length;
                }
              }}
              onChange={handleToggleAll}
              className="h-4 w-4 rounded border-vercel-gray-200 text-vercel-gray-600 focus:ring-vercel-gray-600"
            />
            <span className="text-sm font-medium text-vercel-gray-600">Select All</span>
          </label>

          {/* Company list */}
          <div className="max-h-72 overflow-y-auto space-y-1 scrollbar-thin">
            {sortedCompaniesForExport.map(company => (
              <label
                key={company.id}
                className="flex items-center gap-3 py-1.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedCompanyIds.has(company.id)}
                  onChange={() => handleToggleCompany(company.id)}
                  className="h-4 w-4 rounded border-vercel-gray-200 text-vercel-gray-600 focus:ring-vercel-gray-600"
                />
                <span className="flex-1 text-sm text-vercel-gray-600">{company.name}</span>
                <span className="text-sm text-vercel-gray-300 tabular-nums">
                  {formatCurrency(company.revenue)}
                </span>
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
