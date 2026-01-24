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
  calculateBilledHours,
  formatHours,
  roundHours,
  roundCurrency,
} from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import { useProjects } from '../../hooks/useProjects';
import { useCanonicalCompanyMapping } from '../../hooks/useCanonicalCompanyMapping';
import { Badge } from '../Badge';
import { ChevronIcon } from '../ChevronIcon';
import type {
  TimesheetEntry,
  RoundingIncrement,
  ProjectRateDisplayWithBilling,
  BilledHoursResult,
} from '../../types';

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
  // Billing calculation fields
  billingResult: BilledHoursResult | null;
  hasBillingLimits: boolean;
  carryoverIn: number;
  adjustedHours: number;
  billedHours: number;
  unbillableHours: number;
  billedRevenue: number;
}

interface CompanyData {
  companyName: string;
  totalMinutes: number;
  roundedMinutes: number;
  revenue: number;           // Simple revenue (rounded hours * rate)
  projects: ProjectData[];
  // Aggregate billing fields
  totalAdjustedHours: number;
  totalBilledHours: number;
  totalUnbillableHours: number;
  totalBilledRevenue: number;
}

interface RevenueTableProps {
  entries: TimesheetEntry[];
  /** Map of projectId -> rounding increment for the selected month */
  roundingByProjectId?: Map<string, RoundingIncrement>;
  /** Map of external projectId -> billing data for the selected month */
  billingDataByProjectId?: Map<string, ProjectRateDisplayWithBilling>;
}

