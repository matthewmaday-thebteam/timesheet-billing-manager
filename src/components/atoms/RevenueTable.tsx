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

import { useState, useMemo, useEffect, Fragment } from 'react';
import {
  formatCurrency,
  getEffectiveRate,
  buildDbRateLookupByName,
  applyRounding,
  DEFAULT_ROUNDING_INCREMENT,
} from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import { useProjects } from '../../hooks/useProjects';
import type { TimesheetEntry, RoundingIncrement } from '../../types';

interface TaskData {
  taskName: string;
  totalMinutes: number;      // Actual minutes
  roundedMinutes: number;    // Minutes after rounding
  revenue: number;           // Revenue based on rounded minutes
}

interface ProjectData {
  projectId: string | null;
  projectName: string;
  totalMinutes: number;
  roundedMinutes: number;
  revenue: number;
  rate: number;
  rounding: RoundingIncrement;
  hasDbRate: boolean;
  tasks: TaskData[];
}

interface CompanyData {
  companyName: string;
  totalMinutes: number;
  roundedMinutes: number;
  revenue: number;
  projects: ProjectData[];
}

interface RevenueTableProps {
  entries: TimesheetEntry[];
  /** Map of projectId -> rounding increment for the selected month */
  roundingByProjectId?: Map<string, RoundingIncrement>;
}

export function RevenueTable({ entries, roundingByProjectId }: RevenueTableProps) {
  // Get database projects for rate lookup
  const { projects: dbProjects } = useProjects();
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Expanded state for companies and projects
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  // Build 3-level hierarchy from entries
  const companyData = useMemo(() => {
    // First, aggregate entries by company -> project -> task
    // Also track project_id for rounding lookup
    const companyMap = new Map<string, Map<string, { projectId: string | null; tasks: Map<string, number> }>>();

    for (const entry of entries) {
      const companyName = entry.client_name || 'Unassigned';
      const projectName = entry.project_name;
      const projectId = entry.project_id;
      const taskName = entry.task_name || 'No Task';

      if (!companyMap.has(companyName)) {
        companyMap.set(companyName, new Map());
      }
      const projectMap = companyMap.get(companyName)!;

      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, { projectId, tasks: new Map() });
      }
      const projectData = projectMap.get(projectName)!;

      projectData.tasks.set(taskName, (projectData.tasks.get(taskName) || 0) + entry.total_minutes);
    }

    // Convert to structured data with revenue calculations
    const result: CompanyData[] = [];

    for (const [companyName, projectMap] of companyMap) {
      const companyProjects: ProjectData[] = [];
      let companyMinutes = 0;
      let companyRoundedMinutes = 0;
      let companyRevenue = 0;

      for (const [projectName, projectInfo] of projectMap) {
        const rate = getEffectiveRate(projectName, dbRateLookup, {});
        const hasDbRate = dbRateLookup.has(projectName);

        // Get rounding for this project (use project_id to look up)
        // The map key is the external project ID (Clockify/ClickUp ID) which matches entry.project_id
        let rounding: RoundingIncrement = DEFAULT_ROUNDING_INCREMENT;
        if (projectInfo.projectId && roundingByProjectId) {
          const lookupValue = roundingByProjectId.get(projectInfo.projectId);
          // Ensure we got a valid rounding value (could be 0 for "Actual")
          if (lookupValue !== undefined && [0, 5, 15, 30].includes(lookupValue)) {
            rounding = lookupValue as RoundingIncrement;
          }
        }

        const tasks: TaskData[] = [];
        let projectMinutes = 0;
        let roundedProjectMinutes = 0;

        for (const [taskName, minutes] of projectInfo.tasks) {
          // Apply rounding to each task individually
          const roundedTaskMinutes = applyRounding(minutes, rounding);
          const taskRevenue = (roundedTaskMinutes / 60) * rate;
          tasks.push({
            taskName,
            totalMinutes: minutes,
            roundedMinutes: roundedTaskMinutes,
            revenue: taskRevenue,
          });
          projectMinutes += minutes;
          roundedProjectMinutes += roundedTaskMinutes;
        }

        // Sort tasks by revenue (highest first)
        tasks.sort((a, b) => b.revenue - a.revenue);

        // Project revenue is sum of rounded task revenues
        const projectRevenue = (roundedProjectMinutes / 60) * rate;

        companyProjects.push({
          projectId: projectInfo.projectId,
          projectName,
          totalMinutes: projectMinutes,
          roundedMinutes: roundedProjectMinutes,
          revenue: projectRevenue,
          rate,
          rounding,
          hasDbRate,
          tasks,
        });

        companyMinutes += projectMinutes;
        companyRoundedMinutes += roundedProjectMinutes;
        companyRevenue += projectRevenue;
      }

      // Sort projects by revenue (highest first)
      companyProjects.sort((a, b) => b.revenue - a.revenue);

      result.push({
        companyName,
        totalMinutes: companyMinutes,
        roundedMinutes: companyRoundedMinutes,
        revenue: companyRevenue,
        projects: companyProjects,
      });
    }

    // Sort companies by revenue (highest first)
    result.sort((a, b) => b.revenue - a.revenue);

    return result;
  }, [entries, dbRateLookup, roundingByProjectId]);

  // Calculate totals
  const totalActualMinutes = companyData.reduce((sum, c) => sum + c.totalMinutes, 0);
  const totalRoundedMinutes = companyData.reduce((sum, c) => sum + c.roundedMinutes, 0);
  const totalRevenue = companyData.reduce((sum, c) => sum + c.revenue, 0);

  // Default all companies to expanded (show projects - Tier 2)
  useEffect(() => {
    if (companyData.length > 0) {
      setExpandedCompanies(new Set(companyData.map(c => c.companyName)));
    }
  }, [companyData]);

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
              Actual
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
              Hours
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
              Rounding
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
                    <span className="text-sm text-vercel-gray-300">{minutesToHours(company.totalMinutes)}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-black">{minutesToHours(company.roundedMinutes)}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-vercel-gray-300">—</span>
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
                          <span className="text-sm text-vercel-gray-300">{minutesToHours(project.totalMinutes)}</span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">{minutesToHours(project.roundedMinutes)}</span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className={`text-sm ${project.rounding !== DEFAULT_ROUNDING_INCREMENT ? 'text-bteam-brand' : 'text-vercel-gray-200'}`}>
                            {project.rounding === 0 ? '—' : `${project.rounding}m`}
                          </span>
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
                            <span className="text-sm text-vercel-gray-300">{minutesToHours(task.roundedMinutes)}</span>
                          </td>
                          <td className="px-6 py-2 text-right">
                            <span className="text-sm text-vercel-gray-300">—</span>
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
            <td className="px-6 py-4 text-right text-sm text-vercel-gray-400">
              {minutesToHours(totalActualMinutes)}
            </td>
            <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
              {minutesToHours(totalRoundedMinutes)}
            </td>
            <td className="px-6 py-4 text-right">
              {/* Empty increment column */}
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
