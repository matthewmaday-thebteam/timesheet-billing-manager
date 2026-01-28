/**
 * RevenueTable - Official Design System Atom
 *
 * A revenue-focused table component that displays billing data with 3-level hierarchy:
 * Company => Project => Task
 *
 * Uses the unified billing result from useUnifiedBilling for consistent calculations.
 *
 * @official 2026-01-24
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (header/footer)
 * - Border: vercel-gray-100
 * - Text: black (company), vercel-gray-200 (project/task)
 * - Radius: rounded-lg
 */

import { useState, useMemo, useEffect, Fragment } from 'react';
import { formatCurrency, formatHours } from '../../utils/billing';
import { minutesToHours } from '../../utils/calculations';
import { Badge } from '../Badge';
import { ChevronIcon } from '../ChevronIcon';
import type { MonthlyBillingResult } from '../../utils/billingCalculations';
import type { CompanyBillingsGroup } from '../../types';
import { TRANSACTION_TYPE_LABELS } from '../../types';
import { DEFAULT_ROUNDING_INCREMENT } from '../../utils/billing';
import { formatCentsToDisplay } from '../../hooks/useBillings';

interface RevenueTableProps {
  /** Unified billing result from useUnifiedBilling */
  billingResult: MonthlyBillingResult;
  /** Optional billings data grouped by company */
  companyBillings?: CompanyBillingsGroup[];
  /** Total billing cents (for footer) */
  totalBillingCents?: number;
  /** Milestone data by external project ID - used to display milestone amount in project row */
  milestoneByExternalProjectId?: Map<string, { totalCents: number; billingId: string }>;
}