export function RevenueTable({ entries, roundingByProjectId, billingDataByProjectId }: RevenueTableProps) {
  // Get database projects for rate lookup
  const { projects: dbProjects } = useProjects();
  const dbRateLookup = useMemo(() => buildDbRateLookupByName(dbProjects), [dbProjects]);

  // Get canonical company mapping for grouping
  const { getCanonicalCompany } = useCanonicalCompanyMapping();

  // Check if any projects have billing limits
  const hasBillingColumns = useMemo(() => {
    if (!billingDataByProjectId) return false;
    for (const data of billingDataByProjectId.values()) {
      if (data.minimumHours !== null || data.maximumHours !== null || data.carryoverHoursIn > 0) {
        return true;
      }
    }
    return false;
  }, [billingDataByProjectId]);

  // Expanded state for companies and projects
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  // Build 3-level hierarchy from entries
  const companyData = useMemo(() => {
    // First, aggregate entries by company -> project -> task
    // Also track project_id for rounding lookup
    // Use canonical company name for grouping (handles company associations)
    const companyMap = new Map<string, Map<string, { projectId: string | null; tasks: Map<string, number> }>>();

    for (const entry of entries) {
      // Get canonical company name (uses primary company name if part of a group)
      const canonicalInfo = getCanonicalCompany(entry.client_id);
      const companyName = canonicalInfo?.canonicalDisplayName || entry.client_name || 'Unassigned';
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
      let companyAdjustedHours = 0;
      let companyBilledHours = 0;
      let companyUnbillableHours = 0;
      let companyBilledRevenue = 0;

      for (const [projectName, projectInfo] of projectMap) {
        // Get billing data for this project if available (includes monthly rate)
        const billingData = projectInfo.projectId && billingDataByProjectId
          ? billingDataByProjectId.get(projectInfo.projectId)
          : null;

        // Use monthly rate from billingData if available, otherwise fall back to project table rate
        const rate = billingData?.effectiveRate ?? getEffectiveRate(projectName, dbRateLookup, {});
        const hasDbRate = billingData ? true : dbRateLookup.has(projectName);

        // Get rounding for this project - prefer billingData, then roundingByProjectId map
        let rounding: RoundingIncrement = billingData?.effectiveRounding ?? DEFAULT_ROUNDING_INCREMENT;
        if (rounding === DEFAULT_ROUNDING_INCREMENT && projectInfo.projectId && roundingByProjectId) {
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

        // Project revenue is sum of rounded task revenues (before billing limits)
        const projectRevenue = (roundedProjectMinutes / 60) * rate;

        // Calculate billing result - always apply if billingData exists with limits or carryover
        let billingResult: BilledHoursResult | null = null;
        let hasBillingLimits = false;
        let carryoverIn = 0;
        let adjustedHours = roundedProjectMinutes / 60;
        let billedHours = adjustedHours;
        let unbillableHours = 0;
        let billedRevenue = projectRevenue;

        if (billingData) {
          carryoverIn = billingData.carryoverHoursIn || 0;
          const hasMinMax = billingData.minimumHours !== null || billingData.maximumHours !== null;
          hasBillingLimits = hasMinMax || carryoverIn > 0;

          // Always calculate billing if there are limits or carryover
          if (hasBillingLimits) {
            const limits = {
              minimumHours: billingData.minimumHours,
              maximumHours: billingData.maximumHours,
              carryoverEnabled: billingData.carryoverEnabled,
              carryoverMaxHours: billingData.carryoverMaxHours,
              carryoverExpiryMonths: billingData.carryoverExpiryMonths,
            };

            billingResult = calculateBilledHours(
              roundedProjectMinutes,
              limits,
              carryoverIn,
              rate,  // Now uses the correct monthly rate
              billingData.isActive
            );

            adjustedHours = billingResult.adjustedHours;
            billedHours = billingResult.billedHours;
            unbillableHours = billingResult.unbillableHours;
            billedRevenue = billingResult.revenue;
          }
        }

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
          billingResult,
          hasBillingLimits,
          carryoverIn,
          adjustedHours,
          billedHours,
          unbillableHours,
          billedRevenue,
        });

        companyMinutes += projectMinutes;
        companyRoundedMinutes += roundedProjectMinutes;
        companyRevenue += projectRevenue;
        companyAdjustedHours += adjustedHours;
        companyBilledHours += billedHours;
        companyUnbillableHours += unbillableHours;
        companyBilledRevenue += billedRevenue;
      }

      // Sort projects by billed revenue (highest first)
      companyProjects.sort((a, b) => b.billedRevenue - a.billedRevenue);

      result.push({
        companyName,
        totalMinutes: companyMinutes,
        roundedMinutes: companyRoundedMinutes,
        revenue: companyRevenue,
        projects: companyProjects,
        totalAdjustedHours: roundHours(companyAdjustedHours),
        totalBilledHours: roundHours(companyBilledHours),
        totalUnbillableHours: roundHours(companyUnbillableHours),
        totalBilledRevenue: roundCurrency(companyBilledRevenue),
      });
    }

    // Sort companies by revenue (highest first)
    result.sort((a, b) => b.revenue - a.revenue);

    return result;
  }, [entries, dbRateLookup, roundingByProjectId, billingDataByProjectId, getCanonicalCompany]);

  // Calculate totals
  const totalActualMinutes = companyData.reduce((sum, c) => sum + c.totalMinutes, 0);
  const totalRoundedMinutes = companyData.reduce((sum, c) => sum + c.roundedMinutes, 0);
  const totalRevenue = companyData.reduce((sum, c) => sum + c.revenue, 0);
  const totalAdjustedHours = roundHours(companyData.reduce((sum, c) => sum + c.totalAdjustedHours, 0));
  const totalBilledHours = roundHours(companyData.reduce((sum, c) => sum + c.totalBilledHours, 0));
  const totalUnbillableHours = roundHours(companyData.reduce((sum, c) => sum + c.totalUnbillableHours, 0));
  const totalBilledRevenue = roundCurrency(companyData.reduce((sum, c) => sum + c.totalBilledRevenue, 0));

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
              Rounded
            </th>
            {hasBillingColumns && (
              <>
                <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Adjusted
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Billed
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Unbillable
                </th>
              </>
            )}
            <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
              Rounding
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
              Rate
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
                      <ChevronIcon expanded={isCompanyExpanded} className="text-vercel-gray-400" />
                      <span className="text-sm font-semibold text-black">{company.companyName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-vercel-gray-300">{minutesToHours(company.totalMinutes)}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-black">{minutesToHours(company.roundedMinutes)}</span>
                  </td>
                  {hasBillingColumns && (
                    <>
                      <td className="px-6 py-3 text-right">
                        <span className="text-sm text-black">{formatHours(company.totalAdjustedHours)}</span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span className="text-sm font-medium text-black">{formatHours(company.totalBilledHours)}</span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {company.totalUnbillableHours > 0 ? (
                          <span className="text-sm text-error">{formatHours(company.totalUnbillableHours)}</span>
                        ) : (
                          <span className="text-sm text-vercel-gray-300">—</span>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-vercel-gray-300">—</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-vercel-gray-300">—</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm font-medium text-black">
                      {formatCurrency(hasBillingColumns ? company.totalBilledRevenue : company.revenue)}
                    </span>
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
                            <ChevronIcon expanded={isProjectExpanded} className="text-vercel-gray-300" />
                            <span className="text-sm text-vercel-gray-200">{project.projectName}</span>
                            {/* Visual indicators for billing adjustments */}
                            {project.billingResult?.minimumApplied && (
                              <Badge variant="warning" title={`Minimum ${project.billingResult.adjustment.type === 'minimum_applied' ? project.billingResult.adjustment.minimumHours : 0}h applied`}>
                                MIN
                              </Badge>
                            )}
                            {project.billingResult?.maximumApplied && (
                              <Badge variant="error" title={`Maximum ${project.billingResult.adjustment.type === 'maximum_applied' || project.billingResult.adjustment.type === 'maximum_applied_unbillable' ? project.billingResult.adjustment.maximumHours : 0}h applied`}>
                                MAX
                              </Badge>
                            )}
                            {project.carryoverIn > 0 && (
                              <Badge variant="brand" title={`+${formatHours(project.carryoverIn)}h carryover`}>
                                +C/O
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-300">{minutesToHours(project.totalMinutes)}</span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">{minutesToHours(project.roundedMinutes)}</span>
                        </td>
                        {hasBillingColumns && (
                          <>
                            <td className="px-6 py-3 text-right">
                              <span className={`text-sm ${project.adjustedHours !== project.roundedMinutes / 60 ? 'text-bteam-brand' : 'text-vercel-gray-200'}`}>
                                {formatHours(project.adjustedHours)}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-right">
                              <span className={`text-sm ${project.billingResult?.minimumApplied || project.billingResult?.maximumApplied ? 'text-bteam-brand font-medium' : 'text-vercel-gray-200'}`}>
                                {formatHours(project.billedHours)}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-right">
                              {project.unbillableHours > 0 ? (
                                <span className="text-sm text-error">{formatHours(project.unbillableHours)}</span>
                              ) : (
                                <span className="text-sm text-vercel-gray-300">—</span>
                              )}
                            </td>
                          </>
                        )}
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
                          <span className="text-sm text-vercel-gray-200">
                            {formatCurrency(hasBillingColumns ? project.billedRevenue : project.revenue)}
                          </span>
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
                          {hasBillingColumns && (
                            <>
                              <td className="px-6 py-2 text-right">
                                <span className="text-sm text-vercel-gray-300">—</span>
                              </td>
                              <td className="px-6 py-2 text-right">
                                <span className="text-sm text-vercel-gray-300">—</span>
                              </td>
                              <td className="px-6 py-2 text-right">
                                <span className="text-sm text-vercel-gray-300">—</span>
                              </td>
                            </>
                          )}
                          <td className="px-6 py-2 text-right">
                            <span className={`text-sm ${project.rounding !== DEFAULT_ROUNDING_INCREMENT ? 'text-bteam-brand' : 'text-vercel-gray-300'}`}>
                              {project.rounding === 0 ? '—' : `${project.rounding}m`}
                            </span>
                          </td>
                          <td className="px-6 py-2 text-right">
                            <span className="text-sm text-vercel-gray-300">
                              ${project.rate.toFixed(2)}
                            </span>
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
            {hasBillingColumns && (
              <>
                <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                  {formatHours(totalAdjustedHours)}
                </td>
                <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                  {formatHours(totalBilledHours)}
                </td>
                <td className="px-6 py-4 text-right text-sm">
                  {totalUnbillableHours > 0 ? (
                    <span className="font-semibold text-error">{formatHours(totalUnbillableHours)}</span>
                  ) : (
                    <span className="text-vercel-gray-400">—</span>
                  )}
                </td>
              </>
            )}
            <td className="px-6 py-4 text-right">
              {/* Empty rounding column */}
            </td>
            <td className="px-6 py-4 text-right">
              {/* Empty rate column */}
            </td>
            <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
              {formatCurrency(hasBillingColumns ? totalBilledRevenue : totalRevenue)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default RevenueTable;
