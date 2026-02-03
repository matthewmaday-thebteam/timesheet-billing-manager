/**
 * Revenue CSV Export Utility
 *
 * Generates a CSV string from pre-computed billing data (MonthlyBillingResult),
 * fixed billings (CompanyBillingsGroup[]), and milestone overrides.
 *
 * Column layout: Company | Project | Task | hours... | Task Revenue | Project Revenue | Company Revenue
 * Mirrors the old export structure with added company/project summary rows,
 * fixed billing rows, and a TOTAL row.
 */

import type { MonthlyBillingResult, CompanyBillingResult } from './billingCalculations';
import type { CompanyBillingsGroup } from '../types';
import { TRANSACTION_TYPE_LABELS } from '../types';
import { formatCurrency, formatHours } from './billing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RevenueCSVOptions {
  billingResult: MonthlyBillingResult;
  filteredCompanyBillings: CompanyBillingsGroup[];
  milestoneByExternalProjectId: Map<string, { totalCents: number; billingId: string }>;
  monthLabel: string; // e.g. "January 2026"
  companyIds?: Set<string>; // if provided, only include these companies
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a cell value for CSV (wrap in double-quotes, escape inner quotes). */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

/** Format cents as display currency string like "$1,234.56" */
function formatCentsDisplay(cents: number): string {
  return formatCurrency(cents / 100);
}

// ---------------------------------------------------------------------------
// Milestone adjustment helpers (mirrors RevenueTable logic)
// ---------------------------------------------------------------------------

