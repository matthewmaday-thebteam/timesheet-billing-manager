import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// jwtVerify no longer needed — auth uses supabase.auth.getUser() pattern

// =============================================================================
// Edge Function: generate-eom-report
// =============================================================================
// Generates CSV reports for end-of-month billing, matching the exact format
// of the existing Customer Revenue Report CSV export (generateRevenueCSV.ts).
//
// POST body variants:
//   { year, month }                — generate for ALL companies for that month
//   { year, month, companyId }     — generate for ONE company
//   { backfill: true }             — generate for ALL eligible months/companies
//
// Validation: Reports can only be generated after the 5th of the following
// month (Europe/Sofia timezone). Backfill mode relaxes this for past months.
//
// Read-only guarantee: ZERO writes to any source data table.
// Only writes to eom_reports table and eom-reports storage bucket.
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// =============================================================================
// Utility functions (replicated from src/utils/billing.ts and edge function)
// =============================================================================

function applyRounding(minutes: number, increment: number): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatHours(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString('en-US');
  }
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCentsDisplay(cents: number): string {
  return formatCurrency(cents / 100);
}

// =============================================================================
// CSV helpers (replicated from src/utils/generateRevenueCSV.ts)
// =============================================================================

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

// =============================================================================
// Transaction type labels (replicated from src/types/index.ts)
// =============================================================================

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  revenue_milestone: 'Revenue Milestone',
  service_fee: 'Service Fee',
  subscription: 'Subscription',
  license: 'License',
  reimbursement: 'Reimbursement',
};

// =============================================================================
// Types
// =============================================================================

interface SummaryRow {
  project_id: string;
  company_id: string;
  actual_hours: number;
  rounded_hours: number;
  carryover_in_hours: number;
  adjusted_hours: number;
  billed_hours: number;
  unbillable_hours: number;
  billed_revenue_cents: number;
  base_revenue_cents: number;
  rate_used: number;
  rounding_used: number;
  has_billing_limits: boolean;
  milestone_override_cents: number | null;
  projects: {
    project_name: string;
    project_id: string; // external project_id
  };
  companies: {
    client_id: string;
    client_name: string;
    display_name: string | null;
  };
}

interface BillingRow {
  billing_id: string;
  company_id: string;
  company_client_id: string;
  company_name: string;
  company_display_name: string | null;
  billing_name: string;
  billing_type: string;
  linked_project_id: string | null;
  linked_project_name: string | null;
  transaction_id: string | null;
  transaction_month: string | null;
  amount_cents: number | null;
  transaction_description: string | null;
}

interface TaskEntry {
  project_id: string;
  task_name: string;
  total_minutes: number;
}

interface CompanyReportResult {
  companyId: string;
  companyName: string;
  year: number;
  month: number;
  status: 'generated' | 'skipped' | 'failed';
  error?: string;
  storagePath?: string;
  totalHours?: number;
  totalRevenueCents?: number;
  projectCount?: number;
  fileSizeBytes?: number;
}

// =============================================================================
// Date/timezone helpers
// =============================================================================

/** Get current date in Europe/Sofia timezone */
function nowInSofia(): Date {
  const nowUtc = new Date();
  const sofiaStr = nowUtc.toLocaleString('en-US', { timeZone: 'Europe/Sofia' });
  return new Date(sofiaStr);
}

/** Check if a month is eligible for report generation (5th of following month rule) */
function isMonthEligible(year: number, month: number, isBackfill: boolean): boolean {
  const sofiaDate = nowInSofia();
  const sofiaYear = sofiaDate.getFullYear();
  const sofiaMonth = sofiaDate.getMonth() + 1;
  const sofiaDay = sofiaDate.getDate();

  // The month must be in the past
  if (year > sofiaYear || (year === sofiaYear && month >= sofiaMonth)) {
    return false;
  }

  // For backfill: any past month is eligible (month has passed)
  if (isBackfill) {
    return true;
  }

  // Standard rule: current date in Sofia >= 5th of following month
  const followingMonth = month === 12 ? 1 : month + 1;
  const followingYear = month === 12 ? year + 1 : year;

  if (sofiaYear > followingYear) return true;
  if (sofiaYear === followingYear && sofiaMonth > followingMonth) return true;
  if (sofiaYear === followingYear && sofiaMonth === followingMonth && sofiaDay >= 5) return true;

  return false;
}

