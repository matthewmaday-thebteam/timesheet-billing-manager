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
  const { billingResult, filteredCompanyBillings, milestoneByExternalProjectId, monthLabel } = options;

  // Determine extended vs standard layout
  const hasBillingLimits = billingResult.companies.some(c =>
    c.projects.some(p => p.hasBillingLimits),
  );

  // Build billings lookup by companyId (matching RevenueTable's billingsByClientId)
  const billingsByCompanyId = new Map<string, CompanyBillingsGroup>();
  for (const cb of filteredCompanyBillings) {
    billingsByCompanyId.set(cb.companyClientId, cb);
  }

  // Build per-company milestone adjustments
  const milestoneAdjustmentByCompany = buildMilestoneAdjustmentByCompany(
    billingResult.companies,
    milestoneByExternalProjectId,
  );

  // Total milestone adjustment (for grand total)
  let totalMilestoneAdjustment = 0;
  for (const adj of milestoneAdjustmentByCompany.values()) {
    totalMilestoneAdjustment += adj;
  }

  // Total filtered billing cents (for grand total)
  let totalFilteredBillingCents = 0;
  for (const cb of filteredCompanyBillings) {
    totalFilteredBillingCents += cb.totalCents;
  }

  // Column counts: Extended = 14, Standard = 10
  const colCount = hasBillingLimits ? 14 : 10;

  const rows: string[] = [];

  // --- Title row ---
  rows.push(csvRow([`Revenue for the month of ${monthLabel}`]));

  // --- Header row ---
  const header = hasBillingLimits
    ? ['Company', 'Project', 'Task', 'Actual', 'Rounded', 'Carryover In', 'Adjusted', 'Billed', 'Unbillable', 'Rounding', 'Rate ($/hr)', 'Task Revenue', 'Project Revenue', 'Company Revenue']
    : ['Company', 'Project', 'Task', 'Actual', 'Hours', 'Rounding', 'Rate ($/hr)', 'Task Revenue', 'Project Revenue', 'Company Revenue'];
  rows.push(csvRow(header));

  // Sort companies alphabetically (matching RevenueTable)
  const sortedCompanies = [...billingResult.companies].sort((a, b) =>
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
    // Company name in col 0, Company Revenue in last col, rest blank
    const companyRow = emptyRow();
    companyRow[0] = company.companyName;
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

      // Project summary row: Company + Project name, Project Revenue in second-to-last col
      const projectRow = emptyRow();
      projectRow[0] = company.companyName;
      projectRow[1] = project.projectName;
      projectRow[colCount - 2] = projectRevenueStr; // Project Revenue column
      rows.push(csvRow(projectRow));

      // Task rows (sorted by hours descending, matching old export)
      const sortedTasks = [...project.tasks].sort((a, b) =>
        b.actualMinutes - a.actualMinutes,
      );

      const roundingLabel = project.rounding === 0 ? '\u2014' : `${project.rounding}m`;

      let isFirstTask = true;
      for (const task of sortedTasks) {
        if (hasBillingLimits) {
          rows.push(csvRow([
            company.companyName,
            project.projectName,
            task.taskName,
            task.actualHours.toFixed(2),
            task.roundedHours.toFixed(2),
            // Billing limit columns: project-level data on first task only
            isFirstTask ? formatHours(project.carryoverIn) : '',
            isFirstTask ? formatHours(project.adjustedHours) : '',
            isFirstTask ? formatHours(project.billedHours) : '',
            isFirstTask && project.unbillableHours > 0 ? formatHours(project.unbillableHours) : '',
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
        isFirstTask = false;
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
  const grandTotal = billingResult.billedRevenue + (totalFilteredBillingCents / 100) + totalMilestoneAdjustment;

  if (hasBillingLimits) {
    rows.push(csvRow([
      'TOTAL',
      '', // Project
      '', // Task
      formatHours(billingResult.actualHours),
      formatHours(billingResult.roundedHours),
      '', // Carryover In
      formatHours(billingResult.adjustedHours),
      formatHours(billingResult.billedHours),
      billingResult.unbillableHours > 0 ? formatHours(billingResult.unbillableHours) : '',
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
      formatHours(billingResult.actualHours),
      formatHours(billingResult.roundedHours),
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
