/**
 * ProjectHierarchyTable - Official Design System Atom
 *
 * A 5-level hierarchical table for the Projects page:
 * Company (Tier 1) => Project (Tier 2) => Employee (Tier 3) => Day (Tier 4) => Task (Tier 5)
 *
 * Follows the same pattern as RevenueTable but with 5 levels instead of 3.
 *
 * @official 2026-01-27
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (header/footer, company rows)
 * - Border: vercel-gray-100
 * - Text: black (company), vercel-gray-200 (project), vercel-gray-300 (employee/day/task)
 * - Radius: rounded-lg
 */

import { useState, useEffect, Fragment } from 'react';
import { formatCurrency, formatHours } from '../../utils/billing';
import { ChevronIcon } from '../ChevronIcon';
import type { ProjectHierarchyResult } from '../../hooks/useProjectHierarchy';

interface ProjectHierarchyTableProps {
  /** Hierarchy data from useProjectHierarchy */
  hierarchyResult: ProjectHierarchyResult;
}

export function ProjectHierarchyTable({ hierarchyResult }: ProjectHierarchyTableProps) {
  // State for 4 levels of expansion (tasks are always visible when day is expanded)
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(() => new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());

  const { companies, totalHours, totalRevenue } = hierarchyResult;

  // Default: Companies expanded (show projects - Tier 2)
  useEffect(() => {
    if (companies.length > 0) {
      setExpandedCompanies(new Set(companies.map(c => c.companyId)));
    }
  }, [companies]);

  const toggleCompany = (companyId: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  };

  const toggleProject = (projectKey: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
      }
      return next;
    });
  };

  const toggleEmployee = (employeeKey: string) => {
    setExpandedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(employeeKey)) {
        next.delete(employeeKey);
      } else {
        next.add(employeeKey);
      }
      return next;
    });
  };

  const toggleDay = (dayKey: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) {
        next.delete(dayKey);
      } else {
        next.add(dayKey);
      }
      return next;
    });
  };

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <table className="w-full">
        <thead className="bg-vercel-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
              Name
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
          {companies.map((company) => {
            const isCompanyExpanded = expandedCompanies.has(company.companyId);

            return (
              <Fragment key={company.companyId}>
                {/* Company Row (Tier 1) - pl-6 */}
                <tr
                  className="bg-vercel-gray-50 cursor-pointer hover:bg-vercel-gray-100 transition-colors"
                  onClick={() => toggleCompany(company.companyId)}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <ChevronIcon expanded={isCompanyExpanded} className="text-vercel-gray-400" />
                      <span className="text-sm font-semibold text-black">{company.companyName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm font-medium text-black">{formatHours(company.hours)}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm font-medium text-black">{formatCurrency(company.revenue)}</span>
                  </td>
                </tr>

                {/* Project Rows (Tier 2) - pl-10 */}
                {isCompanyExpanded && company.projects.map((project) => {
                  const projectKey = `${company.companyId}:${project.projectId}`;
                  const isProjectExpanded = expandedProjects.has(projectKey);

                  return (
                    <Fragment key={projectKey}>
                      <tr
                        className="cursor-pointer hover:bg-vercel-gray-50 transition-colors"
                        onClick={() => toggleProject(projectKey)}
                      >
                        <td className="pl-10 pr-6 py-3">
                          <div className="flex items-center gap-2">
                            <ChevronIcon expanded={isProjectExpanded} className="text-vercel-gray-300" />
                            <span className="text-sm text-vercel-gray-200">{project.projectName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">{formatHours(project.hours)}</span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">{formatCurrency(project.revenue)}</span>
                        </td>
                      </tr>

                      {/* Employee Rows (Tier 3) - pl-14 */}
                      {isProjectExpanded && project.employees.map((employee) => {
                        const employeeKey = `${projectKey}:${employee.employeeId}`;
                        const isEmployeeExpanded = expandedEmployees.has(employeeKey);

                        return (
                          <Fragment key={employeeKey}>
                            <tr
                              className="cursor-pointer hover:bg-vercel-gray-50 transition-colors"
                              onClick={() => toggleEmployee(employeeKey)}
                            >
                              <td className="pl-14 pr-6 py-2">
                                <div className="flex items-center gap-2">
                                  <ChevronIcon expanded={isEmployeeExpanded} className="text-vercel-gray-300" />
                                  <span className="text-sm text-vercel-gray-300">{employee.employeeName}</span>
                                </div>
                              </td>
                              <td className="px-6 py-2 text-right">
                                <span className="text-sm text-vercel-gray-300">{formatHours(employee.hours)}</span>
                              </td>
                              <td className="px-6 py-2 text-right">
                                <span className="text-sm text-vercel-gray-300">{formatCurrency(employee.revenue)}</span>
                              </td>
                            </tr>

                            {/* Day Rows (Tier 4) - pl-[4.5rem] (18 in tailwind would be 4.5rem) */}
                            {isEmployeeExpanded && employee.days.map((day) => {
                              const dayKey = `${employeeKey}:${day.date}`;
                              const isDayExpanded = expandedDays.has(dayKey);

                              return (
                                <Fragment key={dayKey}>
                                  <tr
                                    className="cursor-pointer hover:bg-vercel-gray-50 transition-colors"
                                    onClick={() => toggleDay(dayKey)}
                                  >
                                    <td className="pl-[4.5rem] pr-6 py-2">
                                      <div className="flex items-center gap-2">
                                        <ChevronIcon expanded={isDayExpanded} size="xs" className="text-vercel-gray-300" />
                                        <span className="text-xs text-vercel-gray-300">{day.displayDate}</span>
                                      </div>
                                    </td>
                                    <td className="px-6 py-2 text-right">
                                      <span className="text-xs text-vercel-gray-300">{formatHours(day.hours)}</span>
                                    </td>
                                    <td className="px-6 py-2 text-right">
                                      <span className="text-xs text-vercel-gray-300">{formatCurrency(day.revenue)}</span>
                                    </td>
                                  </tr>

                                  {/* Task Rows (Tier 5) - pl-[5.5rem] (22 in tailwind would be 5.5rem) - no chevron */}
                                  {isDayExpanded && day.tasks.map((task) => (
                                    <tr
                                      key={`${dayKey}:${task.taskName}`}
                                      className="hover:bg-vercel-gray-50 transition-colors"
                                    >
                                      <td className="pl-[5.5rem] pr-6 py-1.5">
                                        <span className="text-xs text-vercel-gray-400">{task.taskName}</span>
                                      </td>
                                      <td className="px-6 py-1.5 text-right">
                                        <span className="text-xs text-vercel-gray-400">{formatHours(task.hours)}</span>
                                      </td>
                                      <td className="px-6 py-1.5 text-right">
                                        <span className="text-xs text-vercel-gray-400">{formatCurrency(task.revenue)}</span>
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
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="bg-vercel-gray-50">
          <tr>
            <td className="px-6 py-4 text-sm font-semibold text-vercel-gray-600">
              Total
            </td>
            <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
              {formatHours(totalHours)}
            </td>
            <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
              {formatCurrency(totalRevenue)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default ProjectHierarchyTable;
