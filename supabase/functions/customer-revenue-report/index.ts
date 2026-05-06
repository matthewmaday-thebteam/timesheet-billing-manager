import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jwtVerify } from 'https://deno.land/x/jose@v5.2.2/index.ts';

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

// --- Paginated fetch for task_monthly_totals (defense-in-depth) ---
// PostgREST caps result sets at ~1000 rows by default. The integrity assertion
// (Σ task rounded minutes == summary.rounded_minutes per project-month) would
// catch silent truncation today, but we paginate explicitly so a pathological
// (company × projects × tasks × clients) matrix can never trip the cap.
// Mirrors the helper shape used in supabase/functions/send-weekly-revenue-report.
// Errors surface immediately — no silent fallbacks.
async function fetchAllRowsTMT<T>(
  queryBuilder: ReturnType<ReturnType<typeof createClient>['from']>,
  pageSize = 1000,
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  const allData: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    allData.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: allData, error: null };
}

// --- Utility functions (replicated from src/utils/billing.ts) ---

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
  project_id: string; // internal canonical UUID
  billed_hours: number;
  rounded_minutes: number;
  rounded_hours: number;
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

interface TaskMonthlyTotalRow {
  project_id: string; // canonical project UUID
  task_name: string;
  client_id: string;
  rounded_entry_minutes: number;
  rounded_task_minutes: number;
}

interface RoundingModeRow {
  project_id: string;
  effective_rounding_mode: 'entry' | 'task';
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
    const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET')!;
    const token = authHeader.replace('Bearer ', '');

