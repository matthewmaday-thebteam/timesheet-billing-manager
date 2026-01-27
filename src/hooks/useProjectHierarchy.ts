/**
 * useProjectHierarchy - Build 5-tier hierarchical data for Projects page
 *
 * Hierarchy: Company => Project => Employee => Day => Task
 *
 * Uses useUnifiedBilling for project-level billed hours/revenue (with MIN/MAX/CARRYOVER),
 * then distributes proportionally to Employee/Day/Task based on work share.
 *
 * @official 2026-01-27
 */

import { useMemo } from 'react';
import { format } from 'date-fns';
import { applyRounding, DEFAULT_ROUNDING_INCREMENT } from '../utils/billing';
import { useUnifiedBilling } from './useUnifiedBilling';
import type { TimesheetEntry, ProjectRateDisplayWithBilling, RoundingIncrement } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface TaskData {
  taskName: string;
  hours: number;
  revenue: number;
}

export interface DayData {
  date: string;          // YYYY-MM-DD for sorting
  displayDate: string;   // "Mon, Jan 15" for display
  hours: number;
  revenue: number;
  tasks: TaskData[];
}

export interface EmployeeData {
  employeeId: string;
  employeeName: string;
  hours: number;
  revenue: number;
  days: DayData[];
}

export interface ProjectData {
  projectId: string;
  projectName: string;
  rate: number;
  hours: number;
  revenue: number;
  employees: EmployeeData[];
}

