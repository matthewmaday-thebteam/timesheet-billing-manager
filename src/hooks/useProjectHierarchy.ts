/**
 * useProjectHierarchy - Build 5-tier hierarchical data for Projects page
 *
 * Hierarchy: Company => Project => Employee => Day => Task
 *
 * Billing approach (matching Revenue page pattern):
 * - Task/Day/Employee: Show rounded hours and BASE revenue (roundedHours × rate)
 * - Project/Company: Show BILLED hours/revenue (after MIN/MAX/CARRYOVER)
 *
 * Note: Child revenues don't sum to parent when MIN/MAX is applied - same as Revenue page.
 *
 * @official 2026-01-27
 */

import { useMemo } from 'react';
import { format } from 'date-fns';
import { applyRounding, roundHours, roundCurrency } from '../utils/billing';
import { useUnifiedBilling } from './useUnifiedBilling';
import type { TimesheetEntry, ProjectRateDisplayWithBilling, RoundingIncrement } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface TaskData {
  taskName: string;
  hours: number;      // Rounded hours
  revenue: number;    // Base revenue (roundedHours × rate)
}

export interface DayData {
  date: string;          // YYYY-MM-DD for sorting
  displayDate: string;   // "Mon, Jan 15" for display
  hours: number;         // Sum of task rounded hours
  revenue: number;       // Sum of task base revenue
  tasks: TaskData[];
}

export interface EmployeeData {
  employeeId: string;
  employeeName: string;
  hours: number;         // Sum of day hours
  revenue: number;       // Sum of day base revenue
  days: DayData[];
}

export interface ProjectData {
  projectId: string;
  projectName: string;
  rate: number;
  rounding: RoundingIncrement;
  // Billed amounts (after MIN/MAX/CARRYOVER)
  hours: number;
  revenue: number;
  // Flags for billing adjustments
  minimumApplied: boolean;
  maximumApplied: boolean;
  carryoverIn: number;
  employees: EmployeeData[];
}

export interface CompanyData {
  companyId: string;
  companyName: string;
  // Billed amounts (sum of project billed)
  hours: number;
  revenue: number;
  projects: ProjectData[];
}

export interface ProjectHierarchyResult {
  companies: CompanyData[];
  totalHours: number;
  totalRevenue: number;
}

// ============================================================================
// Hook
// ============================================================================

interface UseProjectHierarchyParams {
  /** Raw timesheet entries */
  entries: TimesheetEntry[];
  /** Projects with billing configuration from useMonthlyRates */
  projectsWithRates: ProjectRateDisplayWithBilling[];
  /** Lookup from external project_id to canonical external project_id */
  projectCanonicalIdLookup?: Map<string, string>;
  /** Lookup from user_id to canonical display name */
  userIdToDisplayNameLookup: Map<string, string>;
}