function buildMilestoneAdjustmentByCompany(
  companies: CompanyBillingResult[],
  milestoneByExternalProjectId: Map<string, { totalCents: number; billingId: string }>,
): Map<string, number> {
  const map = new Map<string, number>();
  if (milestoneByExternalProjectId.size === 0) return map;

  for (const company of companies) {
    let adjustment = 0;
    for (const project of company.projects) {
      if (project.projectId) {
        const milestone = milestoneByExternalProjectId.get(project.projectId);
        if (milestone) {
          adjustment += (milestone.totalCents / 100) - project.billedRevenue;
        }
      }
    }
    if (adjustment !== 0) {
      map.set(company.companyId, adjustment);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// CSV generation (pure function)
// ---------------------------------------------------------------------------

export function generateRevenueCSV(options: RevenueCSVOptions): string {
  const { billingResult, filteredCompanyBillings, milestoneByExternalProjectId, monthLabel, companyIds } = options;

  // Apply optional company filter
  const companies = companyIds
    ? billingResult.companies.filter(c => companyIds.has(c.companyId))
    : billingResult.companies;
  const companyBillings = companyIds
    ? filteredCompanyBillings.filter(cb => companyIds.has(cb.companyClientId))
    : filteredCompanyBillings;

  // Determine extended vs standard layout
  const hasBillingLimits = companies.some(c =>
    c.projects.some(p => p.hasBillingLimits),
  );

  // Build billings lookup by companyId (matching RevenueTable's billingsByClientId)
  const billingsByCompanyId = new Map<string, CompanyBillingsGroup>();
  for (const cb of companyBillings) {
    billingsByCompanyId.set(cb.companyClientId, cb);
  }

  // Build per-company milestone adjustments
  const milestoneAdjustmentByCompany = buildMilestoneAdjustmentByCompany(
    companies,
    milestoneByExternalProjectId,
  );

  // Total milestone adjustment (for grand total)
  let totalMilestoneAdjustment = 0;
  for (const adj of milestoneAdjustmentByCompany.values()) {
    totalMilestoneAdjustment += adj;
  }

  // Total filtered billing cents (for grand total)
  let totalFilteredBillingCents = 0;
  for (const cb of companyBillings) {
    totalFilteredBillingCents += cb.totalCents;
  }

  // Column counts: Extended = 14, Standard = 10
  const colCount = hasBillingLimits ? 14 : 10;

  const rows: string[] = [];

  // --- Title row ---
  rows.push(csvRow([`Revenue for the month of ${monthLabel}`]));

  // --- Header row ---
  const header = hasBillingLimits
    ? ['Company', 'Project', 'Task', 'Actual', 'Rounded', 'Carryover', 'Adjusted', 'Billed', 'Unbillable', 'Rounding', 'Rate ($/hr)', 'Task Revenue', 'Project Revenue', 'Company Revenue']
    : ['Company', 'Project', 'Task', 'Actual', 'Hours', 'Rounding', 'Rate ($/hr)', 'Task Revenue', 'Project Revenue', 'Company Revenue'];
  rows.push(csvRow(header));

  // Sort companies alphabetically (matching RevenueTable)
  const sortedCompanies = [...companies].sort((a, b) =>
    a.companyName.localeCompare(b.companyName),
  );

  // Helper: build an empty row of the right column count
  const emptyRow = () => Array(colCount).fill('') as string[];

  // --- Company / Project / Task rows ---
  for (let ci = 0; ci < sortedCompanies.length; ci++) {
    const company = sortedCompanies[ci];

    // Separator between companies (empty row)
    if (ci > 0) {
      rows.push(csvRow(emptyRow()));
    }

    // Company billing data
    const companyBillingData = billingsByCompanyId.get(company.companyId);
    const companyBillingCents = companyBillingData?.totalCents || 0;
    const milestoneAdj = milestoneAdjustmentByCompany.get(company.companyId) || 0;
    const companyTotalRevenue = company.billedRevenue + (companyBillingCents / 100) + milestoneAdj;

    // --- Company summary row ---
    // Show all hour columns: Actual, Rounded, Carryover, Adjusted, Billed
    const companyCarryoverIn = company.projects.reduce((sum, p) => sum + p.carryoverIn, 0);
    const companyRow = emptyRow();
    companyRow[0] = company.companyName;
    if (hasBillingLimits) {
      companyRow[3] = formatHours(company.actualHours); // Actual
      companyRow[4] = formatHours(company.roundedHours); // Rounded
      if (companyCarryoverIn > 0) {
        companyRow[5] = formatHours(companyCarryoverIn); // Carryover
      }
      companyRow[6] = formatHours(company.adjustedHours); // Adjusted
      companyRow[7] = formatHours(company.billedHours); // Billed
    } else {
      companyRow[3] = formatHours(company.actualHours); // Actual
      companyRow[4] = formatHours(company.billedHours); // Hours column
    }
    companyRow[colCount - 1] = formatCurrency(companyTotalRevenue);
    rows.push(csvRow(companyRow));

    // Sort projects alphabetically (matching RevenueTable)
    const sortedProjects = [...company.projects].sort((a, b) =>
      a.projectName.localeCompare(b.projectName),
    );

    // --- Project rows ---
    for (const project of sortedProjects) {
      // Check milestone for revenue display
      const milestone = project.projectId
        ? milestoneByExternalProjectId.get(project.projectId)
        : undefined;
      const projectRevenueStr = milestone
        ? formatCentsDisplay(milestone.totalCents)
        : formatCurrency(project.billedRevenue);

      // Project summary row: Show all hour columns: Actual, Rounded, Carryover, Adjusted, Billed
      const projectRow = emptyRow();
      projectRow[0] = company.companyName;
      projectRow[1] = project.projectName;
      if (hasBillingLimits) {
        projectRow[3] = formatHours(project.actualHours); // Actual
        projectRow[4] = formatHours(project.roundedHours); // Rounded
        if (project.carryoverIn > 0) {
          projectRow[5] = formatHours(project.carryoverIn); // Carryover (hours from previous months)
        }
        projectRow[6] = formatHours(project.adjustedHours); // Adjusted
        projectRow[7] = formatHours(project.billedHours); // Billed
      } else {
        // Standard layout: show actual and billed hours
        projectRow[3] = formatHours(project.actualHours); // Actual
        projectRow[4] = formatHours(project.billedHours); // Hours column
      }
      projectRow[colCount - 2] = projectRevenueStr; // Project Revenue column
      rows.push(csvRow(projectRow));

      // Task rows (sorted by hours descending, matching old export)
      const sortedTasks = [...project.tasks].sort((a, b) =>
        b.actualMinutes - a.actualMinutes,
      );

      const roundingLabel = project.rounding === 0 ? '\u2014' : `${project.rounding}m`;

      for (const task of sortedTasks) {
        if (hasBillingLimits) {
          rows.push(csvRow([
            company.companyName,
            project.projectName,
            task.taskName,
            task.actualHours.toFixed(2),
            task.roundedHours.toFixed(2),
            '', // Carryover In (shown on project row)
            '', // Adjusted (shown on project row)
            '', // Billed (shown on project row)
            '', // Unbillable (shown on project row)
            roundingLabel,
            project.rate.toFixed(2),
            formatCurrency(task.baseRevenue),
            '', // Project Revenue (shown on project summary row)
            '', // Company Revenue (shown on company summary row)
          ]));
        } else {
          rows.push(csvRow([
            company.companyName,
            project.projectName,
            task.taskName,
            task.actualHours.toFixed(2),
            task.roundedHours.toFixed(2),
            roundingLabel,
            project.rate.toFixed(2),
            formatCurrency(task.baseRevenue),
            '', // Project Revenue
            '', // Company Revenue
          ]));
        }
      }
    }

    // --- Fixed Billing rows (after projects, matching RevenueTable) ---
    if (companyBillingData) {
      for (const billing of companyBillingData.billings) {
        const typeLabel = TRANSACTION_TYPE_LABELS[billing.type];

        // Billing summary row (project-level): billing name in Project col, revenue in Project Revenue col
        const billingRow = emptyRow();
        billingRow[0] = company.companyName;
        billingRow[1] = billing.name;
        // Rate column = type label
        billingRow[hasBillingLimits ? 10 : 6] = typeLabel;
        // Project Revenue column
        billingRow[colCount - 2] = formatCentsDisplay(billing.totalCents);
        rows.push(csvRow(billingRow));

        // Transaction rows (task-level)
        for (const tx of billing.transactions) {
          const txRow = emptyRow();
          txRow[0] = company.companyName;
          txRow[1] = billing.name;
          txRow[2] = tx.description;
          // Task Revenue column
          txRow[colCount - 3] = formatCentsDisplay(tx.amountCents);
          rows.push(csvRow(txRow));
        }
      }
    }
  }

  // --- TOTAL row ---
  // When filtering by company, recompute aggregated hours from the filtered set
  const totalActualHours = companyIds
    ? companies.reduce((sum, c) => sum + c.actualHours, 0)
    : billingResult.actualHours;
  const totalRoundedHours = companyIds
    ? companies.reduce((sum, c) => sum + c.roundedHours, 0)
    : billingResult.roundedHours;
  const totalAdjustedHours = companyIds
    ? companies.reduce((sum, c) => sum + c.adjustedHours, 0)
    : billingResult.adjustedHours;
  const totalBilledHours = companyIds
    ? companies.reduce((sum, c) => sum + c.billedHours, 0)
    : billingResult.billedHours;
  const totalUnbillableHours = companyIds
    ? companies.reduce((sum, c) => sum + c.unbillableHours, 0)
    : billingResult.unbillableHours;
  const totalBilledRevenue = companyIds
    ? companies.reduce((sum, c) => sum + c.billedRevenue, 0)
    : billingResult.billedRevenue;

  const grandTotal = totalBilledRevenue + (totalFilteredBillingCents / 100) + totalMilestoneAdjustment;

  if (hasBillingLimits) {
    rows.push(csvRow([
      'TOTAL',
      '', // Project
      '', // Task
      formatHours(totalActualHours),
      formatHours(totalRoundedHours),
      '', // Carryover In
      formatHours(totalAdjustedHours),
      formatHours(totalBilledHours),
      totalUnbillableHours > 0 ? formatHours(totalUnbillableHours) : '',
      '', // Rounding
      '', // Rate
      '', // Task Revenue
      '', // Project Revenue
      formatCurrency(grandTotal),
    ]));
  } else {
    rows.push(csvRow([
      'TOTAL',
      '', // Project
      '', // Task
      formatHours(totalActualHours),
      formatHours(totalRoundedHours),
      '', // Rounding
      '', // Rate
      '', // Task Revenue
      '', // Project Revenue
      formatCurrency(grandTotal),
    ]));
  }

  // Prepend UTF-8 BOM for Excel compatibility
  return '\uFEFF' + rows.join('\n');
}

// ---------------------------------------------------------------------------
// Browser download helper (DOM side-effect)
// ---------------------------------------------------------------------------

export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  // Defer cleanup to avoid race with async browser download
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}