/** SHA-256 hash of a string (Deno crypto API) */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================================================
// CSV generation — matches generateRevenueCSV.ts format exactly
// =============================================================================

interface ProjectData {
  projectName: string;
  externalId: string;
  rate: number;
  rounding: number;
  actualHours: number;
  roundedHours: number;
  carryoverIn: number;
  adjustedHours: number;
  billedHours: number;
  unbillableHours: number;
  billedRevenue: number;
  hasBillingLimits: boolean;
  tasks: Array<{
    taskName: string;
    actualMinutes: number;
    roundedMinutes: number;
    actualHours: number;
    roundedHours: number;
    baseRevenue: number;
  }>;
}

interface BillingData {
  name: string;
  type: string;
  totalCents: number;
  transactions: Array<{
    description: string;
    amountCents: number;
  }>;
}

interface CompanyCSVData {
  companyName: string;
  companyId: string;
  projects: ProjectData[];
  billings: BillingData[];
  milestoneByExternalProjectId: Map<string, number>;
  actualHours: number;
  roundedHours: number;
  adjustedHours: number;
  billedHours: number;
  unbillableHours: number;
  billedRevenue: number;
}

function generateCSV(company: CompanyCSVData, monthLabel: string): string {
  // Determine extended vs standard layout
  const hasBillingLimits = company.projects.some(p => p.hasBillingLimits);
  const colCount = hasBillingLimits ? 12 : 8;

  const rows: string[] = [];

  // --- Title row ---
  rows.push(csvRow([`Revenue for the month of ${monthLabel}`]));

  // --- Header row ---
  const header = hasBillingLimits
    ? ['Company', 'Project', 'Task', 'Rounded', 'Carryover', 'Adjusted', 'Billed', 'Unbillable', 'Rate ($/hr)', 'Task Revenue', 'Project Revenue', 'Company Revenue']
    : ['Company', 'Project', 'Task', 'Hours', 'Rate ($/hr)', 'Task Revenue', 'Project Revenue', 'Company Revenue'];
  rows.push(csvRow(header));

  const emptyRow = () => Array(colCount).fill('') as string[];

  // Build per-company milestone adjustment
  let milestoneAdj = 0;
  for (const project of company.projects) {
    const milestoneCents = company.milestoneByExternalProjectId.get(project.externalId);
    if (milestoneCents !== undefined) {
      milestoneAdj += roundCurrency(milestoneCents / 100) - roundCurrency(project.billedRevenue);
    }
  }

  // Company billing cents total
  let companyBillingCents = 0;
  for (const billing of company.billings) {
    companyBillingCents += billing.totalCents;
  }

  const companyTotalRevenue = roundCurrency(
    company.billedRevenue + (companyBillingCents / 100) + milestoneAdj
  );

  // --- Company summary row ---
  const companyCarryoverIn = company.projects.reduce((sum, p) => sum + p.carryoverIn, 0);
  const companyRow = emptyRow();
  companyRow[0] = company.companyName;
  if (hasBillingLimits) {
    companyRow[3] = formatHours(company.roundedHours);
    if (companyCarryoverIn > 0) {
      companyRow[4] = formatHours(companyCarryoverIn);
    }
    companyRow[5] = formatHours(company.adjustedHours);
    companyRow[6] = formatHours(company.billedHours);
  } else {
    companyRow[3] = formatHours(company.billedHours);
  }
  companyRow[colCount - 1] = formatCurrency(companyTotalRevenue);
  rows.push(csvRow(companyRow));

  // Sort projects alphabetically
  const sortedProjects = [...company.projects].sort((a, b) =>
    a.projectName.localeCompare(b.projectName),
  );

  // --- Project rows ---
  for (const project of sortedProjects) {
    // Check milestone for revenue display
    const milestoneCents = company.milestoneByExternalProjectId.get(project.externalId);
    const projectRevenueStr = milestoneCents !== undefined
      ? formatCentsDisplay(milestoneCents)
      : formatCurrency(project.billedRevenue);

    // Project summary row
    const projectRow = emptyRow();
    projectRow[0] = company.companyName;
    projectRow[1] = project.projectName;
    if (hasBillingLimits) {
      projectRow[3] = formatHours(project.roundedHours);
      if (project.carryoverIn > 0) {
        projectRow[4] = formatHours(project.carryoverIn);
      }
      projectRow[5] = formatHours(project.adjustedHours);
      projectRow[6] = formatHours(project.billedHours);
    } else {
      projectRow[3] = formatHours(project.billedHours);
    }
    projectRow[colCount - 2] = projectRevenueStr;
    rows.push(csvRow(projectRow));

    // Task rows (sorted by hours descending)
    const sortedTasks = [...project.tasks].sort((a, b) =>
      b.actualMinutes - a.actualMinutes,
    );

    for (const task of sortedTasks) {
      if (hasBillingLimits) {
        rows.push(csvRow([
          company.companyName,
          project.projectName,
          task.taskName,
          task.roundedHours.toFixed(2),
          '', // Carryover In (shown on project row)
          '', // Adjusted (shown on project row)
          '', // Billed (shown on project row)
          '', // Unbillable (shown on project row)
          project.rate.toFixed(2),
          formatCurrency(task.baseRevenue),
          '', // Project Revenue
          '', // Company Revenue
        ]));
      } else {
        rows.push(csvRow([
          company.companyName,
          project.projectName,
          task.taskName,
          task.roundedHours.toFixed(2),
          project.rate.toFixed(2),
          formatCurrency(task.baseRevenue),
          '', // Project Revenue
          '', // Company Revenue
        ]));
      }
    }
  }

  // --- Fixed Billing rows ---
  for (const billing of company.billings) {
    const typeLabel = TRANSACTION_TYPE_LABELS[billing.type] || billing.type;

    // Billing summary row
    const billingRow = emptyRow();
    billingRow[0] = company.companyName;
    billingRow[1] = billing.name;
    billingRow[hasBillingLimits ? 8 : 4] = typeLabel;
    billingRow[colCount - 2] = formatCentsDisplay(billing.totalCents);
    rows.push(csvRow(billingRow));

    // Transaction rows
    for (const tx of billing.transactions) {
      const txRow = emptyRow();
      txRow[0] = company.companyName;
      txRow[1] = billing.name;
      txRow[2] = tx.description;
      txRow[colCount - 3] = formatCentsDisplay(tx.amountCents);
      rows.push(csvRow(txRow));
    }
  }

  // --- TOTAL row ---
  if (hasBillingLimits) {
    rows.push(csvRow([
      'TOTAL',
      '', // Project
      '', // Task
      formatHours(company.roundedHours),
      '', // Carryover In
      formatHours(company.adjustedHours),
      formatHours(company.billedHours),
      company.unbillableHours > 0 ? formatHours(company.unbillableHours) : '',
      '', // Rate
      '', // Task Revenue
      '', // Project Revenue
      formatCurrency(companyTotalRevenue),
    ]));
  } else {
    rows.push(csvRow([
      'TOTAL',
      '', // Project
      '', // Task
      formatHours(company.roundedHours),
      '', // Rate
      '', // Task Revenue
      '', // Project Revenue
      formatCurrency(companyTotalRevenue),
    ]));
  }

  // Prepend UTF-8 BOM for Excel compatibility
  return '\uFEFF' + rows.join('\n');
}