    // Verify the JWT signature cryptographically and check the role claim.
    try {
      const secret = new TextEncoder().encode(jwtSecret);
      const { payload } = await jwtVerify(token, secret);
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

    // --- Parallel data queries ---
    // Note: task rows are now sourced from task_monthly_totals (mig-093/094/101),
    // which stores canonical-project per-(project, task, client, month) totals
    // with both per-entry-rounded and per-task-rounded minute columns. The
    // rounding mode (entry vs task) for each project-month is read from the
    // billing engine hierarchy (get_all_project_roundings_for_month — mig-093),
    // matching the same source-of-truth that recalculate_project_month uses
    // when populating project_monthly_summary.
    const [summaryResult, billingsResult, roundingsResult] =
      await Promise.all([
        // 1. Project billing summary (filtered by month + company).
        //    project_id is the canonical UUID (v_canonical excludes member rows
        //    per mig-050). rounded_minutes is the source-of-truth aggregate that
        //    task rows must sum to.
        supabase
          .from('v_canonical_project_monthly_summary')
          .select(`
            project_id,
            billed_hours,
            rounded_minutes,
            rounded_hours,
            billed_revenue_cents,
            rate_used,
            rounding_used,
            projects!inner (project_name, project_id),
            companies!inner (client_id, client_name, display_name)
          `)
          .eq('summary_month', month)
          .eq('company_id', companyUUID),

        // 2. Billings with transactions for the month
        supabase.rpc('get_billings_with_transactions', {
          p_start_month: month,
          p_end_month: month,
        }),

        // 3. Rounding mode + increment per canonical project for this month
        //    (mig-093 hierarchy: explicit row -> backfill -> inherited -> default
        //    'task' for mode, default increment for missing rows).
        supabase.rpc('get_all_project_roundings_for_month', { p_month: month }),
      ]);

    if (summaryResult.error) throw summaryResult.error;
    if (billingsResult.error) throw billingsResult.error;
    if (roundingsResult.error) throw roundingsResult.error;

    const summaryRows = (summaryResult.data as SummaryRow[]) || [];

    // --- Build project ID mappings (still needed for milestone linking below) ---
    const internalToExternal = new Map<string, string>();
    for (const row of summaryRows) {
      internalToExternal.set(row.project_id, row.projects.project_id);
    }

    // --- Build project config map keyed on canonical project UUID ---
    const companyCanonicalProjectIds: string[] = [];
    const projectConfigMap = new Map<string, {
      canonicalProjectId: string;
      externalId: string;
      projectName: string;
      billedHours: number;
      billedRevenueCents: number;
      roundedMinutes: number;
      roundedHours: number;
      rateUsed: number;
      roundingUsed: number;
    }>();

    for (const row of summaryRows) {
      const externalId = row.projects.project_id;
      const canonicalProjectId = row.project_id;
      companyCanonicalProjectIds.push(canonicalProjectId);
      projectConfigMap.set(externalId, {
        canonicalProjectId,
        externalId,
        projectName: row.projects.project_name,
        billedHours: Number(row.billed_hours),
        billedRevenueCents: Number(row.billed_revenue_cents),
        roundedMinutes: Number(row.rounded_minutes),
        roundedHours: Number(row.rounded_hours),
        rateUsed: Number(row.rate_used),
        roundingUsed: Number(row.rounding_used),
      });
    }

    // --- Build effective_rounding_mode lookup keyed on canonical project UUID ---
    // mig-093 contract: get_all_project_roundings_for_month returns 'task' as
    // the default fallback when no explicit/inherited row exists.
    const roundingModeByProject = new Map<string, 'entry' | 'task'>();
    for (const row of (roundingsResult.data as RoundingModeRow[]) || []) {
      const mode: 'entry' | 'task' = row.effective_rounding_mode === 'entry' ? 'entry' : 'task';
      roundingModeByProject.set(row.project_id, mode);
    }

    // --- Fetch task_monthly_totals for the canonical projects in this month ---
    // Keyed on (project_id, summary_month, task_name, client_id).
    // No silent fallback: if a project has rounded_minutes > 0 in summary but
    // no TMT rows, that's a data integrity bug we surface, not paper over.
    let taskTotalsRows: TaskMonthlyTotalRow[] = [];
    if (companyCanonicalProjectIds.length > 0) {
      const tmtQuery = supabase
        .from('task_monthly_totals')
        .select('project_id, task_name, client_id, rounded_entry_minutes, rounded_task_minutes')
        .eq('summary_month', month)
        .in('project_id', companyCanonicalProjectIds);

      const { data: tmtData, error: tmtError } =
        await fetchAllRowsTMT<TaskMonthlyTotalRow>(tmtQuery);

      if (tmtError) throw tmtError;
      taskTotalsRows = tmtData || [];
    }

    // Group TMT rows by canonical project UUID -> (task_name -> rounded_minutes).
    // Multiple TMT rows for the same (project, task) but different client_ids
    // are summed — the customer-revenue payload doesn't break out by client_id.
    const tasksByCanonicalProject = new Map<string, Map<string, number>>();
    for (const tmt of taskTotalsRows) {
      const canonicalProjectId = tmt.project_id;
      const mode = roundingModeByProject.get(canonicalProjectId) ?? 'task';
      const roundedMinutes = mode === 'entry'
        ? Number(tmt.rounded_entry_minutes)
        : Number(tmt.rounded_task_minutes);

      if (!tasksByCanonicalProject.has(canonicalProjectId)) {
        tasksByCanonicalProject.set(canonicalProjectId, new Map());
      }
      const taskMap = tasksByCanonicalProject.get(canonicalProjectId)!;
      const taskName = tmt.task_name || 'No Task';
      taskMap.set(taskName, (taskMap.get(taskName) || 0) + roundedMinutes);
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

      // Build task list from pre-computed task_monthly_totals (mig-093/094):
      // rounded minutes already reflect the project-month's effective rounding
      // mode and increment, matching what recalculate_project_month consumed.
      const rawTasks = tasksByCanonicalProject.get(config.canonicalProjectId);
      const tasks: TaskOutput[] = [];
      let taskRoundedMinutesSum = 0;
      if (rawTasks) {
        for (const [taskName, roundedMinutes] of rawTasks) {
          taskRoundedMinutesSum += roundedMinutes;
          tasks.push({ taskName, hours: roundHours(roundedMinutes / 60) });
        }
        // Sort by hours descending
        tasks.sort((a, b) => b.hours - a.hours);
      }

      // Round-trip integrity (per-project, pre-limit aggregate):
      // sum(task rounded minutes) MUST equal summary.rounded_minutes for the
      // project-month. If they diverge, task_monthly_totals is stale relative
      // to project_monthly_summary — fail loudly rather than emit numbers
      // that don't tie back to the canonical aggregate (mig-094 contract).
      if (Math.abs(config.roundedMinutes - taskRoundedMinutesSum) > 0) {
        const errMsg =
          `Task-row rounded minutes (${taskRoundedMinutesSum}) do not equal ` +
          `project_monthly_summary.rounded_minutes (${config.roundedMinutes}) for ` +
          `project=${config.externalId} canonical_uuid=${config.canonicalProjectId} ` +
          `month=${month}. task_monthly_totals may be stale — re-run ` +
          `populate_task_monthly_totals for this range and retry.`;
        console.error('customer-revenue-report rounding integrity failure', {
          companyId: companyUUID,
          companyClientId,
          month,
          projectExternalId: config.externalId,
          canonicalProjectId: config.canonicalProjectId,
          summaryRoundedMinutes: config.roundedMinutes,
          taskRowSumMinutes: taskRoundedMinutesSum,
          tmtRowsFound: rawTasks ? rawTasks.size : 0,
        });
        throw new Error(errMsg);
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

    // Compute period start/end dates for the reporting month
    const periodStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(year, monthNum, 0).getDate(); // day 0 of next month = last day of this month
    const periodEnd = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    return jsonResponse({
      reportTitle: `Customer Revenue Report - ${monthLabel}`,
      month,
      periodStart,
      periodEnd,
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
