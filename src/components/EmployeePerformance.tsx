/**
 * EmployeePerformance - Dashboard component showing employee hours, profit, and revenue
 *
 * 4-tier expandable table:
 * - Tier 1: Employee (Name, PTO, Hours, Profit, Revenue)
 * - Tier 2: Company (Hours, Profit, Revenue)
 * - Tier 3: Project (Hours, Profit, Revenue)
 * - Tier 4: Task (Hours, Profit, Revenue)
 *
 * Revenue = rounded_hours x project_rate (from Rates page)
 * Profit = revenue - (rounded_hours x employee_hourly_rate) (from Employee Management page)
 * All hours are rounded hours from Layer 2 data (employee_totals).
 *
 * @category Component
 */

import { useState, useMemo, useEffect, Fragment } from 'react';
import type { EmployeeTotal, ProjectRateDisplayWithBilling, EmployeeTimeOff, ResourceWithGrouping } from '../types';
import { formatCurrency, formatHours } from '../utils/billing';
import { minutesToHours } from '../utils/calculations';
import { ChevronIcon } from './ChevronIcon';
import { Card } from './Card';

interface EmployeePerformanceProps {
  /** Layer 2 employee_totals rows */
  rows: EmployeeTotal[];
  /** Projects with billing configuration (for project rates) */
  projectsWithRates: ProjectRateDisplayWithBilling[];
  /** Employee entities (for employee hourly rate) */
  employees: ResourceWithGrouping[];
  /** Employee time-off records for the period */
  timeOff?: EmployeeTimeOff[];
  /** Function to get canonical company name from client_id (ID-only lookup) */
  getCanonicalCompanyName: (clientId: string) => string;
  /** Lookup from user_id to CANONICAL display name (for proper employee grouping) */
  userIdToDisplayNameLookup: Map<string, string>;
  /** Lookup from external project_id to CANONICAL project_id (for billing config lookups) */
  projectCanonicalIdLookup?: Map<string, string>;
}

interface TaskData {
  taskName: string;
  roundedMinutes: number;
  revenue: number;
  profit: number | null;
}

interface ProjectData {
  projectName: string;
  projectId: string;
  roundedMinutes: number;
  revenue: number;
  profit: number | null;
  tasks: TaskData[];
}

interface CompanyData {
  companyName: string;
  companyId: string;
  roundedMinutes: number;
  revenue: number;
  profit: number | null;
  projects: ProjectData[];
}

interface EmployeeData {
  name: string;
  ptoDays: number;
  roundedMinutes: number;
  revenue: number;
  profit: number | null;
  companies: CompanyData[];
}

