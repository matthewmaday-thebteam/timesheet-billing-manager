/**
 * useProjectHierarchy - Build 5-tier hierarchical data for Projects page
 *
 * Hierarchy: Company => Project => Employee => Day => Task
 *
 * Layer 2 approach (pure work performed):
 * - ALL 5 tiers built from employee_totals (Layer 2) rows
 * - Revenue = rounded_hours x project_rate at every tier
 * - Project/Company tiers sum from child rows (no billing engine)
 * - No carryover, no MIN/MAX, no billing adjustments
 *
 * @official 2026-04-05
 */

import { useMemo } from 'react';
import { format } from 'date-fns';
import { roundHours, roundCurrency } from '../utils/billing';
import type { EmployeeTotal, ProjectRateDisplayWithBilling } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface TaskData {
  taskName: string;
  hours: number;      // Rounded hours (from Layer 2)
  revenue: number;    // roundedHours x rate
}

export interface DayData {
  date: string;          // YYYY-MM-DD for sorting
  displayDate: string;   // "Mon, Jan 15" for display
  hours: number;         // Sum of task rounded hours
  revenue: number;       // Sum of task revenue
  tasks: TaskData[];
}

export interface EmployeeData {
  employeeId: string;
  employeeName: string;
  hours: number;         // Sum of day hours
  revenue: number;       // Sum of day revenue
  days: DayData[];
}

export interface ProjectData {
  projectId: string;
  projectName: string;
  rate: number;
  // Summed from employees (pure work performed)
  hours: number;
  revenue: number;
  employees: EmployeeData[];
}

export interface CompanyData {
  companyId: string;
  companyName: string;
  // Summed from projects (pure work performed)
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
  /** Layer 2 employee_totals rows */
  rows: EmployeeTotal[];
  /** Projects with rates from useMonthlyRates */
  projectsWithRates: ProjectRateDisplayWithBilling[];
  /** Lookup from external project_id to canonical external project_id */
  projectCanonicalIdLookup?: Map<string, string>;
  /** Lookup from user_id to canonical display name */
  userIdToDisplayNameLookup: Map<string, string>;
}

export function useProjectHierarchy({
  rows,
  projectsWithRates,
  projectCanonicalIdLookup,
  userIdToDisplayNameLookup,
}: UseProjectHierarchyParams): ProjectHierarchyResult {

  // Build rate lookup: canonical external project_id -> rate
  const rateLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    for (const project of projectsWithRates) {
      if (project.externalProjectId) {
        lookup.set(project.externalProjectId, project.effectiveRate);
      }
    }
    return lookup;
  }, [projectsWithRates]);

  // Build project name lookup: canonical external project_id -> project name
  const projectNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const project of projectsWithRates) {
      if (project.externalProjectId) {
        lookup.set(project.externalProjectId, project.projectName);
      }
    }
    return lookup;
  }, [projectsWithRates]);

  // Build company lookup: canonical external project_id -> { companyId, companyName }
  const companyLookup = useMemo(() => {
    const lookup = new Map<string, { companyId: string; companyName: string }>();
    for (const project of projectsWithRates) {
      if (project.externalProjectId) {
        lookup.set(project.externalProjectId, {
          companyId: project.canonicalClientId || project.clientId || '__UNKNOWN__',
          companyName: project.canonicalClientName || project.clientName || 'Unknown',
        });
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
    // Build nested structure: Company -> Project -> Employee -> Day -> Task
    const companyMap = new Map<string, {
      companyId: string;
      companyName: string;
      projects: Map<string, {
        projectId: string;
        projectName: string;
        rate: number;
        employees: Map<string, {
          employeeId: string;
          employeeName: string;
          days: Map<string, {
            date: string;
            tasks: Map<string, number>; // taskName -> rounded_minutes (from Layer 2)
          }>;
        }>;
      }>;
    }>();

    // Process each Layer 2 row
    for (const row of rows) {
      const projectId = row.project_id;
      if (!projectId) continue;

      const canonicalProjectId = getCanonicalProjectId(projectId);
      const companyInfo = companyLookup.get(canonicalProjectId);
      if (!companyInfo) continue; // Skip if project not in rates (inactive/unknown)

      const rate = rateLookup.get(canonicalProjectId) ?? 0;
      const projectName = projectNameLookup.get(canonicalProjectId) || row.project_name || canonicalProjectId;

      // Get employee name
      const employeeId = row.user_id || '__UNKNOWN__';
      const employeeName = userIdToDisplayNameLookup.get(row.user_id || '')
        || row.user_name
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
          rate,
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
      const workDate = row.work_date;
      if (!employee.days.has(workDate)) {
        employee.days.set(workDate, {
          date: workDate,
          tasks: new Map(),
        });
      }
      const day = employee.days.get(workDate)!;

      // Aggregate task rounded_minutes from Layer 2
      const taskName = row.task_name || 'No Task';
      const currentTaskMinutes = day.tasks.get(taskName) || 0;
      day.tasks.set(taskName, currentTaskMinutes + row.rounded_minutes);
    }

    // Convert maps to arrays and calculate hours/revenue
    const companies: CompanyData[] = [];
    let totalHours = 0;
    let totalRevenue = 0;

    for (const companyEntry of companyMap.values()) {
      const projects: ProjectData[] = [];
      let companyHours = 0;
      let companyRevenue = 0;

      for (const projectEntry of companyEntry.projects.values()) {
        const { rate } = projectEntry;
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

            for (const [taskName, roundedMinutes] of dayEntry.tasks) {
              // Convert rounded minutes to hours, calculate revenue
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

        // Project level: sum from employees (pure work performed)
        projectHours = roundHours(employees.reduce((sum, e) => sum + e.hours, 0));
        projectRevenue = roundCurrency(employees.reduce((sum, e) => sum + e.revenue, 0));

        projects.push({
          projectId: projectEntry.projectId,
          projectName: projectEntry.projectName,
          rate,
          hours: projectHours,
          revenue: projectRevenue,
          employees,
        });

        companyHours += projectHours;
        companyRevenue += projectRevenue;
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
  }, [rows, rateLookup, companyLookup, projectNameLookup, userIdToDisplayNameLookup, projectCanonicalIdLookup]);
}

export default useProjectHierarchy;
