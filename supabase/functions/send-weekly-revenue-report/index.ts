import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: send-weekly-revenue-report
// =============================================================================
// Sends weekly CSV revenue reports to project managers for companies that have
// opted in via `send_weekly_report = true` on their projects.
//
// Three modes:
//   POST with no body or {}     — Automated: all opted-in companies (cron)
//   POST with { companyId, weekStart, weekEnd } — Manual: single company resend
//   POST with { companyId, weekStart, weekEnd, generateOnly: true } — Generate + store CSV only (no email)
//
// When generateOnly is true, PM emails are not required. The CSV is stored in
// the weekly-reports bucket and a row is upserted into weekly_reports with
// sent_at/sent_to set to null.
//
// Auth: service-role JWT only (same as customer-revenue-report)
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
// Paginated fetch — guarantees all rows regardless of Supabase default limits
// =============================================================================

async function fetchAllRows<T>(
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

// =============================================================================
// Utility functions (replicated from src/utils/billing.ts)
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

// =============================================================================
// CSV helpers
// =============================================================================

/** Escape a CSV field: wrap in double quotes, double any internal quotes. */
function csvField(value: string | number): string {
  const str = typeof value === 'number' ? String(value) : value;
  return `"${str.replace(/"/g, '""')}"`;
}

/** Join fields into a CSV row. */
function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

// =============================================================================
// Date helpers
// =============================================================================

/** Get the Monday of the prior week (relative to a given date, default now). */
function getPriorWeekRange(refDate?: Date): { weekStart: string; weekEnd: string } {
  const d = refDate ? new Date(refDate) : new Date();
  // Set to Monday of current week, then subtract 7 days to get prior Monday
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diffToMonday - 7);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

/** Shift a YYYY-MM-DD date string by a whole number of days (UTC-safe). */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build week label: "Mar 23" from a weekStart date string (YYYY-MM-DD). */
function buildWeekLabel(weekStart: string): string {
  const monthAbbrevs = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const [, monthStr, dayStr] = weekStart.split('-');
  const monthIdx = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  return `${monthAbbrevs[monthIdx]} ${day}`;
}

/** Build month label: "March 2026" from a date string (YYYY-MM-DD). */
function buildMonthLabel(dateStr: string): string {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const [yearStr, monthStr] = dateStr.split('-');
  const monthIdx = parseInt(monthStr, 10) - 1;
  return `${monthNames[monthIdx]} ${yearStr}`;
}

/** Get the first-of-month string for a given date string. */
function toSummaryMonth(dateStr: string): string {
  const [yearStr, monthStr] = dateStr.split('-');
  return `${yearStr}-${monthStr}-01`;
}

// =============================================================================
// Zero-week classification
// =============================================================================
// Replicated from src/lib/weeklyReports/classifyZeroWeek.ts — Deno cannot
// import from src/, so this follows the same convention as the billing helpers
// replicated from src/utils/billing.ts above. The unit tests in
// scripts/weekly-report-tests/classifyZeroWeek.test.ts are the specification;
// keep the two copies in sync.
// =============================================================================

/** How many weeks of prior history to weigh when judging an empty week. */
const PRIOR_HISTORY_WEEKS = 4;

/** Alert type raised when a report-enabled company produces no report. */
const WEEKLY_REPORT_ALERT_TYPE = 'weekly_report_not_sent';

type ZeroWeekClassification = 'expected' | 'anomalous';

/** How many of the prior weeks actually reported hours. */
function countWeeksWithHours(priorWeekHours: readonly number[]): number {
  return priorWeekHours.reduce((count, hours) => (hours > 0 ? count + 1 : count), 0);
}

/** Total hours across the prior weeks, rounded to 2dp for display. */
function sumPriorWeekHours(priorWeekHours: readonly number[]): number {
  const total = priorWeekHours.reduce((sum, hours) => sum + (hours > 0 ? hours : 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Classify a company-week that produced no timesheet entries.
 *
 * Any prior week with hours makes this week's silence anomalous — that is the
 * 2026-09-10 signature. No prior week with hours, including no history at all
 * (a newly enabled company), is an expected zero: a paused client or a
 * company-wide holiday must never be alerted on.
 */
function classifyZeroWeek(priorWeekHours: readonly number[]): ZeroWeekClassification {
  return countWeeksWithHours(priorWeekHours) >= 1 ? 'anomalous' : 'expected';
}

// =============================================================================
// Types
// =============================================================================

interface CompanyGroup {
  companyUUID: string;
  companyDisplayName: string;
  companySlug: string;
  projectIds: string[]; // internal UUIDs
}

interface ReportResult {
  company: string;
  weekLabel: string;
  pmEmails: string[];
  taskCount: number;
  totalHours: number;
  totalRevenue: number;
  emailSent: boolean;
  storagePath: string | null;
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
    // --- Authenticate caller ---
    // Browser calls: validate user via getUser() (Verify JWT is OFF in dashboard)
    // Cron calls: service_role key is trusted directly
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey =
      Deno.env.get('NEW_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // If the token IS the service role key, it's a cron/server call — trusted
    // Otherwise, validate as a user session via getUser()
    if (token !== supabaseServiceKey) {
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authError } = await anonClient.auth.getUser();
      if (authError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
    }

    // --- Parse request body ---
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is valid (automated cron trigger)
    }

    const manualCompanyId = body.companyId as string | undefined;
    const manualWeekStart = body.weekStart as string | undefined;
    const manualWeekEnd = body.weekEnd as string | undefined;
    const generateOnly = body.generateOnly === true;
    const isManual = !!(manualCompanyId && manualWeekStart && manualWeekEnd);

    if (manualCompanyId && (!manualWeekStart || !manualWeekEnd)) {
      return jsonResponse({
        error: 'Manual resend requires companyId, weekStart, and weekEnd',
      }, 400);
    }

    // --- Determine date range ---
    let weekStart: string;
    let weekEnd: string;

    if (isManual) {
      weekStart = manualWeekStart!;
      weekEnd = manualWeekEnd!;
    } else {
      const range = getPriorWeekRange();
      weekStart = range.weekStart;
      weekEnd = range.weekEnd;
    }

    const weekLabel = buildWeekLabel(weekStart);
    const monthLabel = buildMonthLabel(weekStart);
    const summaryMonth = toSummaryMonth(weekStart);

    // --- Service-role client ---
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // =========================================================================
    // STEP 1: Find all report-enabled projects, grouped by company
    // =========================================================================

    let projectQuery = supabase
      .from('projects')
      .select(`
        id,
        project_id,
        project_name,
        rate,
        company_id,
        companies!inner (
          id,
          client_id,
          client_name,
          display_name
        )
      `);

    if (isManual) {
      // Manual resend: send for ALL projects in this company (ignore the flag)
      projectQuery = projectQuery.eq('company_id', manualCompanyId);
    } else {
      // Automated cron: only projects opted in
      projectQuery = projectQuery.eq('send_weekly_report', true);
    }

    const { data: reportProjects, error: projectError } = await projectQuery;
    if (projectError) throw projectError;

    if (!reportProjects || reportProjects.length === 0) {
      return jsonResponse({
        success: true,
        reports: [],
        errors: [],
        message: 'No projects with send_weekly_report enabled',
      });
    }

    // Group projects by company
    const companyMap = new Map<string, CompanyGroup>();
    for (const proj of reportProjects) {
      const co = proj.companies as unknown as {
        id: string;
        client_id: string;
        client_name: string;
        display_name: string | null;
      };
      const companyUUID = co.id;

      if (!companyMap.has(companyUUID)) {
        const displayName = co.display_name || co.client_name;
        companyMap.set(companyUUID, {
          companyUUID,
          companyDisplayName: displayName,
          companySlug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          projectIds: [],
        });
      }
      companyMap.get(companyUUID)!.projectIds.push(proj.id);
    }

    // =========================================================================
    // STEP 2: Fetch shared data (all companies at once for efficiency)
    // =========================================================================

    const allProjectInternalIds = reportProjects.map((p) => p.id);
    const companyUUIDs = Array.from(companyMap.keys());

    const [
      summaryResult,
      entriesResult,
      allProjectsResult,
      groupMembersResult,
      pmResult,
      priorReportsResult,
    ] = await Promise.all([
      // 2a. Billing summary for the month containing the week
      supabase
        .from('v_canonical_project_monthly_summary')
        .select('*')
        .eq('summary_month', summaryMonth)
        .in('project_id', allProjectInternalIds),

      // 2b. Timesheet entries for the week (all projects — filtered after resolution)
      // Uses paginated fetch to guarantee all rows are returned.
      fetchAllRows<{ project_id: string; task_name: string; total_minutes: number }>(
        supabase
          .from('v_timesheet_entries')
          .select('project_id, task_name, total_minutes')
          .gte('work_date', weekStart)
          .lte('work_date', weekEnd),
      ),

      // 2c. All projects (for external <-> internal ID mapping)
      supabase
        .from('projects')
        .select('id, project_id'),

      // 2d. Project group members (for member -> primary resolution)
      supabase
        .from('project_group_members')
        .select('member_project_id, group:project_groups!inner(primary_project_id)'),

      // 2e. Project managers with emails
      supabase
        .from('project_managers')
        .select(`
          project_id,
          resources!inner (
            id,
            first_name,
            last_name,
            email
          )
        `)
        .in('project_id', allProjectInternalIds),

      // 2f. Prior-week report history, for classifying an empty week.
      // Rides along in this Promise.all so it costs no extra round-trip.
      // Served by idx_weekly_reports_company (071:57).
      supabase
        .from('weekly_reports')
        .select('company_id, week_start, total_hours')
        .in('company_id', companyUUIDs)
        .gte('week_start', addDays(weekStart, -7 * PRIOR_HISTORY_WEEKS))
        .lt('week_start', weekStart),
    ]);

    if (summaryResult.error) throw summaryResult.error;
    if (entriesResult.error) throw entriesResult.error;
    if (allProjectsResult.error) throw allProjectsResult.error;
    if (groupMembersResult.error) throw groupMembersResult.error;
    if (pmResult.error) throw pmResult.error;
    // priorReportsResult is deliberately NOT thrown on. It feeds the zero-week
    // classifier only, and a diagnostic query must never stop a client email.
    // Handled below, where an unavailable history is treated as suspicious.

    // =========================================================================
    // STEP 3: Build lookup maps
    // =========================================================================

    // External project_id <-> internal UUID mappings
    const externalToInternal = new Map<string, string>();
    const internalToExternal = new Map<string, string>();
    for (const p of allProjectsResult.data || []) {
      externalToInternal.set(p.project_id, p.id);
      internalToExternal.set(p.id, p.project_id);
    }

    // Member internal UUID -> primary canonical external project_id
    const memberToPrimaryExternal = new Map<string, string>();
    for (const gm of groupMembersResult.data || []) {
      const group = gm.group as unknown as { primary_project_id: string };
      const primaryExternal = internalToExternal.get(group.primary_project_id);
      if (primaryExternal) {
        memberToPrimaryExternal.set(gm.member_project_id, primaryExternal);
      }
    }

    // Summary config keyed by internal project UUID
    const summaryByProjectUUID = new Map<string, {
      rateUsed: number;
      roundingUsed: number;
    }>();
    for (const row of summaryResult.data || []) {
      summaryByProjectUUID.set(row.project_id, {
        rateUsed: Number(row.rate_used),
        roundingUsed: Number(row.rounding_used),
      });
    }

    // Project name + rate lookup by internal UUID (from the initial project query)
    const projectInfoByUUID = new Map<string, {
      projectName: string;
      externalId: string;
      fallbackRate: number;
      companyUUID: string;
    }>();
    for (const proj of reportProjects) {
      projectInfoByUUID.set(proj.id, {
        projectName: proj.project_name,
        externalId: proj.project_id,
        fallbackRate: proj.rate ? Number(proj.rate) : 0,
        companyUUID: proj.company_id,
      });
    }

    // PM emails grouped by company UUID (deduplicated)
    const pmEmailsByCompany = new Map<string, {
      emails: string[];
      firstName: string; // first PM's first name for greeting
    }>();
    for (const pm of pmResult.data || []) {
      const r = pm.resources as unknown as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      };
      if (!r.email) continue;

      const projectUUID = pm.project_id as string;
      const projInfo = projectInfoByUUID.get(projectUUID);
      if (!projInfo) continue;
      const companyUUID = projInfo.companyUUID;

      if (!pmEmailsByCompany.has(companyUUID)) {
        pmEmailsByCompany.set(companyUUID, {
          emails: [],
          firstName: r.first_name || 'Team',
        });
      }
      const entry = pmEmailsByCompany.get(companyUUID)!;
      if (!entry.emails.includes(r.email)) {
        entry.emails.push(r.email);
      }
    }

    // =========================================================================
    // STEP 4: Build task breakdown per canonical external project ID
    // =========================================================================

    // Set of canonical external IDs for ALL report-enabled projects
    const reportExternalIds = new Set<string>();
    for (const proj of reportProjects) {
      reportExternalIds.add(proj.project_id);
    }

    // Tasks grouped by canonical external project_id
    const tasksByExternalProject = new Map<string, Map<string, number>>();

    for (const entry of entriesResult.data || []) {
      if (!entry.project_id || entry.total_minutes <= 0) continue;

      // Resolve to canonical external project ID
      const internalId = externalToInternal.get(entry.project_id);
      let canonicalExternal = entry.project_id;
      if (internalId && memberToPrimaryExternal.has(internalId)) {
        canonicalExternal = memberToPrimaryExternal.get(internalId)!;
      }

      // Filter to report-enabled projects only
      if (!reportExternalIds.has(canonicalExternal)) continue;

      const taskName = entry.task_name || 'No Task';

      if (!tasksByExternalProject.has(canonicalExternal)) {
        tasksByExternalProject.set(canonicalExternal, new Map());
      }
      const taskMap = tasksByExternalProject.get(canonicalExternal)!;
      taskMap.set(taskName, (taskMap.get(taskName) || 0) + entry.total_minutes);
    }

    // =========================================================================
    // STEP 5: Process each company — build CSV, send email
    // =========================================================================

    const SENDGRID_KEY = Deno.env.get('SENDGRID_KEY')!;
    const SENDGRID_SENDER = Deno.env.get('SENDGRID_SENDER')!;

    const reports: ReportResult[] = [];
    const errors: string[] = [];

    // --- Prior-week history per company (drives zero-week classification) ---
    const priorWeekHoursByCompany = new Map<string, number[]>();
    let priorHistoryAvailable = true;

    if (priorReportsResult.error) {
      // An unknown history is not an empty history. Treat it as suspicious
      // below rather than classifying every empty week as expected — silence
      // is precisely what hid the 2026-09-10 incident for four weeks.
      priorHistoryAvailable = false;
      const msg = priorReportsResult.error.message;
      console.error(`[send-weekly-revenue-report] Prior-week history lookup failed: ${msg}`);
      errors.push(`Prior-week history lookup failed: ${msg}`);
    } else {
      for (const row of priorReportsResult.data || []) {
        const historyCompanyId = row.company_id as string;
        const hours = Number(row.total_hours) || 0;
        const existing = priorWeekHoursByCompany.get(historyCompanyId);
        if (existing) existing.push(hours);
        else priorWeekHoursByCompany.set(historyCompanyId, [hours]);
      }
    }

    // --- Distinguishable alert labels ---
    // Two `companies` rows can legitimately share a display name (confirmed
    // intentional). The dashboard renders only alert.title
    // (src/components/Dashboard.tsx:477-505), so a shared name needs a
    // company_id prefix or the two alerts are indistinguishable.
    const displayNameCounts = new Map<string, number>();
    for (const group of companyMap.values()) {
      displayNameCounts.set(
        group.companyDisplayName,
        (displayNameCounts.get(group.companyDisplayName) || 0) + 1,
      );
    }
    const alertLabel = (group: CompanyGroup): string => (
      (displayNameCounts.get(group.companyDisplayName) || 0) > 1
        ? `${group.companyDisplayName} [${group.companyUUID.slice(0, 8)}]`
        : group.companyDisplayName
    );

    /** Companies that produced a report this run — drives alert auto-resolve. */
    const reportedCompanyIds = new Set<string>();

    /**
     * Raise a weekly_report_not_sent alert.
     *
     * Never throws and never blocks a client email: an alerting failure is
     * logged and swallowed, matching the non-blocking convention at
     * sync-clickup-timesheets/index.ts:1216-1228.
     *
     * sync_alerts carries UNIQUE (alert_type, entity_id) WHERE resolved_at IS
     * NULL (078:36-38), so the existence check comes first — the same shape as
     * every other alert block in this codebase.
     */
    const raiseReportNotSentAlert = async (
      alertCompanyId: string,
      entityName: string,
      title: string,
      metadata: Record<string, unknown>,
    ): Promise<void> => {
      try {
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', WEEKLY_REPORT_ALERT_TYPE)
          .eq('entity_id', alertCompanyId)
          .is('resolved_at', null)
          .maybeSingle();

        if (existingAlert) return;

        const { error: alertError } = await supabase
          .from('sync_alerts')
          .insert({
            alert_type: WEEKLY_REPORT_ALERT_TYPE,
            severity: 'error',
            title,
            entity_type: 'company',
            entity_id: alertCompanyId,
            entity_name: entityName,
            metadata,
          });

        if (alertError) {
          console.error(
            `[send-weekly-revenue-report] Alert insert failed for ${alertCompanyId}: ${alertError.message}`,
          );
        }
      } catch (alertErr) {
        const msg = alertErr instanceof Error ? alertErr.message : String(alertErr);
        console.error(
          `[send-weekly-revenue-report] Alert write failed for ${alertCompanyId} (non-blocking): ${msg}`,
        );
      }
    };

    for (const [companyUUID, companyGroup] of companyMap) {
      try {
        // --- Check for PM emails ---
        const pmInfo = pmEmailsByCompany.get(companyUUID);
        if (!generateOnly && (!pmInfo || pmInfo.emails.length === 0)) {
          const label = alertLabel(companyGroup);
          console.warn(
            `[send-weekly-revenue-report] No PM emails for company "${companyGroup.companyDisplayName}" — skipping`,
          );

          // A company with send_weekly_report = true and no PM email is
          // unconditionally a configuration error — there is no
          // legitimate-zero analogue here — so this branch always alerts.
          // No weekly_reports row is written: no CSV was produced.
          // This branch continues, so the no-entries branch below cannot also
          // alert for the same company in the same run — which matters,
          // because sync_alerts allows one active alert per (type, entity).
          await raiseReportNotSentAlert(
            companyUUID,
            label,
            `Weekly report not sent for "${label}" week of ${weekLabel} — no project manager email on file (configuration error)`,
            {
              reason: 'no_pm_emails',
              week_start: weekStart,
              week_end: weekEnd,
              project_count: companyGroup.projectIds.length,
            },
          );
          continue;
        }

        // --- Build project-level data for this company ---
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

        const companyProjects: ProjectOutput[] = [];
        let companyTotalHours = 0;
        let companyTotalRevenue = 0;
        let companyTaskCount = 0;

        for (const projectUUID of companyGroup.projectIds) {
          const projInfo = projectInfoByUUID.get(projectUUID);
          if (!projInfo) continue;

          const externalId = projInfo.externalId;

          // Get rate and rounding from summary, fall back to project rate
          const summary = summaryByProjectUUID.get(projectUUID);
          const rate = summary ? summary.rateUsed : projInfo.fallbackRate;
          const rounding = summary ? summary.roundingUsed : 15;

          // Get tasks for this project
          const rawTasks = tasksByExternalProject.get(externalId);
          if (!rawTasks || rawTasks.size === 0) continue; // No entries this week

          const tasks: TaskOutput[] = [];
          let projectTotalHours = 0;
          let projectTotalRevenue = 0;

          for (const [taskName, actualMinutes] of rawTasks) {
            const roundedMinutes = applyRounding(actualMinutes, rounding);
            const hours = roundHours(roundedMinutes / 60);
            const taskRevenue = roundCurrency(hours * rate);
            tasks.push({ taskName, hours });
            projectTotalHours += hours;
            projectTotalRevenue += taskRevenue;
          }

          // Sort tasks by hours descending
          tasks.sort((a, b) => b.hours - a.hours);

          const projectHours = roundHours(projectTotalHours);
          const projectRevenue = roundCurrency(projectTotalRevenue);

          companyProjects.push({
            projectName: projInfo.projectName,
            rate,
            projectHours,
            projectRevenue,
            projectRevenueFormatted: formatCurrency(projectRevenue),
            tasks,
          });

          companyTotalHours = roundHours(companyTotalHours + projectHours);
          companyTotalRevenue = roundCurrency(companyTotalRevenue + projectRevenue);
          companyTaskCount += tasks.length;
        }

        // -------------------------------------------------------------------
        // No timesheet entries for this company this week
        // -------------------------------------------------------------------
        // Until 2026-09 this was a bare `continue`: no row written, no error
        // appended, and a successful return. A ClickUp permission change
        // blanked four weeks of attribution and nothing surfaced it. Both
        // halves of the fix matter — the zero-marker row (its ABSENCE is what
        // hid the incident) and, when the silence is out of character for this
        // company, a loud alert.
        if (companyProjects.length === 0) {
          const priorWeeks = priorWeekHoursByCompany.get(companyUUID) || [];
          const priorWeeksWithHours = countWeeksWithHours(priorWeeks);
          const prior4wkHours = sumPriorWeekHours(priorWeeks);
          // An unavailable history fails loud, never silent.
          const classification: ZeroWeekClassification = priorHistoryAvailable
            ? classifyZeroWeek(priorWeeks)
            : 'anomalous';

          // Zero-marker row, written in BOTH cases. ignoreDuplicates makes
          // this INSERT ... ON CONFLICT DO NOTHING on the same
          // (company_id, week_start) key, so a marker can never overwrite a
          // real, delivered report row with zeros and a null storage_path.
          // v_weekly_report_availability.has_report requires
          // storage_path IS NOT NULL (migration 134), so markers never read as
          // reports on the dashboard.
          const { error: markerError } = await supabase
            .from('weekly_reports')
            .upsert({
              company_id: companyUUID,
              company_name: companyGroup.companyDisplayName,
              week_start: weekStart,
              week_end: weekEnd,
              report_year: parseInt(weekStart.split('-')[0], 10),
              report_month: parseInt(weekStart.split('-')[1], 10),
              total_hours: 0,
              total_revenue_cents: 0,
              project_count: 0,
              task_count: 0,
              storage_path: null,
              file_size_bytes: null,
              generated_at: new Date().toISOString(),
              sent_at: null,
              sent_to: null,
            }, {
              onConflict: 'company_id,week_start',
              ignoreDuplicates: true,
            });
          if (markerError) {
            console.error(
              `[send-weekly-revenue-report] Zero-marker upsert error for "${companyGroup.companyDisplayName}": ${markerError.message}`,
            );
          }

          if (classification === 'anomalous') {
            const label = alertLabel(companyGroup);
            const title =
              `No timesheet entries for "${label}" week of ${weekLabel} — report not sent ` +
              `(this company had ${prior4wkHours.toFixed(2)} h in the prior ${PRIOR_HISTORY_WEEKS} weeks)`;

            console.error(`[send-weekly-revenue-report] ${title}`);
            errors.push(title);

            await raiseReportNotSentAlert(companyUUID, label, title, {
              reason: 'no_entries',
              week_start: weekStart,
              week_end: weekEnd,
              prior_weeks_with_hours: priorWeeksWithHours,
              prior_4wk_hours: prior4wkHours,
            });
          } else {
            // Expected zero: a paused client, a company-wide holiday, or a
            // project that has only just opted in. Logged, never alerted —
            // a legitimately quiet client must not be spammed.
            console.log(
              `[send-weekly-revenue-report] No entries for "${companyGroup.companyDisplayName}" ` +
              `week of ${weekLabel} — expected zero (no hours in the prior ${PRIOR_HISTORY_WEEKS} weeks), ` +
              `zero-marker row written`,
            );
          }

          continue;
        }

        // Sort projects alphabetically
        companyProjects.sort((a, b) => a.projectName.localeCompare(b.projectName));

        // --- Build CSV ---
        const csvLines: string[] = [];

        // Title row
        csvLines.push(csvField(`Customer Revenue Report - ${monthLabel} (Week of ${weekLabel})`));

        // Header row
        csvLines.push(csvRow([
          'Company', 'Project', 'Task', 'Hours', 'Rate ($/hr)',
          'Project Hours', 'Project Revenue', 'Company Hours', 'Company Revenue',
        ]));

        // Company summary row
        csvLines.push(csvRow([
          companyGroup.companyDisplayName, '', '', '', '', '', '',
          companyTotalHours.toFixed(2),
          formatCurrency(companyTotalRevenue),
        ]));

        // Project + task rows
        for (const project of companyProjects) {
          // Project summary row
          csvLines.push(csvRow([
            companyGroup.companyDisplayName,
            project.projectName,
            '', '',
            project.rate.toFixed(2),
            project.projectHours.toFixed(2),
            project.projectRevenueFormatted,
            '', '',
          ]));

          // Task rows
          for (const task of project.tasks) {
            csvLines.push(csvRow([
              companyGroup.companyDisplayName,
              project.projectName,
              task.taskName,
              task.hours.toFixed(2),
              project.rate.toFixed(2),
              '', '', '', '',
            ]));
          }
        }

        // Empty row between companies (in multi-company mode this separates them,
        // and for single company it separates data from TOTAL)
        csvLines.push(csvRow(['', '', '', '', '', '', '', '', '']));

        // TOTAL row
        csvLines.push(csvRow([
          'TOTAL', '', '', '', '', '', '',
          companyTotalHours.toFixed(2),
          formatCurrency(companyTotalRevenue),
        ]));

        const csvContent = csvLines.join('\r\n') + '\r\n';

        // --- Store CSV in weekly-reports bucket ---
        const storagePath = `${companyGroup.companySlug}/${weekStart}-to-${weekEnd}.csv`;
        const csvBytes = new TextEncoder().encode(csvContent);
        const { error: uploadError } = await supabase.storage
          .from('weekly-reports')
          .upload(storagePath, csvBytes, {
            contentType: 'text/csv',
            upsert: true,  // overwrite if regenerating
          });
        if (uploadError) {
          console.error(`[send-weekly-revenue-report] Storage upload error: ${uploadError.message}`);
        }

        // --- Send email (skip in generateOnly mode) ---
        let emailSent = false;
        const recipients = pmInfo?.emails ?? [];

        if (!generateOnly) {
          // --- Build email body ---
          const emailBody = [
            `Good morning ${pmInfo!.firstName},`,
            '',
            `Attached is the ${companyGroup.companyDisplayName} report for the week of ${weekLabel}.`,
            '',
            'This is your automated report generated every Monday. Please review the numbers to confirm they align with the project management system that is used.',
            '',
            'Best,',
            '',
            'The Manifest Development Team',
          ].join('\n');

          // --- Send via SendGrid ---
          const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SENDGRID_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: recipients.map((email) => ({ email })) }],
              from: { email: SENDGRID_SENDER, name: 'Manifest Development Team' },
              subject: `${companyGroup.companyDisplayName} Weekly Revenue Report - Week of ${weekLabel}`,
              content: [{ type: 'text/plain', value: emailBody }],
              attachments: [{
                content: base64Encode(new TextEncoder().encode(csvContent)),
                filename: `customer-revenue-${companyGroup.companySlug}-${weekStart}.csv`,
                type: 'text/csv',
                disposition: 'attachment',
              }],
            }),
          });

          emailSent = sgResponse.ok;
          if (!emailSent) {
            const errText = await sgResponse.text();
            console.error(
              `[send-weekly-revenue-report] SendGrid error for "${companyGroup.companyDisplayName}": ${sgResponse.status} ${errText}`,
            );
          }
        }

        // --- Upsert weekly_reports row ---
        const { error: upsertError } = await supabase
          .from('weekly_reports')
          .upsert({
            company_id: companyUUID,
            company_name: companyGroup.companyDisplayName,
            week_start: weekStart,
            week_end: weekEnd,
            report_year: parseInt(weekStart.split('-')[0], 10),
            report_month: parseInt(weekStart.split('-')[1], 10),
            total_hours: companyTotalHours,
            total_revenue_cents: Math.round(companyTotalRevenue * 100),
            project_count: companyProjects.length,
            task_count: companyTaskCount,
            storage_path: storagePath,
            file_size_bytes: csvBytes.length,
            generated_at: new Date().toISOString(),
            sent_at: emailSent ? new Date().toISOString() : null,
            sent_to: emailSent ? recipients : null,
          }, {
            onConflict: 'company_id,week_start',
          });
        if (upsertError) {
          console.error(`[send-weekly-revenue-report] Upsert error: ${upsertError.message}`);
        }

        reportedCompanyIds.add(companyUUID);

        reports.push({
          company: companyGroup.companyDisplayName,
          weekLabel,
          pmEmails: recipients,
          taskCount: companyTaskCount,
          totalHours: companyTotalHours,
          totalRevenue: companyTotalRevenue,
          emailSent,
          storagePath,
        });
      } catch (companyErr) {
        const msg = companyErr instanceof Error ? companyErr.message : String(companyErr);
        console.error(
          `[send-weekly-revenue-report] Error processing "${companyGroup.companyDisplayName}": ${msg}`,
        );
        errors.push(`${companyGroup.companyDisplayName}: ${msg}`);
      }
    }

    // =========================================================================
    // STEP 6: Auto-resolve alerts for companies that reported this run
    // =========================================================================
    // Without this, a paused client that resumes — or a config error that gets
    // fixed — leaves a stale alert on the dashboard forever. Same shape as
    // sync-clickup-timesheets/index.ts:1131-1148. Non-blocking, and every
    // client email has already been sent by the time this runs.
    try {
      const { data: activeAlerts } = await supabase
        .from('sync_alerts')
        .select('id, entity_id')
        .eq('alert_type', WEEKLY_REPORT_ALERT_TYPE)
        .is('resolved_at', null);

      for (const alert of (activeAlerts || [])) {
        if (alert.entity_id && reportedCompanyIds.has(alert.entity_id)) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
        }
      }
    } catch (resolveErr) {
      const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
      console.error(
        `[send-weekly-revenue-report] Alert auto-resolve failed (non-blocking): ${msg}`,
      );
    }

    return jsonResponse({ success: true, reports, errors });
  } catch (error) {
    console.error('send-weekly-revenue-report error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});
