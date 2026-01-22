/**
 * RevenueTable - Official Design System Atom
 *
 * A revenue-focused table component that displays billing data with 3-level hierarchy:
 * Company => Project => Task
 *
 * @official 2026-01-22
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (header/footer)
 * - Border: vercel-gray-100
 * - Text: black (company), vercel-gray-200 (project/task)
 * - Radius: rounded-lg
 */

import { useState, useMemo, Fragment } from 'react';
import {
  formatCurrency,
  getEffectiveRate,
  buildDbRateLookupByName,
} from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import { useProjects } from '../../hooks/useProjects';
import type { TimesheetEntry } from '../../types';

interface TaskData {
  taskName: string;
  totalMinutes: number;
  revenue: number;
}

interface ProjectData {
  projectName: string;
  totalMinutes: number;
  revenue: number;
  rate: number;
  hasDbRate: boolean;
  tasks: TaskData[];
}

interface CompanyData {
  companyName: string;
  totalMinutes: number;
  revenue: number;
  projects: ProjectData[];
}

interface RevenueTableProps {
  entries: TimesheetEntry[];
}

export function RevenueTable({ entries }: RevenueTableProps) {
  // Get database projects for rate lookup
  const { projects: dbProjects } = useProjects();
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Expanded state for companies and projects
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  // Build 3-level hierarchy from entries
  const companyData = useMemo(() => {
    // First, aggregate entries by company -> project -> task
    const companyMap = new Map<string, Map<string, Map<string, number>>>();

    for (const entry of entries) {
      const companyName = entry.client_name || 'Unassigned';
      const projectName = entry.project_name;
      const taskName = entry.task_name || 'No Task';

      if (!companyMap.has(companyName)) {
        companyMap.set(companyName, new Map());
      }
      const projectMap = companyMap.get(companyName)!;

      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, new Map());
      }
      const taskMap = projectMap.get(projectName)!;

      taskMap.set(taskName, (taskMap.get(taskName) || 0) + entry.total_minutes);
    }

    // Convert to structured data with revenue calculations
    const result: CompanyData[] = [];

    for (const [companyName, projectMap] of companyMap) {
      const companyProjects: ProjectData[] = [];
      let companyMinutes = 0;
      let companyRevenue = 0;

      for (const [projectName, taskMap] of projectMap) {
        const rate = getEffectiveRate(projectName, dbRateLookup, {});
        const hasDbRate = dbRateLookup.has(projectName);
        const tasks: TaskData[] = [];
        let projectMinutes = 0;

        for (const [taskName, minutes] of taskMap) {
          const taskRevenue = (minutes / 60) * rate;
          tasks.push({
            taskName,
            totalMinutes: minutes,
            revenue: taskRevenue,
          });
          projectMinutes += minutes;
        }

        // Sort tasks by revenue (highest first)
        tasks.sort((a, b) => b.revenue - a.revenue);

        const projectRevenue = (projectMinutes / 60) * rate;
        companyProjects.push({
          projectName,
          totalMinutes: projectMinutes,
          revenue: projectRevenue,
          rate,
          hasDbRate,
          tasks,
        });

        companyMinutes += projectMinutes;
        companyRevenue += projectRevenue;
      }

      // Sort projects by revenue (highest first)
      companyProjects.sort((a, b) => b.revenue - a.revenue);

      result.push({
        companyName,
        totalMinutes: companyMinutes,
        revenue: companyRevenue,
        projects: companyProjects,
      });
    }

    // Sort companies by revenue (highest first)
    result.sort((a, b) => b.revenue - a.revenue);

    return result;
  }, [entries, dbRateLookup]);

  // Calculate totals
  const totalMinutes = companyData.reduce((sum, c) => sum + c.totalMinutes, 0);
  const totalRevenue = companyData.reduce((sum, c) => sum + c.revenue, 0);

  const toggleCompany = (companyName: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(companyName)) {
        next.delete(companyName);
      } else {
        next.add(companyName);
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
              Rate ($/hr)
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
              Revenue
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-vercel-gray-100">
          {companyData.map((company) => {
            const isCompanyExpanded = expandedCompanies.has(company.companyName);

            return (
              <Fragment key={company.companyName}>
                {/* Company Row (Level 1) */}
                <tr
                  className="bg-vercel-gray-50 cursor-pointer hover:bg-vercel-gray-100 transition-colors"
                  onClick={() => toggleCompany(company.companyName)}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <svg
                        className={`w-3 h-3 text-vercel-gray-400 transition-transform ${isCompanyExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="text-sm font-semibold text-black">{company.companyName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-black">{minutesToHours(company.totalMinutes)}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-vercel-gray-300">—</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm font-medium text-black">{formatCurrency(company.revenue)}</span>
                  </td>
                </tr>

                {/* Project Rows (Level 2) */}
                {isCompanyExpanded && company.projects.map((project) => {
                  const projectKey = `${company.companyName}:${project.projectName}`;
                  const isProjectExpanded = expandedProjects.has(projectKey);

                  return (
                    <Fragment key={projectKey}>
                      <tr
                        className="cursor-pointer hover:bg-vercel-gray-50 transition-colors"
                        onClick={() => toggleProject(projectKey)}
                      >
                        <td className="pl-10 pr-6 py-3">
                          <div className="flex items-center gap-2">
                            <svg
                              className={`w-3 h-3 text-vercel-gray-300 transition-transform ${isProjectExpanded ? 'rotate-90' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="text-sm text-vercel-gray-200">{project.projectName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">{minutesToHours(project.totalMinutes)}</span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">
                            ${project.rate.toFixed(2)}
                            {!project.hasDbRate && <span className="text-2xs ml-1">(default)</span>}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">{formatCurrency(project.revenue)}</span>
                        </td>
                      </tr>

                      {/* Task Rows (Level 3) */}
                      {isProjectExpanded && project.tasks.map((task) => (
                        <tr key={`${projectKey}:${task.taskName}`} className="hover:bg-vercel-gray-50 transition-colors">
                          <td className="pl-16 pr-6 py-2">
                            <span className="text-sm text-vercel-gray-300">{task.taskName}</span>
                          </td>
                          <td className="px-6 py-2 text-right">
                            <span className="text-sm text-vercel-gray-300">{minutesToHours(task.totalMinutes)}</span>
                          </td>
                          <td className="px-6 py-2 text-right">
                            <span className="text-sm text-vercel-gray-300">—</span>
                          </td>
                          <td className="px-6 py-2 text-right">
                            <span className="text-sm text-vercel-gray-300">{formatCurrency(task.revenue)}</span>
                          </td>
                        </tr>
                      ))}
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
              {minutesToHours(totalMinutes)}
            </td>
            <td className="px-6 py-4 text-right">
              {/* Empty rate column */}
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

export default RevenueTable;