// =============================================================================
// Core: generate report for a single company-month
// =============================================================================

async function generateCompanyReport(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  year: number,
  month: number,
  generatedBy: string | null,
): Promise<CompanyReportResult> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const rangeStart = monthStr;
  const rangeEnd = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  // --- Look up company ---
  const { data: companyData, error: companyError } = await supabase
    .from('companies')
    .select('id, client_id, client_name, display_name')
    .eq('id', companyId)
    .single();

  if (companyError || !companyData) {
    return {
      companyId,
      companyName: 'Unknown',
      year,
      month,
      status: 'failed',
      error: companyError?.message || 'Company not found',
    };
  }

  const companyName = companyData.display_name || companyData.client_name;
  const companyClientId = companyData.client_id;

  // --- Parallel data queries (same pattern as customer-revenue-report) ---
  const [summaryResult, entriesResult, projectsResult, groupMembersResult, billingsResult] =
    await Promise.all([
      // 1. Project billing summary for this company-month
      supabase
        .from('v_canonical_project_monthly_summary')
        .select(`
          *,
          projects!inner (project_name, project_id),
          companies!inner (client_id, client_name, display_name)
        `)
        .eq('summary_month', monthStr)
        .eq('company_id', companyId),

      // 2a. Timesheet entries for the month (all companies — filtered after resolution)
      supabase
        .from('v_timesheet_entries')
        .select('project_id, task_name, total_minutes')
        .gte('work_date', rangeStart)
        .lt('work_date', rangeEnd),

      // 2b. All projects (for external <> internal ID mapping)
      supabase
        .from('projects')
        .select('id, project_id'),

      // 2c. Project group members
      supabase
        .from('project_group_members')
        .select('member_project_id, group:project_groups!inner(primary_project_id)'),

      // 3. Billings with transactions for the month
      supabase.rpc('get_billings_with_transactions', {
        p_start_month: monthStr,
        p_end_month: monthStr,
      }),
    ]);

  if (summaryResult.error) {
    return { companyId, companyName, year, month, status: 'failed', error: `Summary query: ${summaryResult.error.message}` };
  }
  if (entriesResult.error) {
    return { companyId, companyName, year, month, status: 'failed', error: `Entries query: ${entriesResult.error.message}` };
  }
  if (projectsResult.error) {
    return { companyId, companyName, year, month, status: 'failed', error: `Projects query: ${projectsResult.error.message}` };
  }
  if (groupMembersResult.error) {
    return { companyId, companyName, year, month, status: 'failed', error: `Group members query: ${groupMembersResult.error.message}` };
  }
  if (billingsResult.error) {
    return { companyId, companyName, year, month, status: 'failed', error: `Billings query: ${billingsResult.error.message}` };
  }

  const summaryRows = (summaryResult.data as SummaryRow[]) || [];
  const allEntries = (entriesResult.data as TaskEntry[]) || [];
  const allProjects = projectsResult.data || [];
  const groupMembers = groupMembersResult.data || [];
  const billingRows = (billingsResult.data as BillingRow[]) || [];

  // --- Build project ID mappings ---
  const externalToInternal = new Map<string, string>();
  const internalToExternal = new Map<string, string>();
  for (const p of allProjects) {
    externalToInternal.set(p.project_id, p.id);
    internalToExternal.set(p.id, p.project_id);
  }

  // Build member internal UUID -> primary canonical external project_id
  const memberToPrimaryExternal = new Map<string, string>();
  for (const gm of groupMembers) {
    const group = gm.group as unknown as { primary_project_id: string };
    const primaryExternal = internalToExternal.get(group.primary_project_id);
    if (primaryExternal) {
      memberToPrimaryExternal.set(gm.member_project_id, primaryExternal);
    }
  }

  // --- Build project config from summary data ---
  const companyProjectExternalIds = new Set<string>();
  const projectDataMap = new Map<string, ProjectData>();

  for (const row of summaryRows) {
    const externalId = row.projects.project_id;
    companyProjectExternalIds.add(externalId);
    projectDataMap.set(externalId, {
      projectName: row.projects.project_name,
      externalId,
      rate: Number(row.rate_used),
      rounding: Number(row.rounding_used),
      actualHours: Number(row.actual_hours),
      roundedHours: Number(row.rounded_hours),
      carryoverIn: Number(row.carryover_in_hours),
      adjustedHours: Number(row.adjusted_hours),
      billedHours: Number(row.billed_hours),
      unbillableHours: Number(row.unbillable_hours),
      billedRevenue: roundCurrency(Number(row.billed_revenue_cents) / 100),
      hasBillingLimits: row.has_billing_limits,
      tasks: [],
    });
  }

  // --- Build task breakdown (grouped by canonical external project ID) ---
  const tasksByProject = new Map<string, Map<string, number>>();

  for (const entry of allEntries) {
    if (!entry.project_id || entry.total_minutes <= 0) continue;

    // Resolve to canonical external project ID
    const internalId = externalToInternal.get(entry.project_id);
    let canonicalExternal = entry.project_id;
    if (internalId && memberToPrimaryExternal.has(internalId)) {
      canonicalExternal = memberToPrimaryExternal.get(internalId)!;
    }

    // Filter to company projects only
    if (!companyProjectExternalIds.has(canonicalExternal)) continue;

    const taskName = entry.task_name || 'No Task';
    if (!tasksByProject.has(canonicalExternal)) {
      tasksByProject.set(canonicalExternal, new Map());
    }
    const taskMap = tasksByProject.get(canonicalExternal)!;
    taskMap.set(taskName, (taskMap.get(taskName) || 0) + entry.total_minutes);
  }

  // --- Populate tasks on each project ---
  for (const [externalId, project] of projectDataMap) {
    const rawTasks = tasksByProject.get(externalId);
    if (rawTasks) {
      for (const [taskName, actualMinutes] of rawTasks) {
        const roundedMinutes = applyRounding(actualMinutes, project.rounding);
        const actualHrs = roundHours(actualMinutes / 60);
        const roundedHrs = roundHours(roundedMinutes / 60);
        const baseRevenue = roundCurrency(roundedHrs * project.rate);
        project.tasks.push({
          taskName,
          actualMinutes,
          roundedMinutes,
          actualHours: actualHrs,
          roundedHours: roundedHrs,
          baseRevenue,
        });
      }
    }
  }

  // --- Process billings (milestones + fixed billings) ---
  // Group billings by billing_id
  const billingMap = new Map<string, {
    id: string;
    companyClientId: string;
    companyId: string;
    name: string;
    type: string;
    linkedProjectId: string | null;
    totalCents: number;
    transactions: Array<{ description: string; amountCents: number }>;
  }>();

  for (const row of billingRows) {
    if (!billingMap.has(row.billing_id)) {
      billingMap.set(row.billing_id, {
        id: row.billing_id,
        companyClientId: row.company_client_id,
        companyId: row.company_id,
        name: row.billing_name,
        type: row.billing_type,
        linkedProjectId: row.linked_project_id,
        totalCents: 0,
        transactions: [],
      });
    }
    if (row.transaction_id && row.amount_cents !== null) {
      const billing = billingMap.get(row.billing_id)!;
      billing.totalCents += row.amount_cents;
      billing.transactions.push({
        description: row.transaction_description || '',
        amountCents: row.amount_cents,
      });
    }
  }

  // Build milestoneByExternalProjectId
  const milestoneByExternalProjectId = new Map<string, number>();
  const linkedMilestoneBillingIds = new Set<string>();

  for (const billing of billingMap.values()) {
    if (billing.type === 'revenue_milestone' && billing.linkedProjectId) {
      const externalId = internalToExternal.get(billing.linkedProjectId);
      if (externalId) {
        const existing = milestoneByExternalProjectId.get(externalId) || 0;
        milestoneByExternalProjectId.set(externalId, existing + billing.totalCents);
        linkedMilestoneBillingIds.add(billing.id);
      }
    }
  }

  // Collect company billings (excludes linked milestones)
  const companyBillings: BillingData[] = [];
  for (const billing of billingMap.values()) {
    if (linkedMilestoneBillingIds.has(billing.id)) continue;
    if (billing.companyClientId !== companyClientId) continue;

    companyBillings.push({
      name: billing.name,
      type: billing.type,
      totalCents: billing.totalCents,
      transactions: billing.transactions,
    });
  }

  // --- Compute company-level totals ---
  let totalActualHours = 0;
  let totalRoundedHours = 0;
  let totalAdjustedHours = 0;
  let totalBilledHours = 0;
  let totalUnbillableHours = 0;
  let totalBilledRevenue = 0;

  for (const project of projectDataMap.values()) {
    totalActualHours = roundHours(totalActualHours + project.actualHours);
    totalRoundedHours = roundHours(totalRoundedHours + project.roundedHours);
    totalAdjustedHours = roundHours(totalAdjustedHours + project.adjustedHours);
    totalBilledHours = roundHours(totalBilledHours + project.billedHours);
    totalUnbillableHours = roundHours(totalUnbillableHours + project.unbillableHours);
    totalBilledRevenue = roundCurrency(totalBilledRevenue + project.billedRevenue);
  }

  // Milestone adjustment
  let milestoneAdj = 0;
  for (const [externalId, project] of projectDataMap) {
    const milestoneCents = milestoneByExternalProjectId.get(externalId);
    if (milestoneCents !== undefined) {
      milestoneAdj += roundCurrency(milestoneCents / 100) - project.billedRevenue;
    }
  }

  // Company filtered billing cents
  let companyFilteredBillingCents = 0;
  for (const billing of companyBillings) {
    companyFilteredBillingCents += billing.totalCents;
  }

  const companyTotalRevenueCents = Math.round(
    (totalBilledRevenue + (companyFilteredBillingCents / 100) + milestoneAdj) * 100
  );

  // --- Build source data for hashing ---
  const sourceData = JSON.stringify({
    companyId,
    year,
    month,
    summaryRows: summaryRows.map(r => ({
      project_id: r.project_id,
      billed_hours: r.billed_hours,
      billed_revenue_cents: r.billed_revenue_cents,
      milestone_override_cents: r.milestone_override_cents,
    })),
    billingTotals: Array.from(billingMap.entries())
      .filter(([, b]) => b.companyClientId === companyClientId)
      .map(([id, b]) => ({ id, totalCents: b.totalCents })),
  });

  const sourceDataHash = await sha256(sourceData);

  // --- Build month label ---
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthLabel = `${monthNames[month - 1]} ${year}`;

  // --- Check if data is empty (no projects, no billings) ---
  if (projectDataMap.size === 0 && companyBillings.length === 0) {
    return {
      companyId,
      companyName,
      year,
      month,
      status: 'skipped',
      error: 'No billing data for this company-month',
    };
  }

  // --- Generate CSV ---
  const companyCSVData: CompanyCSVData = {
    companyName,
    companyId: companyClientId,
    projects: Array.from(projectDataMap.values()),
    billings: companyBillings,
    milestoneByExternalProjectId,
    actualHours: totalActualHours,
    roundedHours: totalRoundedHours,
    adjustedHours: totalAdjustedHours,
    billedHours: totalBilledHours,
    unbillableHours: totalUnbillableHours,
    billedRevenue: totalBilledRevenue,
  };

  let csvContent: string;
  try {
    csvContent = generateCSV(companyCSVData, monthLabel);
  } catch (csvError) {
    return {
      companyId,
      companyName,
      year,
      month,
      status: 'failed',
      error: `CSV generation: ${csvError instanceof Error ? csvError.message : String(csvError)}`,
    };
  }

  // --- Upload CSV to storage (do NOT upload partial data) ---
  const storagePath = `${year}/${String(month).padStart(2, '0')}/${companyId}.csv`;
  const csvBytes = new TextEncoder().encode(csvContent);
  const fileSizeBytes = csvBytes.length;

  const { error: uploadError } = await supabase.storage
    .from('eom-reports')
    .upload(storagePath, csvBytes, {
      contentType: 'text/csv',
      upsert: true,
    });

  if (uploadError) {
    return {
      companyId,
      companyName,
      year,
      month,
      status: 'failed',
      error: `Storage upload: ${uploadError.message}`,
    };
  }

  // --- Upsert eom_reports row ---
  // Note: This read-then-write is not atomic. In the rare case of concurrent
  // generation for the same company-month, generation_number may be off by one.
  // The UNIQUE constraint on (company_id, report_year, report_month) prevents
  // duplicate rows — the last writer wins. This is acceptable because the CSV
  // content would be identical in both cases.
  const { data: existingReport } = await supabase
    .from('eom_reports')
    .select('id, generation_number')
    .eq('company_id', companyId)
    .eq('report_year', year)
    .eq('report_month', month)
    .maybeSingle();

  const nextGenerationNumber = existingReport
    ? existingReport.generation_number + 1
    : 1;

  const { error: upsertError } = await supabase
    .from('eom_reports')
    .upsert(
      {
        company_id: companyId,
        report_year: year,
        report_month: month,
        company_name: companyName,
        total_hours: totalBilledHours,
        total_revenue_cents: companyTotalRevenueCents,
        project_count: projectDataMap.size,
        storage_path: storagePath,
        file_size_bytes: fileSizeBytes,
        generated_at: new Date().toISOString(),
        generated_by: generatedBy,
        generation_number: nextGenerationNumber,
        source_data_hash: sourceDataHash,
      },
      { onConflict: 'company_id,report_year,report_month' },
    );

  if (upsertError) {
    return {
      companyId,
      companyName,
      year,
      month,
      status: 'failed',
      error: `Database upsert: ${upsertError.message}`,
    };
  }

  return {
    companyId,
    companyName,
    year,
    month,
    status: 'generated',
    storagePath,
    totalHours: totalBilledHours,
    totalRevenueCents: companyTotalRevenueCents,
    projectCount: projectDataMap.size,
    fileSizeBytes,
  };
}

