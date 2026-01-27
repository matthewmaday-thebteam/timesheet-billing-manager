/**
 * EmployeePerformance - Dashboard component showing employee hours and revenue
 *
 * 4-tier expandable table:
 * - Tier 1: Employee (Name, PTO, Hours, Revenue)
 * - Tier 2: Company (Hours, Revenue)
 * - Tier 3: Project (Hours, Revenue)
 * - Tier 4: Task (Hours, Revenue)
 *
 * Revenue calculation uses the same rounding logic as unified billing.
 *
 * @category Component
 */

import { useState, useMemo, useEffect, Fragment } from 'react';
import type { TimesheetEntry, ProjectRateDisplayWithBilling, RoundingIncrement, EmployeeTimeOff } from '../types';
import type { MonthlyBillingResult } from '../utils/billingCalculations';
import { formatCurrency, formatHours, DEFAULT_ROUNDING_INCREMENT } from '../utils/billing';
import { minutesToHours } from '../utils/calculations';
import { ChevronIcon } from './ChevronIcon';
import { Card } from './Card';

interface EmployeePerformanceProps {
  /** Raw timesheet entries */
  entries: TimesheetEntry[];
  /** Projects with billing configuration */
  projectsWithRates: ProjectRateDisplayWithBilling[];
  /** Employee time-off records for the period */
  timeOff?: EmployeeTimeOff[];
  /** Billing result with correct billedRevenue (includes MIN/MAX adjustments) */
  billingResult: MonthlyBillingResult;
  /** Function to get canonical company name from client_id (ID-only lookup) */
  getCanonicalCompanyName: (clientId: string) => string;
  /** Lookup from user_id to CANONICAL display name (for proper employee grouping) */
  userIdToDisplayNameLookup: Map<string, string>;
  /** Lookup from external project_id to CANONICAL project_id (for billing config lookups) */
  projectCanonicalIdLookup?: Map<string, string>;
}

interface TaskData {
  taskName: string;
  minutes: number;
  roundedMinutes: number;
  revenue: number;
}

interface ProjectData {
  projectName: string;
  projectId: string;
  minutes: number;
  roundedMinutes: number;
  revenue: number;
  tasks: TaskData[];
}

interface CompanyData {
  companyName: string;
  companyId: string;
  minutes: number;
  roundedMinutes: number;
  revenue: number;
  projects: ProjectData[];
}

interface EmployeeData {
  name: string;
  ptoDays: number;
  minutes: number;
  roundedMinutes: number;
  revenue: number;
  companies: CompanyData[];
}

/**
 * Round minutes up to the nearest increment (matching billingCalculations.ts)
 */
function roundMinutes(minutes: number, increment: RoundingIncrement): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