export function RevenueTable({ billingResult, companyBillings = [], totalBillingCents = 0, milestoneByExternalProjectId }: RevenueTableProps) {
  // Check if any projects have billing limits
  const hasBillingColumns = useMemo(() => {
    for (const company of billingResult.companies) {
      for (const project of company.projects) {
        if (project.hasBillingLimits) {
          return true;
        }
      }
    }
    return false;
  }, [billingResult]);

  // Build billings lookup by company client_id (used for matching in Revenue table)
  const billingsByClientId = useMemo(() => {
    const map = new Map<string, CompanyBillingsGroup>();
    for (const cb of companyBillings) {
      map.set(cb.companyClientId, cb);
    }
    return map;
  }, [companyBillings]);

  // Calculate milestone adjustments per company (milestone replaces timesheet revenue)
  // Returns: Map<companyId, adjustmentAmount> where adjustment = sum of (milestone - timesheetRevenue) for each project
  const milestoneAdjustmentByCompany = useMemo(() => {
    const map = new Map<string, number>();
    if (!milestoneByExternalProjectId || milestoneByExternalProjectId.size === 0) return map;

    for (const company of billingResult.companies) {
      let adjustment = 0;
      for (const project of company.projects) {
        if (project.projectId) {
          const milestone = milestoneByExternalProjectId.get(project.projectId);
          if (milestone) {
            // Replace timesheet revenue with milestone: add milestone, subtract timesheet
            adjustment += (milestone.totalCents / 100) - project.billedRevenue;
          }
        }
      }
      if (adjustment !== 0) {
        map.set(company.companyId, adjustment);
      }
    }
    return map;
  }, [billingResult.companies, milestoneByExternalProjectId]);

  // Calculate total milestone adjustment for footer
  const totalMilestoneAdjustment = useMemo(() => {
    let total = 0;
    for (const adjustment of milestoneAdjustmentByCompany.values()) {
      total += adjustment;
    }
    return total;
  }, [milestoneAdjustmentByCompany]);

  // Expanded state for companies and projects (keyed by ID)
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  // Sort companies alphabetically by name
  // Billings are matched to companies by ID - if IDs don't match, it's a data integrity issue
  const sortedCompanies = useMemo(() => {
    return [...billingResult.companies].sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [billingResult.companies]);

  // Default all companies to expanded (show projects - Tier 2)
  useEffect(() => {
    if (sortedCompanies.length > 0) {
      setExpandedCompanies(new Set(sortedCompanies.map(c => c.companyId)));
    }
  }, [sortedCompanies]);

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
          {sortedCompanies.map((company) => {
            const isCompanyExpanded = expandedCompanies.has(company.companyId);

            // Sort projects alphabetically by name
            const sortedProjects = [...company.projects].sort((a, b) => a.projectName.localeCompare(b.projectName));

            // Get billing revenue for this company
            const companyBillingData = billingsByClientId.get(company.companyId);
            const companyBillingCents = companyBillingData?.totalCents || 0;
            // Apply milestone adjustment: replaces timesheet revenue with milestone amount
            const milestoneAdj = milestoneAdjustmentByCompany.get(company.companyId) || 0;
            const companyTotalRevenue = company.billedRevenue + (companyBillingCents / 100) + milestoneAdj;

            return (
              <Fragment key={company.companyId}>
                {/* Company Row (Level 1) */}
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
                    <span className="text-sm text-vercel-gray-300">{minutesToHours(company.actualMinutes)}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-sm text-black">{minutesToHours(company.roundedMinutes)}</span>
                  </td>
                  {hasBillingColumns && (
                    <>
                      <td className="px-6 py-3 text-right">
                        <span className="text-sm text-black">{formatHours(company.adjustedHours)}</span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span className="text-sm font-medium text-black">{formatHours(company.billedHours)}</span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {company.unbillableHours > 0 ? (
                          <span className="text-sm text-error">{formatHours(company.unbillableHours)}</span>
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
                      {formatCurrency(companyTotalRevenue)}
                    </span>
                  </td>
                </tr>

                {/* Project Rows (Level 2) */}
                {isCompanyExpanded && sortedProjects.map((project) => {
                  const projectKey = `${company.companyId}:${project.projectId}`;
                  const isProjectExpanded = expandedProjects.has(projectKey);

                  // Sort tasks alphabetically by name
                  const sortedTasks = [...project.tasks].sort((a, b) => a.taskName.localeCompare(b.taskName));

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
                            {project.minimumApplied && (
                              <Badge variant="warning" title={`Minimum ${project.billingResult?.adjustment.type === 'minimum_applied' ? project.billingResult.adjustment.minimumHours : 0}h applied`}>
                                MIN
                              </Badge>
                            )}
                            {project.maximumApplied && (
                              <Badge variant="error" title={`Maximum applied`}>
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
                          <span className="text-sm text-vercel-gray-300">{minutesToHours(project.actualMinutes)}</span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-200">{minutesToHours(project.roundedMinutes)}</span>
                        </td>
                        {hasBillingColumns && (
                          <>
                            <td className="px-6 py-3 text-right">
                              <span className={`text-sm ${project.adjustedHours !== project.roundedHours ? 'text-bteam-brand' : 'text-vercel-gray-200'}`}>
                                {formatHours(project.adjustedHours)}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-right">
                              <span className={`text-sm ${project.minimumApplied || project.maximumApplied ? 'text-bteam-brand font-medium' : 'text-vercel-gray-200'}`}>
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
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          {(() => {
                            const milestone = project.projectId ? milestoneByExternalProjectId?.get(project.projectId) : undefined;
                            if (milestone) {
                              return (
                                <span className="text-sm text-bteam-brand">
                                  Revenue Milestone {formatCentsToDisplay(milestone.totalCents)}
                                </span>
                              );
                            }
                            return (
                              <span className="text-sm text-vercel-gray-200">
                                {formatCurrency(project.billedRevenue)}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>

                      {/* Task Rows (Level 3) */}
                      {isProjectExpanded && sortedTasks.map((task) => (
                        <tr key={`${projectKey}:${task.taskName}`} className="hover:bg-vercel-gray-50 transition-colors">
                          <td className="pl-16 pr-6 py-2">
                            <span className="text-sm text-vercel-gray-300">{task.taskName}</span>
                          </td>
                          <td className="px-6 py-2 text-right">
                            <span className="text-sm text-vercel-gray-300">{minutesToHours(task.actualMinutes)}</span>
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
                            <span className="text-sm text-vercel-gray-300">{formatCurrency(task.baseRevenue)}</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}

                {/* Billing Rows (Level 2) - appear after projects */}
                {isCompanyExpanded && billingsByClientId.has(company.companyId) && (() => {
                  const companyBillingsData = billingsByClientId.get(company.companyId)!;
                  return companyBillingsData.billings.map((billing) => {
                    const billingKey = `billing:${billing.id}`;
                    const isBillingExpanded = expandedProjects.has(billingKey);

                    return (
                      <Fragment key={billing.id}>
                        {/* Billing Row (like a project) */}
                        <tr
                          className="cursor-pointer hover:bg-vercel-gray-50 transition-colors"
                          onClick={() => toggleProject(billingKey)}
                        >
                          <td className="pl-10 pr-6 py-3">
                            <div className="flex items-center gap-2">
                              <ChevronIcon expanded={isBillingExpanded} className="text-vercel-gray-300" />
                              <span className="text-sm text-vercel-gray-200">{billing.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-300">—</span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-300">—</span>
                          </td>
                          {hasBillingColumns && (
                            <>
                              <td className="px-6 py-3 text-right">
                                <span className="text-sm text-vercel-gray-300">—</span>
                              </td>
                              <td className="px-6 py-3 text-right">
                                <span className="text-sm text-vercel-gray-300">—</span>
                              </td>
                              <td className="px-6 py-3 text-right">
                                <span className="text-sm text-vercel-gray-300">—</span>
                              </td>
                            </>
                          )}
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-300">—</span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-200">
                              {TRANSACTION_TYPE_LABELS[billing.type]}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <span className="text-sm text-vercel-gray-200">
                              {formatCentsToDisplay(billing.totalCents)}
                            </span>
                          </td>
                        </tr>

                        {/* Transaction Rows (like tasks) */}
                        {isBillingExpanded && billing.transactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-vercel-gray-50 transition-colors">
                            <td className="pl-16 pr-6 py-2">
                              <span className="text-sm text-vercel-gray-300">{tx.description}</span>
                            </td>
                            <td className="px-6 py-2 text-right">
                              <span className="text-sm text-vercel-gray-300">—</span>
                            </td>
                            <td className="px-6 py-2 text-right">
                              <span className="text-sm text-vercel-gray-300">—</span>
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
                              <span className="text-sm text-vercel-gray-300">—</span>
                            </td>
                            <td className="px-6 py-2 text-right">
                              <span className="text-sm text-vercel-gray-300">—</span>
                            </td>
                            <td className="px-6 py-2 text-right">
                              <span className="text-sm text-vercel-gray-300">
                                {formatCentsToDisplay(tx.amountCents)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  });
                })()}
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
              {minutesToHours(billingResult.actualMinutes)}
            </td>
            <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
              {minutesToHours(billingResult.roundedMinutes)}
            </td>
            {hasBillingColumns && (
              <>
                <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                  {formatHours(billingResult.adjustedHours)}
                </td>
                <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                  {formatHours(billingResult.billedHours)}
                </td>
                <td className="px-6 py-4 text-right text-sm">
                  {billingResult.unbillableHours > 0 ? (
                    <span className="font-semibold text-error">{formatHours(billingResult.unbillableHours)}</span>
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
              {formatCurrency(billingResult.billedRevenue + (totalBillingCents / 100) + totalMilestoneAdjustment)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default RevenueTable;