// =============================================================================
// Main handler
// =============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // --- Authenticate caller (any authenticated user) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // Verify the caller is an authenticated user (same pattern as admin-users)
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized: authentication required' }, 401);
    }

    // --- Service-role client for privileged operations ---
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parse request body ---
    const body = await req.json();
    const { year, month, companyId, backfill } = body as {
      year?: number;
      month?: number;
      companyId?: string;
      backfill?: boolean;
    };

    // --- Determine mode ---
    const results: CompanyReportResult[] = [];

    if (backfill) {
      // =====================================================================
      // BACKFILL mode: generate for ALL eligible company-months
      // =====================================================================
      const { data: eligible, error: eligibleError } = await supabase
        .from('v_eom_report_availability')
        .select('company_id, company_name, report_year, report_month');

      if (eligibleError) {
        return jsonResponse({ error: `Availability query: ${eligibleError.message}` }, 500);
      }

      if (!eligible || eligible.length === 0) {
        return jsonResponse({
          message: 'No eligible company-months found for backfill',
          generated: 0,
          failed: 0,
          skipped: 0,
          results: [],
        });
      }

      // Filter to months that have actually passed (backfill relaxes the 5th rule)
      const eligibleFiltered = eligible.filter(e =>
        isMonthEligible(e.report_year, e.report_month, true),
      );

      for (const row of eligibleFiltered) {
        const result = await generateCompanyReport(
          supabase,
          row.company_id,
          row.report_year,
          row.report_month,
          user.id, // track who triggered the backfill
        );
        results.push(result);
      }
    } else if (year && month) {
      // =====================================================================
      // SINGLE MONTH mode (all companies or one company)
      // =====================================================================
      if (typeof year !== 'number' || typeof month !== 'number' || month < 1 || month > 12) {
        return jsonResponse({ error: 'Invalid year/month. month must be 1-12.' }, 400);
      }

      // Validate 5th-of-month rule
      if (!isMonthEligible(year, month, false)) {
        const followingMonth = month === 12 ? 1 : month + 1;
        const followingYear = month === 12 ? year + 1 : year;
        return jsonResponse({
          error: `Report for ${year}-${String(month).padStart(2, '0')} cannot be generated yet. ` +
            `Available after ${followingYear}-${String(followingMonth).padStart(2, '0')}-05 (Europe/Sofia timezone).`,
        }, 400);
      }

      if (companyId) {
        // Single company
        const result = await generateCompanyReport(supabase, companyId, year, month, user.id);
        results.push(result);
      } else {
        // All companies for this month — query the availability view
        const monthStr = `${year}-${String(month).padStart(2, '0')}-01`;

        // Get all companies that have data for this month
        // from both timesheet summaries and fixed billing summaries
        const { data: timesheetCompanies, error: tsErr } = await supabase
          .from('v_canonical_project_monthly_summary')
          .select('company_id')
          .eq('summary_month', monthStr);

        if (tsErr) {
          return jsonResponse({ error: `Company lookup (timesheet): ${tsErr.message}` }, 500);
        }

        const { data: fixedCompanies, error: fbErr } = await supabase
          .from('monthly_fixed_billing_summary')
          .select('company_id')
          .eq('summary_month', monthStr);

        if (fbErr) {
          return jsonResponse({ error: `Company lookup (fixed): ${fbErr.message}` }, 500);
        }

        // Deduplicate company IDs
        const companyIds = new Set<string>();
        for (const row of timesheetCompanies || []) {
          companyIds.add(row.company_id);
        }
        for (const row of fixedCompanies || []) {
          companyIds.add(row.company_id);
        }

        if (companyIds.size === 0) {
          return jsonResponse({
            message: `No companies with billing data for ${year}-${String(month).padStart(2, '0')}`,
            generated: 0,
            failed: 0,
            skipped: 0,
            results: [],
          });
        }

        for (const cid of companyIds) {
          const result = await generateCompanyReport(supabase, cid, year, month, user.id);
          results.push(result);
        }
      }
    } else {
      return jsonResponse({
        error: 'Invalid request. Provide { year, month } or { year, month, companyId } or { backfill: true }',
      }, 400);
    }

    // --- Build response summary ---
    const generated = results.filter(r => r.status === 'generated').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;

    return jsonResponse({
      message: `Report generation complete: ${generated} generated, ${failed} failed, ${skipped} skipped`,
      generated,
      failed,
      skipped,
      results: results.map(r => ({
        companyId: r.companyId,
        companyName: r.companyName,
        year: r.year,
        month: r.month,
        status: r.status,
        ...(r.error ? { error: r.error } : {}),
        ...(r.storagePath ? { storagePath: r.storagePath } : {}),
        ...(r.totalHours !== undefined ? { totalHours: r.totalHours } : {}),
        ...(r.totalRevenueCents !== undefined ? { totalRevenueCents: r.totalRevenueCents } : {}),
        ...(r.projectCount !== undefined ? { projectCount: r.projectCount } : {}),
        ...(r.fileSizeBytes !== undefined ? { fileSizeBytes: r.fileSizeBytes } : {}),
      })),
    });
  } catch (error) {
    console.error('generate-eom-report error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});