export function useProjectHierarchy({
  entries,
  projectsWithRates,
  projectCanonicalIdLookup,
  userIdToDisplayNameLookup,
}: UseProjectHierarchyParams): ProjectHierarchyResult {
  // Use unified billing to get project-level billed hours/revenue (with MIN/MAX/CARRYOVER)
  const { billingResult } = useUnifiedBilling({
    entries,
    projectsWithRates,
    projectCanonicalIdLookup,
  });

  // Build lookup maps from billing result
  const projectBillingLookup = useMemo(() => {
    const lookup = new Map<string, {
      billedHours: number;
      billedRevenue: number;
      rate: number;
      rounding: RoundingIncrement;
      minimumApplied: boolean;
      maximumApplied: boolean;
      carryoverIn: number;
    }>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          lookup.set(project.projectId, {
            billedHours: project.billedHours,
            billedRevenue: project.billedRevenue,
            rate: project.rate,
            rounding: project.rounding,
            minimumApplied: project.minimumApplied,
            maximumApplied: project.maximumApplied,
            carryoverIn: project.carryoverIn,
          });
        }
      }
    }
    return lookup;
  }, [billingResult]);

  // Build company lookup from billing result
  const companyLookup = useMemo(() => {
    const lookup = new Map<string, { companyId: string; companyName: string }>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          lookup.set(project.projectId, {
            companyId: company.companyId,
            companyName: company.companyName,
          });
        }
      }
    }
    return lookup;
  }, [billingResult]);

  // Build project name lookup from billing result
  const projectNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          lookup.set(project.projectId, project.projectName);
        }
      }
    }
    return lookup;
  }, [billingResult]);

  // Helper to get canonical project ID
  const getCanonicalProjectId = (projectId: string): string => {
    if (!projectId) return projectId;
    if (projectCanonicalIdLookup) {
      return projectCanonicalIdLookup.get(projectId) || projectId;
    }
    return projectId;
  };

  return useMemo(() => {
    // Build nested structure: Company -> Project -> Employee -> Day -> Task
    // Store raw rounded minutes for later conversion
    const companyMap = new Map<string, {
      companyId: string;
      companyName: string;
      projects: Map<string, {
        projectId: string;
        projectName: string;
        rate: number;
        rounding: RoundingIncrement;
        billedHours: number;
        billedRevenue: number;
        minimumApplied: boolean;
        maximumApplied: boolean;
        carryoverIn: number;
        employees: Map<string, {
          employeeId: string;
          employeeName: string;
          days: Map<string, {
            date: string;
            tasks: Map<string, number>; // taskName -> raw minutes (before rounding)
          }>;
        }>;
      }>;
    }>();

    // Process each entry
    for (const entry of entries) {
      const projectId = entry.project_id;
      if (!projectId) continue;

      const canonicalProjectId = getCanonicalProjectId(projectId);
      const billing = projectBillingLookup.get(canonicalProjectId);
      const companyInfo = companyLookup.get(canonicalProjectId);
      if (!billing || !companyInfo) continue;

      const projectName = projectNameLookup.get(canonicalProjectId) || canonicalProjectId;

      // Get employee name
      const employeeId = entry.user_id || '__UNKNOWN__';
      const employeeName = userIdToDisplayNameLookup.get(entry.user_id || '')
        || entry.user_name
        || 'Unknown';

      // Get or create company
      if (!companyMap.has(companyInfo.companyId)) {
        companyMap.set(companyInfo.companyId, {
          companyId: companyInfo.companyId,
          companyName: companyInfo.companyName,
          projects: new Map(),
        });
      }
      const company = companyMap.get(companyInfo.companyId)!;

      // Get or create project
      if (!company.projects.has(canonicalProjectId)) {
        company.projects.set(canonicalProjectId, {
          projectId: canonicalProjectId,
          projectName,
          rate: billing.rate,
          rounding: billing.rounding,
          billedHours: billing.billedHours,
          billedRevenue: billing.billedRevenue,
          minimumApplied: billing.minimumApplied,
          maximumApplied: billing.maximumApplied,
          carryoverIn: billing.carryoverIn,
          employees: new Map(),
        });
      }
      const project = company.projects.get(canonicalProjectId)!;

      // Get or create employee
      if (!project.employees.has(employeeId)) {
        project.employees.set(employeeId, {
          employeeId,
          employeeName,
          days: new Map(),
        });
      }
      const employee = project.employees.get(employeeId)!;

      // Get or create day
      const workDate = entry.work_date;
      if (!employee.days.has(workDate)) {
        employee.days.set(workDate, {
          date: workDate,
          tasks: new Map(),
        });
      }
      const day = employee.days.get(workDate)!;

      // Aggregate task minutes (raw, before rounding)
      const taskName = entry.task_name || 'No Task';
      const currentTaskMinutes = day.tasks.get(taskName) || 0;
      day.tasks.set(taskName, currentTaskMinutes + entry.total_minutes);
    }

    // Convert maps to arrays and calculate rounded hours/base revenue
    const companies: CompanyData[] = [];
    let totalHours = 0;
    let totalRevenue = 0;

    for (const companyEntry of companyMap.values()) {
      const projects: ProjectData[] = [];
      let companyHours = 0;
      let companyRevenue = 0;

      for (const projectEntry of companyEntry.projects.values()) {
        const { rate, rounding, billedHours, billedRevenue, minimumApplied, maximumApplied, carryoverIn } = projectEntry;
        const employees: EmployeeData[] = [];

        for (const employeeEntry of projectEntry.employees.values()) {
          const days: DayData[] = [];
          let employeeHours = 0;
          let employeeRevenue = 0;

          for (const dayEntry of employeeEntry.days.values()) {
            const tasks: TaskData[] = [];
            let dayHours = 0;
            let dayRevenue = 0;

            for (const [taskName, rawMinutes] of dayEntry.tasks) {
              // Apply rounding at task level, calculate base revenue
              const roundedMinutes = applyRounding(rawMinutes, rounding);
              const hours = roundHours(roundedMinutes / 60);
              const revenue = roundCurrency(hours * rate);

              tasks.push({
                taskName,
                hours,
                revenue,
              });

              dayHours += hours;
              dayRevenue += revenue;
            }

            // Sort tasks by name
            tasks.sort((a, b) => a.taskName.localeCompare(b.taskName));

            // Format display date: "Mon, Jan 15"
            const displayDate = format(new Date(dayEntry.date + 'T12:00:00'), 'EEE, MMM d');

            // Round accumulated values
            dayHours = roundHours(dayHours);
            dayRevenue = roundCurrency(dayRevenue);

            days.push({
              date: dayEntry.date,
              displayDate,
              hours: dayHours,
              revenue: dayRevenue,
              tasks,
            });

            employeeHours += dayHours;
            employeeRevenue += dayRevenue;
          }

          // Sort days by date descending (most recent first)
          days.sort((a, b) => b.date.localeCompare(a.date));

          // Round accumulated values
          employeeHours = roundHours(employeeHours);
          employeeRevenue = roundCurrency(employeeRevenue);

          employees.push({
            employeeId: employeeEntry.employeeId,
            employeeName: employeeEntry.employeeName,
            hours: employeeHours,
            revenue: employeeRevenue,
            days,
          });
        }

        // Sort employees by name
        employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

        // Project level uses BILLED hours/revenue from unified billing
        projects.push({
          projectId: projectEntry.projectId,
          projectName: projectEntry.projectName,
          rate,
          rounding,
          hours: billedHours,
          revenue: billedRevenue,
          minimumApplied,
          maximumApplied,
          carryoverIn,
          employees,
        });

        companyHours += billedHours;
        companyRevenue += billedRevenue;
      }

      // Sort projects by name
      projects.sort((a, b) => a.projectName.localeCompare(b.projectName));

      // Round company totals
      companyHours = roundHours(companyHours);
      companyRevenue = roundCurrency(companyRevenue);

      companies.push({
        companyId: companyEntry.companyId,
        companyName: companyEntry.companyName,
        hours: companyHours,
        revenue: companyRevenue,
        projects,
      });

      totalHours += companyHours;
      totalRevenue += companyRevenue;
    }

    // Sort companies by name
    companies.sort((a, b) => a.companyName.localeCompare(b.companyName));

    // Round totals
    totalHours = roundHours(totalHours);
    totalRevenue = roundCurrency(totalRevenue);

    return {
      companies,
      totalHours,
      totalRevenue,
    };
  }, [entries, projectBillingLookup, companyLookup, projectNameLookup, userIdToDisplayNameLookup, projectCanonicalIdLookup]);
}

export default useProjectHierarchy;