export function EmployeePerformance({
  rows,
  projectsWithRates,
  employees,
  timeOff = [],
  getCanonicalCompanyName,
  userIdToDisplayNameLookup,
  projectCanonicalIdLookup,
}: EmployeePerformanceProps) {
  // Helper to get canonical project ID (for member project -> primary project mapping)
  const getCanonicalProjectId = (projectId: string): string => {
    if (!projectId || !projectCanonicalIdLookup) return projectId;
    return projectCanonicalIdLookup.get(projectId) || projectId;
  };

  // Build lookup map: canonical external projectId -> rate
  const projectRateLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projectsWithRates) {
      map.set(p.externalProjectId, p.effectiveRate);
    }
    return map;
  }, [projectsWithRates]);

  // Build lookup map: canonical display name -> hourly_rate
  const employeeHourlyRateLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const emp of employees) {
      const displayName = emp.first_name || emp.last_name
        ? [emp.first_name, emp.last_name].filter(Boolean).join(' ')
        : emp.external_label;
      if (emp.hourly_rate != null) {
        map.set(displayName, emp.hourly_rate);
      }
    }
    return map;
  }, [employees]);

  // Build PTO lookup: display name -> total days
  const ptoByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const to of timeOff) {
      const name = to.employee_name;
      const current = map.get(name) || 0;
      map.set(name, current + (to.total_days || 0));
    }
    return map;
  }, [timeOff]);

  // Build hierarchical data: Employee -> Company -> Project -> Task
  const employeeData = useMemo(() => {
    // First pass: group rows by user -> company -> project -> task
    // Key is CANONICAL display name (for proper grouping of employees across systems)
    const userMap = new Map<string, Map<string, Map<string, Map<string, number>>>>();
    // Track companyId to companyName mapping for each user
    const userCompanyNames = new Map<string, Map<string, string>>();

    for (const row of rows) {
      // Use user_id -> canonical display name lookup for proper employee grouping
      const userName = (row.user_id && userIdToDisplayNameLookup.get(row.user_id)) || row.user_name;
      const projectId = row.project_id || '';
      const projectName = row.project_name || 'Unknown Project';
      const taskName = row.task_name || 'No Task';

      // Get canonical company name via ID-based lookup
      const companyId = row.client_id || '';
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

      // Sum rounded_minutes from Layer 2 data
      const currentMinutes = taskMap.get(taskName) || 0;
      taskMap.set(taskName, currentMinutes + row.rounded_minutes);
    }

    // Second pass: calculate revenue and profit from rounded hours
    const employeesList: EmployeeData[] = [];

    for (const [userName, companyMap] of userMap) {
      const companyNameMap = userCompanyNames.get(userName)!;
      const companies: CompanyData[] = [];
      let employeeTotalRoundedMinutes = 0;
      let employeeTotalRevenue = 0;
      let employeeTotalProfit: number | null = null;

      // Look up employee hourly rate
      const employeeHourlyRate = employeeHourlyRateLookup.get(userName) ?? null;

      for (const [companyId, projectMap] of companyMap) {
        const projects: ProjectData[] = [];
        let companyTotalRoundedMinutes = 0;
        let companyTotalRevenue = 0;
        let companyTotalProfit: number | null = null;

        const companyName = companyNameMap.get(companyId) || companyId;

        for (const [projectKey, taskMap] of projectMap) {
          const [projectId, projectName] = projectKey.split('::');
          // Use canonical project ID for rate lookup
          const canonicalProjectId = getCanonicalProjectId(projectId);
          const projectRate = projectRateLookup.get(canonicalProjectId) ?? 0;

          const tasks: TaskData[] = [];
          let projectTotalRoundedMinutes = 0;

          for (const [taskName, roundedMinutes] of taskMap) {
            const roundedHours = roundedMinutes / 60;

            // Revenue = rounded_hours x project_rate
            const taskRevenue = roundedHours * projectRate;

            // Profit = revenue - (rounded_hours x employee_hourly_rate)
            let taskProfit: number | null = null;
            if (employeeHourlyRate !== null) {
              taskProfit = taskRevenue - (roundedHours * employeeHourlyRate);
            }

            tasks.push({
              taskName,
              roundedMinutes,
              revenue: taskRevenue,
              profit: taskProfit,
            });

            projectTotalRoundedMinutes += roundedMinutes;
          }

          // Sum project revenue and profit from tasks
          const projectRevenue = tasks.reduce((sum, t) => sum + t.revenue, 0);
          let projectProfit: number | null = null;
          if (employeeHourlyRate !== null) {
            projectProfit = tasks.reduce((sum, t) => sum + (t.profit ?? 0), 0);
          }

          // Sort tasks alphabetically
          tasks.sort((a, b) => a.taskName.localeCompare(b.taskName));

          projects.push({
            projectName,
            projectId,
            roundedMinutes: projectTotalRoundedMinutes,
            revenue: projectRevenue,
            profit: projectProfit,
            tasks,
          });

          companyTotalRoundedMinutes += projectTotalRoundedMinutes;
          companyTotalRevenue += projectRevenue;
          if (projectProfit !== null) {
            companyTotalProfit = (companyTotalProfit ?? 0) + projectProfit;
          }
        }

        // Sort projects alphabetically
        projects.sort((a, b) => a.projectName.localeCompare(b.projectName));

        companies.push({
          companyName,
          companyId,
          roundedMinutes: companyTotalRoundedMinutes,
          revenue: companyTotalRevenue,
          profit: companyTotalProfit,
          projects,
        });

        employeeTotalRoundedMinutes += companyTotalRoundedMinutes;
        employeeTotalRevenue += companyTotalRevenue;
        if (companyTotalProfit !== null) {
          employeeTotalProfit = (employeeTotalProfit ?? 0) + companyTotalProfit;
        }
      }

      // Sort companies alphabetically
      companies.sort((a, b) => a.companyName.localeCompare(b.companyName));

      employeesList.push({
        name: userName,
        ptoDays: ptoByEmployee.get(userName) || 0,
        roundedMinutes: employeeTotalRoundedMinutes,
        revenue: employeeTotalRevenue,
        profit: employeeTotalProfit,
        companies,
      });
    }

    // Sort employees by hours worked (highest first)
    return employeesList.sort((a, b) => b.roundedMinutes - a.roundedMinutes);
  }, [rows, projectRateLookup, employeeHourlyRateLookup, ptoByEmployee, userIdToDisplayNameLookup, getCanonicalCompanyName, projectCanonicalIdLookup]);

  // Calculate footer totals from employee rows (NOT from billingResult)
  const totalRoundedMinutes = employeeData.reduce((sum, emp) => sum + emp.roundedMinutes, 0);
  const totalRevenue = employeeData.reduce((sum, emp) => sum + emp.revenue, 0);
  const totalPtoDays = employeeData.reduce((sum, emp) => sum + emp.ptoDays, 0);
  const totalProfit = employeeData.reduce((sum, emp) => emp.profit !== null ? sum + emp.profit : sum, 0);
  const hasAnyProfit = employeeData.some(emp => emp.profit !== null);

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
              <span className="text-lg font-semibold text-vercel-gray-600">{formatCurrency(totalRevenue)}</span>
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
                Profit
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
                        <span className="text-sm font-semibold text-vercel-gray-600">{employee.name}</span>
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
                      <span className="text-sm text-vercel-gray-600">{minutesToHours(employee.roundedMinutes)}</span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span className={`text-sm font-medium ${employee.profit !== null && employee.profit < 0 ? 'text-error-text' : 'text-vercel-gray-600'}`}>
                        {formatCurrency(employee.profit)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span className="text-sm font-medium text-vercel-gray-600">{formatCurrency(employee.revenue)}</span>
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
                            <span className={`text-sm ${company.profit !== null && company.profit < 0 ? 'text-error-text' : 'text-vercel-gray-200'}`}>
                              {formatCurrency(company.profit)}
                            </span>
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
                                  <span className={`text-sm ${project.profit !== null && project.profit < 0 ? 'text-error-text' : 'text-vercel-gray-300'}`}>
                                    {formatCurrency(project.profit)}
                                  </span>
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
                                    <span className={`text-sm ${task.profit !== null && task.profit < 0 ? 'text-error-text' : 'text-vercel-gray-400'}`}>
                                      {formatCurrency(task.profit)}
                                    </span>
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
                {formatHours(totalRoundedMinutes / 60)}
              </td>
              <td className="px-6 py-4 text-right">
                <span className={`text-sm font-semibold ${hasAnyProfit && totalProfit < 0 ? 'text-error-text' : 'text-vercel-gray-600'}`}>
                  {formatCurrency(hasAnyProfit ? totalProfit : null)}
                </span>
              </td>
              <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                {formatCurrency(totalRevenue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

export default EmployeePerformance;