export interface CompanyData {
  companyId: string;
  companyName: string;
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
    const lookup = new Map<string, { billedHours: number; billedRevenue: number; rate: number }>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          lookup.set(project.projectId, {
            billedHours: project.billedHours,
            billedRevenue: project.billedRevenue,
            rate: project.rate,
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

  // Build rounding config lookup
  const roundingLookup = useMemo(() => {
    const lookup = new Map<string, RoundingIncrement>();
    for (const p of projectsWithRates) {
      if (p.externalProjectId) {
        lookup.set(p.externalProjectId, p.effectiveRounding ?? DEFAULT_ROUNDING_INCREMENT);
      }
    }
    return lookup;
  }, [projectsWithRates]);

  // Helper to get canonical project ID
  const getCanonicalProjectId = (projectId: string): string => {
    if (!projectId) return projectId;
    if (projectCanonicalIdLookup) {
      return projectCanonicalIdLookup.get(projectId) || projectId;
    }
    return projectId;
  };

  return useMemo(() => {
    // First pass: calculate total rounded minutes per project (for proportional distribution)
    const projectTotalRoundedMinutes = new Map<string, number>();

    for (const entry of entries) {
      const projectId = entry.project_id;
      if (!projectId) continue;

      const canonicalProjectId = getCanonicalProjectId(projectId);
      if (!projectBillingLookup.has(canonicalProjectId)) continue;

      const rounding = roundingLookup.get(canonicalProjectId) ?? DEFAULT_ROUNDING_INCREMENT;
      const roundedMinutes = applyRounding(entry.total_minutes, rounding);

      const current = projectTotalRoundedMinutes.get(canonicalProjectId) || 0;
      projectTotalRoundedMinutes.set(canonicalProjectId, current + roundedMinutes);
    }

    // Build nested structure: Company -> Project -> Employee -> Day -> Task
    const companyMap = new Map<string, {
      companyId: string;
      companyName: string;
      projects: Map<string, {
        projectId: string;
        projectName: string;
        rate: number;
        billedHours: number;
        billedRevenue: number;
        totalRoundedMinutes: number;
        employees: Map<string, {
          employeeId: string;
          employeeName: string;
          roundedMinutes: number;
          days: Map<string, {
            date: string;
            roundedMinutes: number;
            tasks: Map<string, number>; // taskName -> roundedMinutes
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
      const rounding = roundingLookup.get(canonicalProjectId) ?? DEFAULT_ROUNDING_INCREMENT;
      const roundedMinutes = applyRounding(entry.total_minutes, rounding);

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
          billedHours: billing.billedHours,
          billedRevenue: billing.billedRevenue,
          totalRoundedMinutes: projectTotalRoundedMinutes.get(canonicalProjectId) || 0,
          employees: new Map(),
        });
      }
      const project = company.projects.get(canonicalProjectId)!;

      // Get or create employee
      if (!project.employees.has(employeeId)) {
        project.employees.set(employeeId, {
          employeeId,
          employeeName,
          roundedMinutes: 0,
          days: new Map(),
        });
      }
      const employee = project.employees.get(employeeId)!;
      employee.roundedMinutes += roundedMinutes;

      // Get or create day
      const workDate = entry.work_date;
      if (!employee.days.has(workDate)) {
        employee.days.set(workDate, {
          date: workDate,
          roundedMinutes: 0,
          tasks: new Map(),
        });
      }
      const day = employee.days.get(workDate)!;
      day.roundedMinutes += roundedMinutes;

      // Aggregate task minutes
      const taskName = entry.task_name || 'No Task';
      const currentTaskMinutes = day.tasks.get(taskName) || 0;
      day.tasks.set(taskName, currentTaskMinutes + roundedMinutes);
    }

    // Convert maps to arrays and calculate proportional hours/revenue
    const companies: CompanyData[] = [];
    let totalHours = 0;
    let totalRevenue = 0;

    for (const companyEntry of companyMap.values()) {
      const projects: ProjectData[] = [];
      let companyHours = 0;
      let companyRevenue = 0;

      for (const projectEntry of companyEntry.projects.values()) {
        const { billedHours, billedRevenue, totalRoundedMinutes } = projectEntry;
        const employees: EmployeeData[] = [];

        for (const employeeEntry of projectEntry.employees.values()) {
          // Calculate employee's share of project billed hours/revenue
          const employeeShare = totalRoundedMinutes > 0
            ? employeeEntry.roundedMinutes / totalRoundedMinutes
            : 0;
          const employeeHours = billedHours * employeeShare;
          const employeeRevenue = billedRevenue * employeeShare;

          const days: DayData[] = [];

          for (const dayEntry of employeeEntry.days.values()) {
            // Calculate day's share of employee's hours/revenue
            const dayShare = employeeEntry.roundedMinutes > 0
              ? dayEntry.roundedMinutes / employeeEntry.roundedMinutes
              : 0;
            const dayHours = employeeHours * dayShare;
            const dayRevenue = employeeRevenue * dayShare;

            const tasks: TaskData[] = [];

            for (const [taskName, taskRoundedMinutes] of dayEntry.tasks) {
              // Calculate task's share of day's hours/revenue
              const taskShare = dayEntry.roundedMinutes > 0
                ? taskRoundedMinutes / dayEntry.roundedMinutes
                : 0;
              const taskHours = dayHours * taskShare;
              const taskRevenue = dayRevenue * taskShare;

              tasks.push({
                taskName,
                hours: taskHours,
                revenue: taskRevenue,
              });
            }

            // Sort tasks by name
            tasks.sort((a, b) => a.taskName.localeCompare(b.taskName));

            // Format display date: "Mon, Jan 15"
            const displayDate = format(new Date(dayEntry.date + 'T12:00:00'), 'EEE, MMM d');

            days.push({
              date: dayEntry.date,
              displayDate,
              hours: dayHours,
              revenue: dayRevenue,
              tasks,
            });
          }

          // Sort days by date descending (most recent first)
          days.sort((a, b) => b.date.localeCompare(a.date));

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

        projects.push({
          projectId: projectEntry.projectId,
          projectName: projectEntry.projectName,
          rate: projectEntry.rate,
          hours: billedHours,
          revenue: billedRevenue,
          employees,
        });

        companyHours += billedHours;
        companyRevenue += billedRevenue;
      }

      // Sort projects by name
      projects.sort((a, b) => a.projectName.localeCompare(b.projectName));

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

    return {
      companies,
      totalHours,
      totalRevenue,
    };
  }, [entries, projectBillingLookup, companyLookup, projectNameLookup, roundingLookup, userIdToDisplayNameLookup, projectCanonicalIdLookup]);
}

export default useProjectHierarchy;
