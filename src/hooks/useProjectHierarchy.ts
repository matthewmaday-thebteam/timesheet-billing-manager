/**
 * useProjectHierarchy - Build 5-tier hierarchical data for Projects page
 *
 * Hierarchy: Company => Project => Employee => Day => Task
 *
 * Uses timesheet data grouped canonically by:
 * - Company: via project's canonical company info (from projectsWithRates)
 * - Project: via canonical project ID mapping
 * - Employee: via userIdToDisplayNameLookup for canonical employee names
 *
 * @official 2026-01-27
 */

import { useMemo } from 'react';
import { format } from 'date-fns';
import { applyRounding, DEFAULT_ROUNDING_INCREMENT } from '../utils/billing';
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
  return useMemo(() => {
    // Build lookup map: externalProjectId -> billing config
    const billingConfigByProjectId = new Map<string, {
      rate: number;
      rounding: RoundingIncrement;
      projectName: string;
      canonicalClientId: string;
      canonicalClientName: string;
    }>();

    for (const p of projectsWithRates) {
      if (p.externalProjectId) {
        billingConfigByProjectId.set(p.externalProjectId, {
          rate: p.effectiveRate,
          rounding: p.effectiveRounding ?? DEFAULT_ROUNDING_INCREMENT,
          projectName: p.projectName,
          canonicalClientId: p.canonicalClientId || p.clientId || '__UNASSIGNED__',
          canonicalClientName: p.canonicalClientName || p.clientName || 'Unassigned',
        });
      }
    }

    // Helper to get canonical project ID
    const getCanonicalProjectId = (projectId: string): string => {
      if (!projectId) return projectId;
      if (projectCanonicalIdLookup) {
        return projectCanonicalIdLookup.get(projectId) || projectId;
      }
      return projectId;
    };

    // Build nested structure: Company -> Project -> Employee -> Day -> Task
    // Key format: companyId|projectId|employeeId|date|taskName
    const companyMap = new Map<string, {
      companyId: string;
      companyName: string;
      projects: Map<string, {
        projectId: string;
        projectName: string;
        rate: number;
        rounding: RoundingIncrement;
        employees: Map<string, {
          employeeId: string;
          employeeName: string;
          days: Map<string, {
            date: string;
            tasks: Map<string, number>; // taskName -> minutes
          }>;
        }>;
      }>;
    }>();

    // Process each entry
    for (const entry of entries) {
      const projectId = entry.project_id;
      if (!projectId) continue;

      const canonicalProjectId = getCanonicalProjectId(projectId);
      const config = billingConfigByProjectId.get(canonicalProjectId);
      if (!config) continue; // Skip unmatched projects

      const { rate, rounding, projectName, canonicalClientId, canonicalClientName } = config;

      // Get employee name
      const employeeId = entry.user_id || '__UNKNOWN__';
      const employeeName = userIdToDisplayNameLookup.get(entry.user_id || '')
        || entry.user_name
        || 'Unknown';

      // Get or create company
      if (!companyMap.has(canonicalClientId)) {
        companyMap.set(canonicalClientId, {
          companyId: canonicalClientId,
          companyName: canonicalClientName,
          projects: new Map(),
        });
      }
      const company = companyMap.get(canonicalClientId)!;

      // Get or create project
      if (!company.projects.has(canonicalProjectId)) {
        company.projects.set(canonicalProjectId, {
          projectId: canonicalProjectId,
          projectName,
          rate,
          rounding,
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

      // Aggregate task minutes
      const taskName = entry.task_name || 'No Task';
      const currentMinutes = day.tasks.get(taskName) || 0;
      day.tasks.set(taskName, currentMinutes + entry.total_minutes);
    }

    // Convert maps to arrays and calculate hours/revenue with rounding
    const companies: CompanyData[] = [];
    let totalHours = 0;
    let totalRevenue = 0;

    for (const companyEntry of companyMap.values()) {
      const projects: ProjectData[] = [];
      let companyHours = 0;
      let companyRevenue = 0;

      for (const projectEntry of companyEntry.projects.values()) {
        const { rate, rounding } = projectEntry;
        const employees: EmployeeData[] = [];
        let projectHours = 0;
        let projectRevenue = 0;

        for (const employeeEntry of projectEntry.employees.values()) {
          const days: DayData[] = [];
          let employeeHours = 0;
          let employeeRevenue = 0;

          for (const dayEntry of employeeEntry.days.values()) {
            const tasks: TaskData[] = [];
            let dayHours = 0;
            let dayRevenue = 0;

            for (const [taskName, minutes] of dayEntry.tasks) {
              // Apply rounding at task level, then calculate revenue
              const roundedMinutes = applyRounding(minutes, rounding);
              const hours = roundedMinutes / 60;
              const revenue = hours * rate;

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

          employees.push({
            employeeId: employeeEntry.employeeId,
            employeeName: employeeEntry.employeeName,
            hours: employeeHours,
            revenue: employeeRevenue,
            days,
          });

          projectHours += employeeHours;
          projectRevenue += employeeRevenue;
        }

        // Sort employees by name
        employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

        projects.push({
          projectId: projectEntry.projectId,
          projectName: projectEntry.projectName,
          rate: projectEntry.rate,
          hours: projectHours,
          revenue: projectRevenue,
          employees,
        });

        companyHours += projectHours;
        companyRevenue += projectRevenue;
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
  }, [entries, projectsWithRates, projectCanonicalIdLookup, userIdToDisplayNameLookup]);
}

export default useProjectHierarchy;