export function EmployeePerformance({
  entries,
  projectsWithRates,
  timeOff = [],
  billingResult,
  getCanonicalCompanyName,
  userIdToDisplayNameLookup,
  projectCanonicalIdLookup,
}: EmployeePerformanceProps) {
  // Helper to get canonical project ID (for member project -> primary project mapping)
  const getCanonicalProjectId = (projectId: string): string => {
    if (!projectId || !projectCanonicalIdLookup) return projectId;
    return projectCanonicalIdLookup.get(projectId) || projectId;
  };
  // Build lookup map: projectId -> billing config (ID-based only)
  const projectConfigMap = useMemo(() => {
    const map = new Map<string, { rate: number; rounding: RoundingIncrement }>();
    for (const p of projectsWithRates) {
      map.set(p.externalProjectId, {
        rate: p.effectiveRate,
        rounding: p.effectiveRounding,
      });
    }
    return map;
  }, [projectsWithRates]);

  // Build PTO lookup: display name -> total days
  // Time-off records use employee_name which should match canonical display names
  const ptoByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const to of timeOff) {
      const name = to.employee_name;
      const current = map.get(name) || 0;
      map.set(name, current + (to.total_days || 0));
    }
    return map;
  }, [timeOff]);

  // Build project billedRevenue lookup from billingResult
  // This includes MIN/MAX/ROLLOVER adjustments at project level
  const projectBilledRevenueLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          lookup.set(project.projectId, project.billedRevenue);
        }
      }
    }
    return lookup;
  }, [billingResult]);

  // Build total project minutes lookup (all employees combined) for proportional distribution
  // Uses canonical project ID so member project minutes aggregate with primary
  const projectTotalMinutesLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    for (const entry of entries) {
      const rawProjectId = entry.project_id || '';
      // Map to canonical project ID (member -> primary)
      const projectId = projectCanonicalIdLookup?.get(rawProjectId) || rawProjectId;
      const current = lookup.get(projectId) || 0;
      lookup.set(projectId, current + entry.total_minutes);
    }
    return lookup;
  }, [entries, projectCanonicalIdLookup]);

  // Build hierarchical data: Employee -> Company -> Project -> Task
  const employeeData = useMemo(() => {
    // First pass: group entries by user -> company -> project -> task
    // Key is CANONICAL display name (for proper grouping of employees across systems)
    const userMap = new Map<string, Map<string, Map<string, Map<string, number>>>>();
    // Track companyId to companyName mapping for each user
    const userCompanyNames = new Map<string, Map<string, string>>();

    for (const entry of entries) {
      // Use user_id -> canonical display name lookup for proper employee grouping
      // This ensures employees with different IDs in ClickUp/Clockify are grouped together
      const userName = (entry.user_id && userIdToDisplayNameLookup.get(entry.user_id)) || entry.user_name;
      const projectId = entry.project_id || '';
      const projectName = entry.project_name || 'Unknown Project';
      // Use task_name (description) instead of task_key (ID)
      const taskName = entry.task_name || entry.task_key || 'No Task';

      // Get canonical company name via ID-based lookup (no name fallbacks)
      const companyId = entry.client_id || '';
      const companyName = getCanonicalCompanyName(companyId);

      if (!userMap.has(userName)) {
        userMap.set(userName, new Map());
        userCompanyNames.set(userName, new Map());
      }
      const companyMap = userMap.get(userName)!;
      const companyNameMap = userCompanyNames.get(userName)!;

      // Store companyId -> companyName mapping
      companyNameMap.set(companyId, companyName);

      if (!companyMap.has(companyId)) {
        companyMap.set(companyId, new Map());
      }
      const projectMap = companyMap.get(companyId)!;

      const projectKey = `${projectId}::${projectName}`;
      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, new Map());
      }
      const taskMap = projectMap.get(projectKey)!;

      const currentMinutes = taskMap.get(taskName) || 0;
      taskMap.set(taskName, currentMinutes + entry.total_minutes);
    }

    // Second pass: calculate proportional revenue based on billingResult
    const employees: EmployeeData[] = [];

    for (const [userName, companyMap] of userMap) {
      const companyNameMap = userCompanyNames.get(userName)!;
      const companies: CompanyData[] = [];
      let employeeTotalMinutes = 0;
      let employeeTotalRoundedMinutes = 0;
      let employeeTotalRevenue = 0;

      for (const [companyId, projectMap] of companyMap) {
        const projects: ProjectData[] = [];
        let companyTotalMinutes = 0;
        let companyTotalRoundedMinutes = 0;
        let companyTotalRevenue = 0;

        // Get company name from stored mapping
        const companyName = companyNameMap.get(companyId) || companyId;

        for (const [projectKey, taskMap] of projectMap) {
          const [projectId, projectName] = projectKey.split('::');
          // Use canonical project ID for billing config lookup (member projects -> primary)
          const canonicalProjectId = getCanonicalProjectId(projectId);
          const config = projectConfigMap.get(canonicalProjectId);
          const rounding = config?.rounding ?? DEFAULT_ROUNDING_INCREMENT;

          const tasks: TaskData[] = [];
          let projectTotalMinutes = 0;
          let projectTotalRoundedMinutes = 0;

          for (const [taskName, taskMinutes] of taskMap) {
            const roundedTaskMinutes = roundMinutes(taskMinutes, rounding);

            tasks.push({
              taskName,
              minutes: taskMinutes,
              roundedMinutes: roundedTaskMinutes,
              revenue: 0, // Will be calculated proportionally below
            });

            projectTotalMinutes += taskMinutes;
            projectTotalRoundedMinutes += roundedTaskMinutes;
          }

          // Calculate employee's proportional share of project billedRevenue
          // This ensures MIN/MAX/ROLLOVER adjustments are distributed to employees
          // Use canonical project ID for both lookups (member projects aggregate under primary)
          const totalProjectMinutes = projectTotalMinutesLookup.get(canonicalProjectId) || projectTotalMinutes;
          const projectBilledRevenue = projectBilledRevenueLookup.get(canonicalProjectId) || 0;
          const employeeShare = totalProjectMinutes > 0 ? projectTotalMinutes / totalProjectMinutes : 0;
          const employeeProjectRevenue = projectBilledRevenue * employeeShare;

          // Distribute revenue proportionally across tasks based on rounded minutes
          for (const task of tasks) {
            task.revenue = projectTotalRoundedMinutes > 0
              ? employeeProjectRevenue * (task.roundedMinutes / projectTotalRoundedMinutes)
              : 0;
          }

          // Sort tasks alphabetically
          tasks.sort((a, b) => a.taskName.localeCompare(b.taskName));

          projects.push({
            projectName,
            projectId,
            minutes: projectTotalMinutes,
            roundedMinutes: projectTotalRoundedMinutes,
            revenue: employeeProjectRevenue,
            tasks,
          });

          companyTotalMinutes += projectTotalMinutes;
          companyTotalRoundedMinutes += projectTotalRoundedMinutes;
          companyTotalRevenue += employeeProjectRevenue;
        }

        // Sort projects alphabetically
        projects.sort((a, b) => a.projectName.localeCompare(b.projectName));

        companies.push({
          companyName,
          companyId,
          minutes: companyTotalMinutes,
          roundedMinutes: companyTotalRoundedMinutes,
          revenue: companyTotalRevenue,
          projects,
        });

        employeeTotalMinutes += companyTotalMinutes;
        employeeTotalRoundedMinutes += companyTotalRoundedMinutes;
        employeeTotalRevenue += companyTotalRevenue;
      }

      // Sort companies alphabetically
      companies.sort((a, b) => a.companyName.localeCompare(b.companyName));

      employees.push({
        name: userName,
        ptoDays: ptoByEmployee.get(userName) || 0,
        minutes: employeeTotalMinutes,
        roundedMinutes: employeeTotalRoundedMinutes,
        revenue: employeeTotalRevenue,
        companies,
      });
    }

    // Sort employees by hours worked (highest first)
    return employees.sort((a, b) => b.minutes - a.minutes);
  }, [entries, projectConfigMap, ptoByEmployee, userIdToDisplayNameLookup, getCanonicalCompanyName, projectBilledRevenueLookup, projectTotalMinutesLookup]);

  // Calculate totals - use billingResult for consistency with Projects/Revenue pages
  const totalBilledHours = billingResult.billedHours;
  const totalBilledRevenue = billingResult.billedRevenue;
  const totalPtoDays = employeeData.reduce((sum, emp) => sum + emp.ptoDays, 0);

  // Expanded state for each level
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(() => new Set());
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  // Default all employees to expanded
  useEffect(() => {
    if (employeeData.length > 0) {
      setExpandedEmployees(new Set(employeeData.map(e => e.name)));
    }
  }, [employeeData]);

  const toggleEmployee = (name: string) => {
    setExpandedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleCompany = (key: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleProject = (key: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (employeeData.length === 0) {
    return null;
  }

  return (
    <Card variant="default" padding="none">
      {/* Header */}
      <div className="px-6 py-4 border-b border-vercel-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-vercel-gray-600">Employee Performance</h3>
            <p className="text-xs font-mono text-vercel-gray-400">
              Hours and Revenue for {employeeData.length} team {employeeData.length === 1 ? 'member' : 'members'}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(totalBilledRevenue)}</span>
            </div>
            <div className="text-xs font-mono text-vercel-gray-400">total revenue</div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-vercel-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                PTO
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Hours
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Revenue
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {employeeData.map((employee) => {
              const isEmployeeExpanded = expandedEmployees.has(employee.name);

              return (
                <Fragment key={employee.name}>
                  {/* Tier 1: Employee Row */}
                  <tr
                    className="bg-vercel-gray-50 cursor-pointer hover:bg-vercel-gray-100 transition-colors"
                    onClick={() => toggleEmployee(employee.name)}
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <ChevronIcon expanded={isEmployeeExpanded} className="text-vercel-gray-400" />
                        <span className="text-sm font-semibold text-black">{employee.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right">
                      {employee.ptoDays > 0 ? (
                        <span className="text-sm text-success">{employee.ptoDays}d</span>
                      ) : (
                        <span className="text-sm text-vercel-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span className="text-sm text-black">{minutesToHours(employee.roundedMinutes)}</span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span className="text-sm font-medium text-black">{formatCurrency(employee.revenue)}</span>
                    </td>
                  </tr>

                  {/* Tier 2: Company Rows */}
                  {isEmployeeExpanded && employee.companies.map((company) => {
                    const companyKey = `${employee.name}:${company.companyId}`;
                    const isCompanyExpanded = expandedCompanies.has(companyKey);

                    return (
                      <Fragment key={companyKey}>
                        <tr
                          className="cursor-pointer hover:bg-vercel-gray-50 transition-colors"
                          onClick={() => toggleCompany(companyKey)}
                        >
                          <td className="pl-10 pr-6 py-3">
                            <div className="flex items-center gap-2">
                              <ChevronIcon expanded={isCompanyExpanded} className="text-vercel-gray-300" />
                              <span className="text-sm text-vercel-gray-200">{company.companyName}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-300">—</span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-200">{minutesToHours(company.roundedMinutes)}</span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-200">{formatCurrency(company.revenue)}</span>
                          </td>
                        </tr>

                        {/* Tier 3: Project Rows */}
                        {isCompanyExpanded && company.projects.map((project) => {
                          const projectKey = `${companyKey}:${project.projectId}`;
                          const isProjectExpanded = expandedProjects.has(projectKey);

                          return (
                            <Fragment key={projectKey}>
                              <tr
                                className="cursor-pointer hover:bg-vercel-gray-50 transition-colors"
                                onClick={() => toggleProject(projectKey)}
                              >
                                <td className="pl-16 pr-6 py-2">
                                  <div className="flex items-center gap-2">
                                    <ChevronIcon expanded={isProjectExpanded} className="text-vercel-gray-300" />
                                    <span className="text-sm text-vercel-gray-300">{project.projectName}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-2 text-right">
                                  <span className="text-sm text-vercel-gray-300">—</span>
                                </td>
                                <td className="px-6 py-2 text-right">
                                  <span className="text-sm text-vercel-gray-300">{minutesToHours(project.roundedMinutes)}</span>
                                </td>
                                <td className="px-6 py-2 text-right">
                                  <span className="text-sm text-vercel-gray-300">{formatCurrency(project.revenue)}</span>
                                </td>
                              </tr>

                              {/* Tier 4: Task Rows */}
                              {isProjectExpanded && project.tasks.map((task) => (
                                <tr key={`${projectKey}:${task.taskName}`} className="hover:bg-vercel-gray-50 transition-colors">
                                  <td className="pl-24 pr-6 py-2">
                                    <span className="text-sm text-vercel-gray-400">{task.taskName}</span>
                                  </td>
                                  <td className="px-6 py-2 text-right">
                                    <span className="text-sm text-vercel-gray-400">—</span>
                                  </td>
                                  <td className="px-6 py-2 text-right">
                                    <span className="text-sm text-vercel-gray-400">{minutesToHours(task.roundedMinutes)}</span>
                                  </td>
                                  <td className="px-6 py-2 text-right">
                                    <span className="text-sm text-vercel-gray-400">{formatCurrency(task.revenue)}</span>
                                  </td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-vercel-gray-50">
            <tr>
              <td className="px-6 py-4 text-sm font-semibold text-vercel-gray-600">
                Total
              </td>
              <td className="px-6 py-4 text-right text-sm">
                {totalPtoDays > 0 ? (
                  <span className="text-success">{totalPtoDays}d</span>
                ) : (
                  <span className="text-vercel-gray-400">—</span>
                )}
              </td>
              <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                {formatHours(totalBilledHours)}
              </td>
              <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                {formatCurrency(totalBilledRevenue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

export default EmployeePerformance;
