/**
 * Revenue CSV Export Utility
 *
 * Generates a CSV string from pre-computed billing data (MonthlyBillingResult),
 * fixed billings (CompanyBillingsGroup[]), and milestone overrides.
 *
 * Column layout mirrors RevenueTable exactly.
 */

import type { MonthlyBillingResult, CompanyBillingResult } from './billingCalculations';
import type { CompanyBillingsGroup } from '../types';
import { TRANSACTION_TYPE_LABELS } from '../types';
import { minutesToHours } from './calculations';

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

function formatDollars(amount: number): string {
  return amount.toFixed(2);
}

function formatCentsAsDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Format cents as display currency string like "$1,234.56" */
function formatCentsDisplay(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
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

  const rows: string[] = [];

  // --- Title row ---
  rows.push(csvRow([`Revenue for the month of ${monthLabel}`]));

  // --- Header row ---
  const header = hasBillingLimits
    ? ['Name', 'Actual', 'Rounded', 'Adjusted', 'Billed', 'Unbillable', 'Rounding', 'Rate', 'Revenue']
    : ['Name', 'Actual', 'Rounded', 'Rounding', 'Rate', 'Revenue'];
  rows.push(csvRow(header));

  // Sort companies alphabetically (matching RevenueTable)
  const sortedCompanies = [...billingResult.companies].sort((a, b) =>
    a.companyName.localeCompare(b.companyName),
  );

  // --- Company / Project / Task rows ---
  for (let ci = 0; ci < sortedCompanies.length; ci++) {
    const company = sortedCompanies[ci];

    // Separator between companies (empty row)
    if (ci > 0) {
      rows.push(csvRow(hasBillingLimits ? Array(9).fill('') : Array(6).fill('')));
    }

    // Company billing data
    const companyBillingData = billingsByCompanyId.get(company.companyId);
    const companyBillingCents = companyBillingData?.totalCents || 0;
    const milestoneAdj = milestoneAdjustmentByCompany.get(company.companyId) || 0;
    const companyTotalRevenue = company.billedRevenue + (companyBillingCents / 100) + milestoneAdj;

    // Company row
    if (hasBillingLimits) {
      rows.push(csvRow([
        company.companyName,
        minutesToHours(company.actualMinutes),
        minutesToHours(company.roundedMinutes),
        company.adjustedHours.toFixed(2),
        company.billedHours.toFixed(2),
        company.unbillableHours > 0 ? company.unbillableHours.toFixed(2) : '\u2014',
        '\u2014',
        '\u2014',
        formatDollars(companyTotalRevenue),
      ]));
    } else {
      rows.push(csvRow([
        company.companyName,
        minutesToHours(company.actualMinutes),
        minutesToHours(company.roundedMinutes),
        '\u2014',
        '\u2014',
        formatDollars(companyTotalRevenue),
      ]));
    }

    // Sort projects alphabetically (matching RevenueTable)
    const sortedProjects = [...company.projects].sort((a, b) =>
      a.projectName.localeCompare(b.projectName),
    );

    // Project rows
    for (const project of sortedProjects) {
      const roundingLabel = project.rounding === 0 ? '\u2014' : `${project.rounding}m`;
      const rateStr = `$${project.rate.toFixed(2)}`;

      // Check milestone
      const milestone = project.projectId
        ? milestoneByExternalProjectId.get(project.projectId)
        : undefined;
      const revenueStr = milestone
        ? `Revenue Milestone ${formatCentsDisplay(milestone.totalCents)}`
        : formatDollars(project.billedRevenue);

      if (hasBillingLimits) {
        rows.push(csvRow([
          `  ${project.projectName}`,
          minutesToHours(project.actualMinutes),
          minutesToHours(project.roundedMinutes),
          project.adjustedHours.toFixed(2),
          project.billedHours.toFixed(2),
          project.unbillableHours > 0 ? project.unbillableHours.toFixed(2) : '\u2014',
          roundingLabel,
          rateStr,
          revenueStr,
        ]));
      } else {
        rows.push(csvRow([
          `  ${project.projectName}`,
          minutesToHours(project.actualMinutes),
          minutesToHours(project.roundedMinutes),
          roundingLabel,
          rateStr,
          revenueStr,
        ]));
      }

      // Task rows (sorted alphabetically, matching RevenueTable)
      const sortedTasks = [...project.tasks].sort((a, b) =>
        a.taskName.localeCompare(b.taskName),
      );

      for (const task of sortedTasks) {
        const taskRoundingLabel = project.rounding === 0 ? '\u2014' : `${project.rounding}m`;
        const taskRateStr = `$${project.rate.toFixed(2)}`;

        if (hasBillingLimits) {
          rows.push(csvRow([
            `    ${task.taskName}`,
            minutesToHours(task.actualMinutes),
            minutesToHours(task.roundedMinutes),
            '\u2014',
            '\u2014',
            '\u2014',
            taskRoundingLabel,
            taskRateStr,
            formatDollars(task.baseRevenue),
          ]));
        } else {
          rows.push(csvRow([
            `    ${task.taskName}`,
            minutesToHours(task.actualMinutes),
            minutesToHours(task.roundedMinutes),
            taskRoundingLabel,
            taskRateStr,
            formatDollars(task.baseRevenue),
          ]));
        }
      }
    }

    // Fixed Billing rows (after projects, matching RevenueTable)
    if (companyBillingData) {
      for (const billing of companyBillingData.billings) {
        const typeLabel = TRANSACTION_TYPE_LABELS[billing.type];

        if (hasBillingLimits) {
          rows.push(csvRow([
            `  ${billing.name}`,
            '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014',
            typeLabel,
            formatCentsAsDollars(billing.totalCents),
          ]));
        } else {
          rows.push(csvRow([
            `  ${billing.name}`,
            '\u2014', '\u2014', '\u2014',
            typeLabel,
            formatCentsAsDollars(billing.totalCents),
          ]));
        }

        // Transaction rows (nested under billing)
        for (const tx of billing.transactions) {
          if (hasBillingLimits) {
            rows.push(csvRow([
              `    ${tx.description}`,
              '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014',
              '\u2014',
              formatCentsAsDollars(tx.amountCents),
            ]));
          } else {
            rows.push(csvRow([
              `    ${tx.description}`,
              '\u2014', '\u2014', '\u2014',
              '\u2014',
              formatCentsAsDollars(tx.amountCents),
            ]));
          }
        }
      }
    }
  }

  // --- TOTAL row ---
  const grandTotal = billingResult.billedRevenue + (totalFilteredBillingCents / 100) + totalMilestoneAdjustment;

  if (hasBillingLimits) {
    rows.push(csvRow([
      'TOTAL',
      minutesToHours(billingResult.actualMinutes),
      minutesToHours(billingResult.roundedMinutes),
      billingResult.adjustedHours.toFixed(2),
      billingResult.billedHours.toFixed(2),
      billingResult.unbillableHours > 0 ? billingResult.unbillableHours.toFixed(2) : '\u2014',
      '\u2014',
      '\u2014',
      formatDollars(grandTotal),
    ]));
  } else {
    rows.push(csvRow([
      'TOTAL',
      minutesToHours(billingResult.actualMinutes),
      minutesToHours(billingResult.roundedMinutes),
      '\u2014',
      '\u2014',
      formatDollars(grandTotal),
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
