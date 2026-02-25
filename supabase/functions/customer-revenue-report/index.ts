import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// --- Utility functions (replicated from src/utils/billing.ts) ---

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

// --- Types ---

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

interface SummaryRow {
  project_id: string; // internal UUID
  billed_hours: number;
  billed_revenue_cents: number;
  rate_used: number;
  rounding_used: number;
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

interface TaskOutput {
  taskName: string;
  hours: number;
}

interface ProjectOutput {
  projectName: string;
  rate: number;
  projectHours: number;
  projectRevenue: number;
  projectRevenueFormatted: string;
  tasks: TaskOutput[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // --- Authenticate caller (service role key only) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // Verify the token is a service_role JWT.
    // The API gateway validates the JWT signature; we just check the role claim.
    try {
      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(atob(payloadB64));
      if (payload.role !== 'service_role') {
        return jsonResponse({ error: 'Unauthorized: service_role required' }, 401);
      }
    } catch {
      return jsonResponse({ error: 'Unauthorized: invalid token' }, 401);
    }

    // --- Parse request body ---
    const { companyName, month } = await req.json();

    if (!companyName || typeof companyName !== 'string') {
      return jsonResponse({ error: 'companyName is required' }, 400);
    }
    if (!month || typeof month !== 'string') {
      return jsonResponse({ error: 'month is required (YYYY-MM-01 format)' }, 400);
    }

    // Parse month to compute date range for task breakdown
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    if (isNaN(year) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return jsonResponse({ error: 'Invalid month format. Expected YYYY-MM-01' }, 400);
    }

    const rangeStart = month;
    const rangeEnd = monthNum === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;

    // --- Service-role client ---
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Look up company ---
    const { data: companies, error: companyError } = await supabase
      .from('companies')
      .select('id, client_id, client_name, display_name')
      .or(`client_name.eq.${companyName},display_name.eq.${companyName}`)
      .limit(1);

    if (companyError) throw companyError;
    if (!companies || companies.length === 0) {
      return jsonResponse({ error: `Company "${companyName}" not found` }, 404);
    }

    const company = companies[0];
    const companyUUID = company.id;
    const companyClientId = company.client_id;
    const companyDisplayName = company.display_name || company.client_name;

    // --- Three parallel data queries ---
    const [summaryResult, entriesResult, projectsResult, groupMembersResult, billingsResult] =
      await Promise.all([
        // 1. Project billing summary (filtered by month + company)
        supabase
          .from('v_canonical_project_monthly_summary')
          .select(`
            *,
            projects!inner (project_name, project_id),
            companies!inner (client_id, client_name, display_name)
          `)
          .eq('summary_month', month)
          .eq('company_id', companyUUID),

        // 2a. Timesheet entries for the month (all companies — filtered after resolution)
        supabase
          .from('v_timesheet_entries')
          .select('project_id, task_name, total_minutes')
          .gte('work_date', rangeStart)
          .lt('work_date', rangeEnd),

        // 2b. All projects (for external ↔ internal ID mapping)
        supabase
          .from('projects')
          .select('id, project_id'),

        // 2c. Project group members (for member → primary resolution)
        supabase
          .from('project_group_members')
          .select('member_project_id, group:project_groups!inner(primary_project_id)'),

        // 3. Billings with transactions for the month
        supabase.rpc('get_billings_with_transactions', {
          p_start_month: month,
          p_end_month: month,
        }),
      ]);

    if (summaryResult.error) throw summaryResult.error;
    if (entriesResult.error) throw entriesResult.error;
    if (projectsResult.error) throw projectsResult.error;
    if (groupMembersResult.error) throw groupMembersResult.error;
    if (billingsResult.error) throw billingsResult.error;

    // --- Build project ID mappings ---
    const externalToInternal = new Map<string, string>();
    const internalToExternal = new Map<string, string>();
    for (const p of projectsResult.data || []) {
      externalToInternal.set(p.project_id, p.id);
      internalToExternal.set(p.id, p.project_id);
    }

    // Build member internal UUID → primary canonical external project_id
    const memberToPrimaryExternal = new Map<string, string>();
    for (const gm of groupMembersResult.data || []) {
      const group = gm.group as unknown as { primary_project_id: string };
      const primaryExternal = internalToExternal.get(group.primary_project_id);
      if (primaryExternal) {
        memberToPrimaryExternal.set(gm.member_project_id, primaryExternal);
      }
    }

    // --- Build project config map from summary data ---
    const companyProjectExternalIds = new Set<string>();
    const projectConfigMap = new Map<string, {
      projectName: string;
      billedHours: number;
      billedRevenueCents: number;
      rateUsed: number;
      roundingUsed: number;
    }>();

    for (const row of (summaryResult.data as SummaryRow[]) || []) {
      const externalId = row.projects.project_id;
      companyProjectExternalIds.add(externalId);
      projectConfigMap.set(externalId, {
        projectName: row.projects.project_name,
        billedHours: Number(row.billed_hours),
        billedRevenueCents: Number(row.billed_revenue_cents),
        rateUsed: Number(row.rate_used),
        roundingUsed: Number(row.rounding_used),
      });
    }

    // --- Build task breakdown (grouped by canonical external project ID, company only) ---
    const tasksByProject = new Map<string, Map<string, number>>();

    for (const entry of entriesResult.data || []) {
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

    // --- Process billings (milestones + fixed billings) ---
    const billingRows = (billingsResult.data as BillingRow[]) || [];

    // Group billings by billing_id, accumulate transaction totals
    const billingMap = new Map<string, {
      id: string;
      companyClientId: string;
      type: string;
      linkedProjectId: string | null;
      totalCents: number;
    }>();

    for (const row of billingRows) {
      if (!billingMap.has(row.billing_id)) {
        billingMap.set(row.billing_id, {
          id: row.billing_id,
          companyClientId: row.company_client_id,
          type: row.billing_type,
          linkedProjectId: row.linked_project_id,
          totalCents: 0,
        });
      }
      if (row.transaction_id && row.amount_cents !== null) {
        billingMap.get(row.billing_id)!.totalCents += row.amount_cents;
      }
    }

    // Build milestoneByExternalProjectId (externalId → totalCents)
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

    // Sum filtered billing cents for target company (excludes linked milestones)
    let companyFilteredBillingCents = 0;
    for (const billing of billingMap.values()) {
      if (linkedMilestoneBillingIds.has(billing.id)) continue;
      if (billing.companyClientId === companyClientId) {
        companyFilteredBillingCents += billing.totalCents;
      }
    }

    // --- Assemble project-level output ---
    const projects: ProjectOutput[] = [];
    let companyBilledRevenue = 0;
    let companyBilledHours = 0;

    for (const [externalId, config] of projectConfigMap) {
      const billedRevenue = roundCurrency(config.billedRevenueCents / 100);
      companyBilledRevenue = roundCurrency(companyBilledRevenue + billedRevenue);
      companyBilledHours = roundHours(companyBilledHours + config.billedHours);

      // Per-project revenue with milestone override
      const milestoneCents = milestoneByExternalProjectId.get(externalId);
      const projectRevenue = milestoneCents !== undefined
        ? roundCurrency(milestoneCents / 100)
        : billedRevenue;

      // Build task list with per-task rounding
      const rawTasks = tasksByProject.get(externalId);
      const tasks: TaskOutput[] = [];
      if (rawTasks) {
        for (const [taskName, actualMinutes] of rawTasks) {
          const roundedMinutes = applyRounding(actualMinutes, config.roundingUsed);
          const hours = roundHours(roundedMinutes / 60);
          tasks.push({ taskName, hours });
        }
        // Sort by hours descending
        tasks.sort((a, b) => b.hours - a.hours);
      }

      projects.push({
        projectName: config.projectName,
        rate: config.rateUsed,
        projectHours: config.billedHours,
        projectRevenue,
        projectRevenueFormatted: formatCurrency(projectRevenue),
        tasks,
      });
    }

    // Sort projects alphabetically
    projects.sort((a, b) => a.projectName.localeCompare(b.projectName));

    // --- Company total revenue (matching RevenuePage line 564) ---
    // milestoneAdj = Σ (milestoneCents/100 - billedRevenue) for milestone-linked projects
    let milestoneAdj = 0;
    for (const [externalId, config] of projectConfigMap) {
      const milestoneCents = milestoneByExternalProjectId.get(externalId);
      if (milestoneCents !== undefined) {
        milestoneAdj += roundCurrency(milestoneCents / 100) - roundCurrency(config.billedRevenueCents / 100);
      }
    }

    const companyTotalRevenue = roundCurrency(
      companyBilledRevenue + (companyFilteredBillingCents / 100) + milestoneAdj
    );

    // Build month label
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthLabel = `${monthNames[monthNum - 1]} ${year}`;

    return jsonResponse({
      reportTitle: `Customer Revenue Report - ${monthLabel}`,
      month,
      company: {
        companyName: companyDisplayName,
        companyHours: companyBilledHours,
        companyRevenue: companyTotalRevenue,
        companyRevenueFormatted: formatCurrency(companyTotalRevenue),
        projects,
      },
      totalHours: companyBilledHours,
      totalRevenue: companyTotalRevenue,
      totalRevenueFormatted: formatCurrency(companyTotalRevenue),
    });
  } catch (error) {
    console.error('customer-revenue-report error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});
