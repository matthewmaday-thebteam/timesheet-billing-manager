import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// Edge Function: sync-clockify-timesheets
// =============================================================================
// Syncs Clockify detailed time entries into Supabase `timesheet_daily_rollups`.
//
// Replaces the 7-node n8n Clockify pipeline with a single atomic function:
//   Node 1 (Date Range)   -> Step 1: computeDateRange()
//   Node 2 (Fetch)        -> Step 2: fetchClockifyEntries()
//   Node 3 (Split)        -> (eliminated — single-pass transform)
//   Node 4 (Normalize)    -> Step 3: normalizeAndBuildRows() — normalize pass
//   Node 5 (Build Rows)   -> Step 3: normalizeAndBuildRows() — row building pass
//   n8n Supabase Upsert   -> Step 4: batchUpsert()
//   Node 6 (Cleanup)      -> Step 5: conditionalCleanup()
//   Node 7 (Recalculate)  -> Step 6: drainRecalculationQueue()
//   (new)                 -> Step 7: reconciliationAlerts()
//
// Modes:
//   POST with no body or {}  — Automated (cron): syncs 14-day lookback + current month
//   POST with { rangeStartDate, rangeEndDate } — Manual: custom date range (ISO strings)
//
// Auth: service-role JWT or authenticated user session
// Schedule: every hour via pg_cron
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

/** First N offending entry ids carried in alert metadata for diagnosis. */
const ALERT_SAMPLE_LIMIT = 10;

/** Minutes -> hours, rounded to 2dp (repo-wide hours convention). */
function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Graduated severity for the unmapped-project signal.
 *
 * Unlike ClickUp there is no discriminator here: Clockify's payload carries no
 * evidence of HOW a project id goes missing, so every project-less row counts.
 * Production has held zero such rows across 2,018 rows / 8.5 months, so the
 * baseline is empirically zero and >= 1 is a real signal.
 *
 * Returns null when no alert should be raised.
 */
function clockifyUnmappedSeverity(
  unmappedEntries: number,
  unmappedHours: number,
  runSourceHours: number,
): 'warning' | 'error' | null {
  if (unmappedEntries < 1) return null;
  const material = unmappedHours >= 8
    || (runSourceHours > 0 && unmappedHours >= runSourceHours * 0.05);
  return material ? 'error' : 'warning';
}

// =============================================================================
// Billing-config invariant (pure -- unit tested)
// =============================================================================
// Mirrored VERBATIM in the other sync function and in
// scripts/sync-alert-tests/project-billing-config.test.ts. That test extracts
// the block between the BEGIN/END sentinels from all three files and asserts
// they are byte-identical, so the copies cannot silently drift.
// Keep this block free of Deno/Supabase references.
//
// --- BEGIN PURE BILLING CONFIG ---
/**
 * The financial invariant: no project may reach billing at rate_source
 * 'default'.
 *
 * A project resolves its rate through get_effective_project_rate(). With no
 * project_monthly_rates row that function RAISEs a WARNING nobody reads and
 * returns get_default_rate() = $45.00 with source 'default'. Independently,
 * get_effective_project_rounding() with no project_monthly_rounding row
 * returns the 'task' rounding mode, which changes the HOUR BASIS -- a
 * different number of billable hours, not just a different price.
 *
 * auto_create_project_from_rollup() is supposed to seed both rows, but it only
 * does so when the project it found had a NULL first_seen_month. Its own INSERT
 * supplies first_seen_month, so on a genuinely new project that branch never
 * runs and the project is left with neither row. Three ClickUp folder-ID
 * migrations in six days (1200690000003113, 1200690000003417, 1200690000003130)
 * landed exactly there and billed at $45.00 / 'task' instead of $50.00 /
 * 'entry'.
 *
 * This classifier watches the FINANCIAL CONSEQUENCE rather than the cause, so
 * it fires for any unconfigured project however it appeared -- folder-ID
 * migration, new engagement, manual row, or a future trigger regression.
 */
type ProjectBillingConfigStatus = 'configured' | 'missing_rate' | 'missing_rounding';

/** get_default_rate() in the database. Where an unconfigured project bills. */
const DEFAULT_RATE_USD = 45;

/** get_effective_project_rounding()'s fallback when no rounding row exists. */
const DEFAULT_ROUNDING_MODE = 'task';

/** Window searched for a predecessor, in days before the successor's first work date. */
const SUCCESSION_LOOKBACK_DAYS = 120;

/**
 * Largest gap still read as a handover. The 1200690000003130 succession was
 * 1 day (08-17 -> 08-18); the 1200690000003113 succession was 16 (08-10 ->
 * 08-26). One billing month bounds it without admitting last quarter's work.
 */
const SUCCESSION_MAX_GAP_DAYS = 31;

/** Names listed in an alert title before the rest degrade to "+N more". */
const SUCCESSION_TITLE_SAMPLE = 3;

/** Longest project/task name carried into a title before it is elided. */
const TITLE_NAME_MAX_CHARS = 60;

interface ProjectBillingConfigFacts {
  /** True when the project is a member of a project group (migration 030). */
  isGroupMember: boolean;
  hasRateRow: boolean;
  hasRoundingRow: boolean;
}

/**
 * Verdict for one project. A group MEMBER is always 'configured': billing
 * resolves members through their group's primary project, which owns the rate
 * and rounding rows. A group PRIMARY is judged on its own rows, as it should be.
 */
function classifyProjectBillingConfig(
  facts: ProjectBillingConfigFacts,
): ProjectBillingConfigStatus {
  if (facts.isGroupMember) return 'configured';
  if (!facts.hasRateRow) return 'missing_rate';
  if (!facts.hasRoundingRow) return 'missing_rounding';
  return 'configured';
}

/**
 * 'error' -- the money is provably wrong ($45.00 instead of the contracted rate).
 * 'warning' -- the rate holds but the hour basis silently changed.
 */
function projectBillingConfigSeverity(
  status: ProjectBillingConfigStatus,
): 'error' | 'warning' | null {
  if (status === 'missing_rate') return 'error';
  if (status === 'missing_rounding') return 'warning';
  return null;
}

// -----------------------------------------------------------------------------
// Succession hint -- ADVISORY ONLY
// -----------------------------------------------------------------------------
// Names a likely predecessor so the human fix is one click instead of an
// investigation. Nothing here attaches, groups, or rates anything: a wrong
// auto-grouping bills one client's work under another client's canonical at
// another client's rate, which is strictly worse than the gap it closes.
// -----------------------------------------------------------------------------

interface ProjectWorkProfile {
  externalId: string;
  name: string;
  /** ISO yyyy-mm-dd. */
  firstWorkDate: string;
  /** ISO yyyy-mm-dd. */
  lastWorkDate: string;
  userIds: string[];
  taskNames: string[];
}

type SuccessionConfidence = 'likely' | 'possible';

interface SuccessionCandidate {
  external_id: string;
  name: string;
  confidence: SuccessionConfidence;
  contiguous_handover: boolean;
  gap_days: number | null;
  handover: string | null;
  resource_continuity: boolean;
  shared_user_ids: string[];
  task_continuity: boolean;
  shared_task_names: string[];
  signals_matched: number;
}

interface SuccessionSummary {
  /** Set ONLY when exactly one candidate matches all three tests. */
  candidate: SuccessionCandidate | null;
  ambiguous: boolean;
  candidates: SuccessionCandidate[];
  note: string;
}

const MS_PER_DAY = 86400000;

/** Whole calendar days from one ISO date to another. Negative when `to` is earlier. */
function wholeDaysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return Math.round((to - from) / MS_PER_DAY);
}

/** ISO date shifted by whole days. Returns '' for an unparseable input. */
function shiftDateISO(iso: string, days: number): string {
  const base = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(base)) return '';
  return new Date(base + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Task names are compared case- and whitespace-insensitively. */
function normalizeTaskName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Elide a name that would otherwise run away with the alert title. */
function truncateForTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TITLE_NAME_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, TITLE_NAME_MAX_CHARS - 1)}…`;
}

/** Deterministic, de-duplicated intersection of two string lists. */
function intersect(a: string[], b: string[]): string[] {
  const other = new Set(b);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of a) {
    if (other.has(value) && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * Score every same-client project against the three succession signals that
 * all matched in all three known folder-ID migrations:
 *
 *   1. Contiguous handover -- the candidate's last work date precedes the
 *      successor's first with NO overlap, inside SUCCESSION_MAX_GAP_DAYS.
 *   2. Resource continuity -- the successor's people are the candidate's
 *      people, or a subset of them.
 *   3. Task-name continuity -- at least one task name spans the boundary.
 *      ("App QA" -> "App QA" was decisive on 1200690000003113.)
 *
 * Candidates matching fewer than two signals are dropped as noise.
 * Callers MUST have restricted `candidates` to the SAME client_id.
 */
function findSuccessionCandidates(
  successor: ProjectWorkProfile,
  candidates: ProjectWorkProfile[],
): SuccessionCandidate[] {
  const successorTaskKeys = successor.taskNames.map(normalizeTaskName);
  const lookbackStart = shiftDateISO(successor.firstWorkDate, -SUCCESSION_LOOKBACK_DAYS);
  const scored: SuccessionCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.externalId === successor.externalId) continue;
    // Anything that went quiet before the lookback window is a different era
    // of work, not a handover.
    if (lookbackStart && candidate.lastWorkDate < lookbackStart) continue;

    // 1. Contiguous handover -- strictly no overlap.
    const overlaps = candidate.lastWorkDate >= successor.firstWorkDate;
    const gapDays = overlaps
      ? null
      : wholeDaysBetween(candidate.lastWorkDate, successor.firstWorkDate);
    const contiguous = gapDays !== null
      && Number.isFinite(gapDays)
      && gapDays >= 1
      && gapDays <= SUCCESSION_MAX_GAP_DAYS;

    // 2. Resource continuity -- equal set or strict subset.
    const sharedUserIds = intersect(successor.userIds, candidate.userIds);
    const resourceContinuity = successor.userIds.length > 0
      && sharedUserIds.length === new Set(successor.userIds).size;

    // 3. Task-name continuity -- reported with the successor's own spelling.
    const candidateTaskKeys = new Set(candidate.taskNames.map(normalizeTaskName));
    const seenTaskKeys = new Set<string>();
    const sharedTaskNames: string[] = [];
    for (let i = 0; i < successor.taskNames.length; i++) {
      const key = successorTaskKeys[i];
      if (candidateTaskKeys.has(key) && !seenTaskKeys.has(key)) {
        seenTaskKeys.add(key);
        sharedTaskNames.push(successor.taskNames[i]);
      }
    }
    const taskContinuity = sharedTaskNames.length > 0;

    const signalsMatched = (contiguous ? 1 : 0) + (resourceContinuity ? 1 : 0) + (taskContinuity ? 1 : 0);
    if (signalsMatched < 2) continue;

    scored.push({
      external_id: candidate.externalId,
      name: candidate.name,
      confidence: signalsMatched === 3 ? 'likely' : 'possible',
      contiguous_handover: contiguous,
      gap_days: contiguous ? gapDays : null,
      handover: contiguous ? `${candidate.lastWorkDate} -> ${successor.firstWorkDate}` : null,
      resource_continuity: resourceContinuity,
      shared_user_ids: sharedUserIds,
      task_continuity: taskContinuity,
      shared_task_names: sharedTaskNames,
      signals_matched: signalsMatched,
    });
  }

  // Strongest first; ties broken deterministically so the alert does not churn.
  scored.sort((a, b) =>
    b.signals_matched - a.signals_matched
    || b.shared_task_names.length - a.shared_task_names.length
    || (a.gap_days ?? Number.MAX_SAFE_INTEGER) - (b.gap_days ?? Number.MAX_SAFE_INTEGER)
    || a.external_id.localeCompare(b.external_id)
  );
  return scored;
}

/**
 * Reduce the ranked candidates to at most one assertion. A named predecessor
 * requires EXACTLY ONE candidate matching all three signals; anything else is
 * reported as ambiguous rather than guessed at.
 */
function summarizeSuccession(candidates: SuccessionCandidate[]): SuccessionSummary {
  const likely = candidates.filter((candidate) => candidate.confidence === 'likely');

  if (likely.length === 1) {
    return {
      candidate: likely[0],
      ambiguous: false,
      candidates,
      note: 'one predecessor matches all three succession signals',
    };
  }
  if (likely.length > 1) {
    return {
      candidate: null,
      ambiguous: true,
      candidates,
      note: `${likely.length} projects match all three succession signals -- ambiguous, asserting none`,
    };
  }
  if (candidates.length > 0) {
    return {
      candidate: null,
      ambiguous: true,
      candidates,
      note: `${candidates.length} partial match${candidates.length === 1 ? '' : 'es'} only, no full match`,
    };
  }
  return {
    candidate: null,
    ambiguous: false,
    candidates,
    note: 'no predecessor found on this client',
  };
}

// -----------------------------------------------------------------------------
// Alert title
// -----------------------------------------------------------------------------
// The dashboard renders ONLY alert.title (src/components/Dashboard.tsx:477-505),
// so the entire story has to survive in this one string.
// -----------------------------------------------------------------------------

interface BillingConfigAlertInput {
  status: ProjectBillingConfigStatus;
  projectName: string;
  externalId: string;
  clientName: string | null;
  /** null when the client's work history could not be read this run. */
  hoursAccumulated: number | null;
  firstSeenMonth: string | null;
  succession: SuccessionSummary | null;
}

/** "a", "b" and 1 more */
function formatNameList(names: string[]): string {
  const shown = names.slice(0, SUCCESSION_TITLE_SAMPLE).map((name) => `"${truncateForTitle(name)}"`);
  const remainder = names.length - shown.length;
  return remainder > 0 ? `${shown.join(', ')} and ${remainder} more` : shown.join(', ');
}

function formatSuccessionClause(succession: SuccessionSummary | null): string {
  // null means the search did not run, which is NOT the same as finding
  // nothing -- say so rather than let the reader infer there is no predecessor.
  if (!succession) return ' Predecessor search did not run (work history unavailable).';

  const { candidate } = succession;
  if (candidate) {
    const evidence: string[] = [];
    if (candidate.handover) evidence.push(`contiguous handover ${candidate.handover}`);
    if (candidate.resource_continuity) {
      evidence.push(`same ${candidate.shared_user_ids.length === 1 ? 'resource' : 'resources'}`);
    }
    if (candidate.task_continuity) {
      evidence.push(`shared task ${formatNameList(candidate.shared_task_names)}`);
    }
    return ` Likely predecessor "${truncateForTitle(candidate.name)}" (external id ${candidate.external_id}): `
      + `${evidence.join(', ')}. Advisory only -- nothing was attached automatically.`;
  }

  const closest = succession.candidates[0];
  if (closest) {
    return ` No confident predecessor -- ${succession.note}; closest is `
      + `"${truncateForTitle(closest.name)}" (external id ${closest.external_id}).`;
  }
  return ` No predecessor found on this client.`;
}

/** The whole story, in one line, for a dashboard that renders nothing else. */
function buildBillingConfigAlertTitle(input: BillingConfigAlertInput): string {
  const client = input.clientName ? `client ${truncateForTitle(input.clientName)}` : 'no client';
  const seen = input.firstSeenMonth ? `, first seen ${input.firstSeenMonth}` : '';
  const hours = input.hoursAccumulated === null
    ? 'hours not evaluated'
    : `${input.hoursAccumulated.toFixed(2)} h logged`;
  const subject = `Project "${truncateForTitle(input.projectName)}" `
    + `(external id ${input.externalId}, ${client}, ${hours}${seen})`;

  if (input.status === 'missing_rate') {
    return `${subject} has no rate row and no project group -- it bills at the `
      + `$${DEFAULT_RATE_USD.toFixed(2)} default rate and the "${DEFAULT_ROUNDING_MODE}" rounding default, `
      + `not its contracted terms.${formatSuccessionClause(input.succession)} `
      + `Fix: add it to the predecessor's project group, or set a monthly rate and rounding.`;
  }
  if (input.status === 'missing_rounding') {
    return `${subject} has a rate but no rounding row -- it bills on the `
      + `"${DEFAULT_ROUNDING_MODE}" rounding default, which silently changes the billable hour basis. `
      + `Fix: set a monthly rounding row.`;
  }
  return `${subject} is correctly configured.`;
}
// --- END PURE BILLING CONFIG ---

// =============================================================================
// Billing-config invariant sweep -- the I/O half of the check above
// =============================================================================
// Runs in BOTH sync functions, immediately after the rollup upsert (STEP 4.5).
//
// WHY HERE, and why in both:
//   * `projects` rows are not created by either sync function. They are created
//     by the AFTER INSERT OR UPDATE trigger trg_auto_create_project on
//     timesheet_daily_rollups, so the earliest moment a new project can be
//     observed is immediately after STEP 4's upsert. There is no "after project
//     upsert" point in either function to hang this on.
//   * It runs BEFORE the STEP 5.8 reconciliation invariant, which returns 500.
//     A billing-config gap that coincided with a reconciliation abort would
//     otherwise be invisible -- the same reasoning that put the unmapped-
//     location alert ahead of STEP 7.
//   * It is a whole-table sweep, not a diff of this run's rows, so EITHER copy
//     alone covers every project from either source. Running it in both is
//     redundancy, not coverage: when one sync is broken or aborting, the other
//     still holds the invariant. Both are hourly, and the sweep is idempotent,
//     so the two copies converge instead of fighting.
//   * It is cheap: four small reads (67 projects / 59 rates / 61 roundings /
//     17 memberships in production today) plus one client-scoped rollup read
//     per offending client.
//
// No abstraction was introduced for the two call sites. supabase/functions/
// _shared/ holds only qbo-token.ts and this repo's convention is copy-paste per
// function; the PURE half is sentinel-guarded and a unit test asserts the
// copies are byte-identical, which is the protection a shared module would give
// without the Deno import graph a shared module would add.
// =============================================================================

/** PostgREST caps a page at 1000 rows; every read below is paged explicitly. */
const SWEEP_PAGE_SIZE = 1000;

/**
 * Ceiling on any one paged read. Hitting it aborts the sweep instead of
 * alerting: a truncated read of project_monthly_rates would make correctly
 * configured projects look unconfigured and raise FALSE $45.00 alerts.
 */
const SWEEP_MAX_ROWS = 50000;

/** Distinct clients whose work history one run will read. 21 exist today. */
const SWEEP_MAX_CLIENT_READS = 40;

/** The slice of a PostgREST builder the paged reader needs. */
interface PagedSelect {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

interface SweepProjectRow {
  id: string;
  project_id: string;
  project_name: string;
  client_id: string | null;
  client_name: string | null;
  first_seen_month: string | null;
}

interface SweepRollupRow {
  project_id: string | null;
  project_name: string | null;
  work_date: string | null;
  user_id: string | null;
  task_name: string | null;
  total_minutes: number | null;
}

interface ClientWorkHistory {
  profiles: Map<string, ProjectWorkProfile>;
  minutesByProject: Map<string, number>;
}

/** Read an entire table through PostgREST's 1000-row page cap. Throws on error. */
async function fetchAllPaged<T>(query: PagedSelect, label: string): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await query.range(offset, offset + SWEEP_PAGE_SIZE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const page = (data as T[] | null) ?? [];
    rows.push(...page);
    if (page.length < SWEEP_PAGE_SIZE) return rows;
    offset += SWEEP_PAGE_SIZE;
    if (offset >= SWEEP_MAX_ROWS) {
      throw new Error(
        `${label} exceeded ${SWEEP_MAX_ROWS} rows -- refusing to alert on a truncated read`,
      );
    }
  }
}

/**
 * Lifetime work profile and total minutes per external project id.
 *
 * Profiles are lifetime rather than windowed on purpose: the lookback bound
 * inside findSuccessionCandidates already restricts WHICH projects may be
 * predecessors, and a project's full task/resource history is better evidence
 * of one continuous stream of work than a 120-day slice of it.
 *
 * `rows` must be ordered by work_date ascending.
 */
function buildClientWorkHistory(rows: SweepRollupRow[]): ClientWorkHistory {
  const profiles = new Map<string, ProjectWorkProfile>();
  const minutesByProject = new Map<string, number>();
  const userIds = new Map<string, Set<string>>();
  const taskNames = new Map<string, Set<string>>();

  for (const row of rows) {
    const externalId = row.project_id;
    if (!externalId || !row.work_date) continue;

    minutesByProject.set(externalId, (minutesByProject.get(externalId) || 0) + (row.total_minutes || 0));

    if (row.user_id) {
      if (!userIds.has(externalId)) userIds.set(externalId, new Set());
      userIds.get(externalId)!.add(row.user_id);
    }
    if (row.task_name) {
      if (!taskNames.has(externalId)) taskNames.set(externalId, new Set());
      taskNames.get(externalId)!.add(row.task_name);
    }

    const existing = profiles.get(externalId);
    if (!existing) {
      profiles.set(externalId, {
        externalId,
        name: row.project_name || externalId,
        firstWorkDate: row.work_date,
        lastWorkDate: row.work_date,
        userIds: [],
        taskNames: [],
      });
      continue;
    }
    if (row.work_date < existing.firstWorkDate) existing.firstWorkDate = row.work_date;
    if (row.work_date >= existing.lastWorkDate) {
      existing.lastWorkDate = row.work_date;
      // Rows arrive work_date ascending, so the latest name wins -- the name
      // the project answers to now (1200690000003113 was renamed mid-life).
      if (row.project_name) existing.name = row.project_name;
    }
  }

  for (const [externalId, profile] of profiles) {
    profile.userIds = [...(userIds.get(externalId) || [])];
    profile.taskNames = [...(taskNames.get(externalId) || [])];
  }
  return { profiles, minutesByProject };
}

/**
 * Detect every project that would reach billing without its own configuration,
 * raise or refresh one `project_missing_billing_config` alert per project, and
 * auto-resolve the alerts whose projects have since been configured.
 *
 * Throws only on a read it cannot trust; the caller wraps it, because alerting
 * must never fail a sync.
 */
async function sweepProjectBillingConfig(
  supabase: ReturnType<typeof createClient>,
  logPrefix: string,
): Promise<Record<string, unknown>> {
  const nowISO = new Date().toISOString();

  // --- 1. The configuration picture, in four small reads ---------------------
  const [projectRows, rateRows, roundingRows, memberRows] = await Promise.all([
    fetchAllPaged<SweepProjectRow>(
      supabase
        .from('projects')
        .select('id, project_id, project_name, client_id, client_name, first_seen_month')
        .order('id', { ascending: true }) as unknown as PagedSelect,
      'projects',
    ),
    fetchAllPaged<{ project_id: string }>(
      supabase
        .from('project_monthly_rates')
        .select('project_id')
        .order('id', { ascending: true }) as unknown as PagedSelect,
      'project_monthly_rates',
    ),
    fetchAllPaged<{ project_id: string }>(
      supabase
        .from('project_monthly_rounding')
        .select('project_id')
        .order('id', { ascending: true }) as unknown as PagedSelect,
      'project_monthly_rounding',
    ),
    fetchAllPaged<{ member_project_id: string }>(
      supabase
        .from('project_group_members')
        .select('member_project_id')
        .order('id', { ascending: true }) as unknown as PagedSelect,
      'project_group_members',
    ),
  ]);

  const projectsWithRate = new Set(rateRows.map((row) => row.project_id));
  const projectsWithRounding = new Set(roundingRows.map((row) => row.project_id));
  const groupMemberProjects = new Set(memberRows.map((row) => row.member_project_id));

  // --- 2. Apply the invariant ------------------------------------------------
  const offenders: Array<{ project: SweepProjectRow; status: ProjectBillingConfigStatus }> = [];
  for (const project of projectRows) {
    const status = classifyProjectBillingConfig({
      isGroupMember: groupMemberProjects.has(project.id),
      hasRateRow: projectsWithRate.has(project.id),
      hasRoundingRow: projectsWithRounding.has(project.id),
    });
    if (status !== 'configured') offenders.push({ project, status });
  }

  // Newest first: a folder-ID migration is always the newest offender, so the
  // client-read budget is spent on the live problem before a known old gap.
  offenders.sort((a, b) =>
    (b.project.first_seen_month || '').localeCompare(a.project.first_seen_month || '')
    || a.project.project_id.localeCompare(b.project.project_id)
  );

  // --- 3. Client work history, read and profiled once per client -------------
  // Hours and the succession hint are ADVISORY. A work-history read that fails
  // degrades the alert text; it must never suppress the invariant itself, so a
  // failure is cached as a miss and the sweep carries on.
  const historyByClient = new Map<string, ClientWorkHistory>();
  const historyFailedClients = new Set<string>();

  const loadClientHistory = async (clientId: string): Promise<ClientWorkHistory | null> => {
    const cached = historyByClient.get(clientId);
    if (cached) return cached;
    if (historyFailedClients.has(clientId)) return null;
    if (historyByClient.size >= SWEEP_MAX_CLIENT_READS) return null;

    try {
      const rows = await fetchAllPaged<SweepRollupRow>(
        supabase
          .from('timesheet_daily_rollups')
          .select('project_id, project_name, work_date, user_id, task_name, total_minutes')
          .eq('client_id', clientId)
          .order('work_date', { ascending: true }) as unknown as PagedSelect,
        `timesheet_daily_rollups(client=${clientId})`,
      );
      const history = buildClientWorkHistory(rows);
      historyByClient.set(clientId, history);
      return history;
    } catch (historyError) {
      historyFailedClients.add(clientId);
      console.error(
        `[${logPrefix}] Work-history read failed for client ${clientId} (non-blocking):`,
        historyError instanceof Error ? historyError.message : String(historyError),
      );
      return null;
    }
  };

  // --- 4. Raise / refresh one alert per offender -----------------------------
  const offendingProjectUuids = new Set<string>();
  let created = 0;
  let refreshed = 0;
  let unchanged = 0;
  let resolved = 0;
  let successionLookups = 0;
  let writeFailures = 0;

  for (const { project, status } of offenders) {
    offendingProjectUuids.add(project.id);

    const history = project.client_id ? await loadClientHistory(project.client_id) : null;
    const hoursAccumulated = history
      ? Math.round(((history.minutesByProject.get(project.project_id) || 0) / 60) * 100) / 100
      : null;

    // A succession hint only makes sense for a project that lost its rate. A
    // rate-configured project missing only rounding has no predecessor to
    // inherit from -- the rounding row is simply absent.
    let succession: SuccessionSummary | null = null;
    if (status === 'missing_rate' && history) {
      successionLookups++;
      const successorProfile = history.profiles.get(project.project_id);
      succession = successorProfile
        ? summarizeSuccession(
          findSuccessionCandidates(successorProfile, [...history.profiles.values()]),
        )
        : { candidate: null, ambiguous: false, candidates: [], note: 'project has no work history' };
    }

    const severity = projectBillingConfigSeverity(status);
    if (!severity) continue;

    const title = buildBillingConfigAlertTitle({
      status,
      projectName: project.project_name,
      externalId: project.project_id,
      clientName: project.client_name,
      hoursAccumulated,
      firstSeenMonth: project.first_seen_month,
      succession,
    });

    const candidateId = succession?.candidate?.external_id ?? null;
    const metadata: Record<string, unknown> = {
      project_uuid: project.id,
      external_id: project.project_id,
      project_name: project.project_name,
      client_id: project.client_id,
      client_name: project.client_name,
      first_seen_month: project.first_seen_month,
      hours_accumulated: hoursAccumulated,
      status,
      missing_rate_row: !projectsWithRate.has(project.id),
      missing_rounding_row: !projectsWithRounding.has(project.id),
      is_group_member: false,
      would_bill_at_rate: status === 'missing_rate' ? DEFAULT_RATE_USD : null,
      would_bill_at_rounding_mode: DEFAULT_ROUNDING_MODE,
      succession_candidate: candidateId,
      succession_ambiguous: succession ? succession.ambiguous : null,
      succession_note: succession ? succession.note : 'not evaluated',
      // Flat strings so the plain-text digest can render them: formatMetadata
      // in send-sync-alert-digest skips nested objects.
      succession_candidate_ids: (succession?.candidates ?? []).map((candidate) =>
        `${candidate.external_id} (${candidate.confidence}: `
        + `${candidate.contiguous_handover ? `contiguous ${candidate.handover}` : 'no contiguous handover'}`
        + `${candidate.resource_continuity ? ', same resources' : ''}`
        + `${candidate.task_continuity ? `, ${candidate.shared_task_names.length} shared task names` : ''})`
      ),
      // Full structured evidence for investigation; the digest ignores it.
      succession: succession
        ? { note: succession.note, ambiguous: succession.ambiguous, candidates: succession.candidates }
        : null,
    };

    // One try/catch per alert write: a project whose write keeps failing must
    // not take the rest of the offenders down with it.
    try {
      const { data: existingAlert } = await supabase
        .from('sync_alerts')
        .select('id, severity, title, metadata, dismissed_at')
        .eq('alert_type', 'project_missing_billing_config')
        .eq('entity_id', project.id)
        .is('resolved_at', null)
        .maybeSingle();

      if (!existingAlert) {
        // Respects UNIQUE (alert_type, entity_id) WHERE resolved_at IS NULL
        // (078_create_sync_alerts.sql:36-38) -- a bare insert would throw here.
        await supabase.from('sync_alerts').insert({
          alert_type: 'project_missing_billing_config',
          severity,
          title,
          entity_type: 'project',
          entity_id: project.id,
          entity_name: project.project_name,
          metadata,
        });
        created++;
        console.error(`[${logPrefix}] ${severity.toUpperCase()}: ${title}`);
        continue;
      }

      // Hours climb on every sync of a live project. Treating that as a change
      // would clear dismissed_at hourly and train the reader to ignore the
      // alert, so only a change in WHAT IS WRONG resurfaces a dismissed alert;
      // a moved figure refreshes the text in place and leaves dismissal alone.
      const oldMetadata = (existingAlert.metadata as Record<string, unknown>) || {};
      const materialChange = oldMetadata.status !== status
        || existingAlert.severity !== severity
        || (oldMetadata.succession_candidate ?? null) !== candidateId;

      if (materialChange) {
        await supabase
          .from('sync_alerts')
          .update({
            severity,
            title,
            entity_name: project.project_name,
            metadata,
            dismissed_at: null,
            dismissed_by: null,
            updated_at: nowISO,
          })
          .eq('id', existingAlert.id);
        refreshed++;
        console.error(`[${logPrefix}] ${severity.toUpperCase()}: ${title}`);
      } else if (existingAlert.title !== title) {
        await supabase
          .from('sync_alerts')
          .update({ title, entity_name: project.project_name, metadata, updated_at: nowISO })
          .eq('id', existingAlert.id);
        refreshed++;
      } else {
        unchanged++;
      }
    } catch (writeError) {
      writeFailures++;
      console.error(
        `[${logPrefix}] Billing config alert write failed for ${project.project_id} (non-blocking):`,
        writeError instanceof Error ? writeError.message : String(writeError),
      );
    }
  }

  // --- 5. Auto-resolve projects that have since been configured --------------
  // Same shape as the clickup_hours_mismatch resolve pass.
  const { data: activeAlerts } = await supabase
    .from('sync_alerts')
    .select('id, entity_id')
    .eq('alert_type', 'project_missing_billing_config')
    .is('resolved_at', null);

  for (const alert of (activeAlerts || [])) {
    if (!alert.entity_id || offendingProjectUuids.has(alert.entity_id)) continue;
    try {
      await supabase
        .from('sync_alerts')
        .update({ resolved_at: nowISO, updated_at: nowISO })
        .eq('id', alert.id);
      resolved++;
    } catch (resolveError) {
      writeFailures++;
      console.error(
        `[${logPrefix}] Billing config alert resolve failed for ${alert.entity_id} (non-blocking):`,
        resolveError instanceof Error ? resolveError.message : String(resolveError),
      );
    }
  }

  const sweepResult = {
    action: 'billing_config_sweep_complete',
    projects_checked: projectRows.length,
    projects_missing_rate: offenders.filter((offender) => offender.status === 'missing_rate').length,
    projects_missing_rounding: offenders.filter((offender) => offender.status === 'missing_rounding').length,
    succession_lookups: successionLookups,
    alerts_created: created,
    alerts_refreshed: refreshed,
    alerts_unchanged: unchanged,
    alerts_resolved: resolved,
    alert_write_failures: writeFailures,
    clients_with_unreadable_history: historyFailedClients.size,
  };
  console.log(`[${logPrefix}] Billing config sweep:`, JSON.stringify(sweepResult));
  return sweepResult;
}

serve(async (req) => {
  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // =========================================================================
    // AUTH — same pattern as BambooHR Edge Functions
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    // Check if the JWT has service_role — handles both JWT and sb_secret_ env var formats
    let isServiceRole = false;
    try {
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64));
        isServiceRole = payload.role === 'service_role';
      }
    } catch {
      // Not a valid JWT — fall through to user session check
    }

    if (!isServiceRole) {
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error: authError } = await anonClient.auth.getUser();
      if (authError || !user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
    }

    // =========================================================================
    // Secrets — all via Deno.env.get(), never hardcoded
    // =========================================================================
    const clockifyApiKey = Deno.env.get('CLOCKIFY_API_KEY')!;
    const clockifyWorkspaceId = Deno.env.get('CLOCKIFY_WORKSPACE_ID')!;

    if (!clockifyApiKey || !clockifyWorkspaceId) {
      return jsonResponse(
        { error: 'Missing required secrets: CLOCKIFY_API_KEY and/or CLOCKIFY_WORKSPACE_ID' },
        500,
      );
    }

    // =========================================================================
    // Sync run metadata
    // =========================================================================
    const syncRunId = crypto.randomUUID();
    const syncRunAt = new Date().toISOString();

    // Use the JWT token for the Supabase client (env var may be sb_secret_ format)
    const supabase = createClient(supabaseUrl, isServiceRole ? token : supabaseServiceKey);

    // =========================================================================
    // STEP 1: Compute date range (n8n Node 1)
    // =========================================================================
    // Default: 14 days before 1st of current month through end of month
    // Override: POST body { rangeStartDate, rangeEndDate } as ISO strings
    // =========================================================================
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is valid (automated cron trigger)
    }

    let rangeStartISO: string;
    let rangeEndISO: string;

    if (body.rangeStartDate && body.rangeEndDate) {
      // Manual override — use provided dates directly
      rangeStartISO = body.rangeStartDate as string;
      rangeEndISO = body.rangeEndDate as string;
      console.log(`[sync-clockify] Manual date range: ${rangeStartISO} to ${rangeEndISO}`);
    } else {
      // Default: 14 days before 1st of current month through end of month
      const now = new Date();

      // 1st of the current month at 00:00:00.000Z
      const firstOfMonth = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
        0, 0, 0, 0,
      ));

      // 14 days before 1st of month (~10 days into prior month)
      const rangeStart = new Date(firstOfMonth.getTime() - 14 * 24 * 60 * 60 * 1000);

      // Last millisecond of the current month:
      // 1st of next month at 00:00:00.000Z minus 1 ms
      const rangeEnd = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() + 1,
          1,
          0, 0, 0, 0,
        ) - 1,
      );

      rangeStartISO = rangeStart.toISOString();
      rangeEndISO = rangeEnd.toISOString();
      console.log(`[sync-clockify] Auto date range: ${rangeStartISO} to ${rangeEndISO}`);
    }

    // =========================================================================
    // STEP 2: Paginated fetch from Clockify Reports API (n8n Node 2)
    // =========================================================================
    // POST /v1/workspaces/{id}/reports/detailed
    // 1000 entries per page, 50-page safety limit
    // =========================================================================
    const clockifyUrl = `https://reports.api.clockify.me/v1/workspaces/${clockifyWorkspaceId}/reports/detailed`;
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50;

    let allTimeEntries: Array<Record<string, unknown>> = [];
    let page = 1;
    let fetchComplete = true;
    let hitSafetyLimit = false;
    const fetchErrors: Array<{ type: string; page: number; message: string }> = [];

    console.log(`[sync-clockify] Starting paginated fetch from Clockify...`);

    try {
      while (true) {
        const requestBody = {
          dateRangeStart: rangeStartISO,
          dateRangeEnd: rangeEndISO,
          exportType: 'JSON',
          detailedFilter: {
            page,
            pageSize: PAGE_SIZE,
          },
        };

        let res: Record<string, unknown>;
        try {
          const response = await fetch(clockifyUrl, {
            method: 'POST',
            headers: {
              'X-Api-Key': clockifyApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            throw new Error(`Clockify API returned ${response.status}: ${response.statusText}`);
          }

          res = await response.json();
        } catch (apiErr) {
          // API call failed — mark as incomplete
          fetchComplete = false;
          fetchErrors.push({
            type: 'api_error',
            page,
            message: apiErr instanceof Error ? apiErr.message : 'Unknown API error',
          });
          break; // Stop pagination on error
        }

        const batch = (res?.timeentries as Array<Record<string, unknown>>) || [];
        allTimeEntries = allTimeEntries.concat(batch);

        console.log(`[sync-clockify] Page ${page}: fetched ${batch.length} entries (total: ${allTimeEntries.length})`);

        // Stop when the page returned fewer than PAGE_SIZE entries (natural end)
        if (batch.length < PAGE_SIZE) break;

        page += 1;

        // Safety break (prevents infinite loops if API acts weird)
        if (page > MAX_PAGES) {
          hitSafetyLimit = true;
          fetchComplete = false;
          fetchErrors.push({
            type: 'safety_limit',
            page,
            message: `Hit ${MAX_PAGES}-page safety limit — possible infinite loop or unusually large dataset`,
          });
          break;
        }
      }
    } catch (outerErr) {
      // Unexpected error in the loop
      fetchComplete = false;
      fetchErrors.push({
        type: 'unexpected_error',
        page,
        message: outerErr instanceof Error ? outerErr.message : 'Unexpected error during fetch',
      });
    }

    console.log(
      `[sync-clockify] Fetch complete: ${fetchComplete}, ` +
      `pages: ${page}, entries: ${allTimeEntries.length}, errors: ${fetchErrors.length}`,
    );

    // =========================================================================
    // STEP 3: Normalize + build upsert rows in a single pass (n8n Nodes 3+4+5)
    // =========================================================================
    // Combines split, normalize, and row-building into one loop.
    // Filters: skip entries with no task_id, no work_date, or zero/negative duration.
    // total_minutes = Math.ceil(duration_seconds / 60)
    // =========================================================================
    interface UpsertRow {
      clockify_workspace_id: string;
      task_id: string;
      work_date: string;
      project_id: string | null;
      project_name: string;
      user_id: string | null;
      user_name: string;
      task_name: string;
      client_id: string | null;
      client_name: string | null;
      total_minutes: number;
      synced_at: string;
      sync_run_id: string;
      sync_run_at: string;
    }

    const rows: UpsertRow[] = [];
    let skippedNoTaskId = 0;
    let skippedNoWorkDate = 0;
    let skippedZeroDuration = 0;

    // Attribution counters: rows written with project_id = NULL. Production has
    // never produced one, so the baseline is zero and >= 1 is alertable.
    let totalSourceMinutes = 0;
    let clockifyUnmappedEntries = 0;
    let clockifyUnmappedMinutes = 0;
    const unmappedSampleEntryIds: string[] = [];
    const unmappedUserNames = new Set<string>();
    const unmappedSampleTaskIds: string[] = [];

    for (const entry of allTimeEntries) {
      // --- Normalize (Node 4 logic) ---
      const taskId = (entry?._id as string) || (entry?.id as string) || null;
      if (!taskId) {
        skippedNoTaskId++;
        continue;
      }

      // Extract work_date from timeInterval.start (UTC date string)
      const timeInterval = entry?.timeInterval as Record<string, unknown> | undefined;
      const startStr = (timeInterval?.start as string) || null;
      let workDate: string | null = null;

      if (startStr) {
        const dt = new Date(startStr);
        if (!Number.isNaN(dt.getTime())) {
          const y = dt.getUTCFullYear();
          const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
          const d = String(dt.getUTCDate()).padStart(2, '0');
          workDate = `${y}-${m}-${d}`;
        }
      }

      if (!workDate) {
        skippedNoWorkDate++;
        continue;
      }

      // Duration in seconds
      const durationSeconds = typeof timeInterval?.duration === 'number'
        ? timeInterval.duration
        : 0;

      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        skippedZeroDuration++;
        continue;
      }

      // --- Build Row (Node 5 logic) ---
      const totalMinutes = Math.ceil(durationSeconds / 60);
      if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
        skippedZeroDuration++;
        continue;
      }

      const description = ((entry?.description as string) ?? '').trim() || '(no description)';
      const clientId = (entry?.clientId as string) ?? null;
      const clientName = (entry?.clientName as string) || (clientId ? 'Unknown Client' : null);
      const projectId = (entry?.projectId as string) ?? null;

      // Clockify's own task id. Deliberately NOT written to
      // timesheet_daily_rollups (task_id there is the time-entry id and those
      // writes must stay byte-identical) -- it is captured for alert metadata
      // only, so the next attribution incident is diagnosable.
      const sourceTaskId = (entry?.taskId as string) ?? null;

      // --- Attribution classification (same pass, no extra API calls) ---
      if (projectId === null) {
        clockifyUnmappedEntries++;
        clockifyUnmappedMinutes += totalMinutes;
        unmappedUserNames.add((entry?.userName as string) || 'Unknown');
        if (unmappedSampleEntryIds.length < ALERT_SAMPLE_LIMIT) {
          unmappedSampleEntryIds.push(taskId);
          if (sourceTaskId) unmappedSampleTaskIds.push(sourceTaskId);
        }
      }

      totalSourceMinutes += totalMinutes;

      rows.push({
        clockify_workspace_id: clockifyWorkspaceId,
        task_id: taskId,
        work_date: workDate,
        project_id: projectId,
        project_name: (entry?.projectName as string) || 'No Project',
        user_id: (entry?.userId as string) ?? null,
        user_name: (entry?.userName as string) || 'Unknown',
        task_name: description,
        client_id: clientId,
        client_name: clientName,
        total_minutes: totalMinutes,
        synced_at: syncRunAt,
        sync_run_id: syncRunId,
        sync_run_at: syncRunAt,
      });
    }

    console.log(
      `[sync-clockify] Rows built: ${rows.length} ` +
      `(skipped: ${skippedNoTaskId} no task_id, ${skippedNoWorkDate} no work_date, ${skippedZeroDuration} zero/negative duration)`,
    );

    const unmappedHours = minutesToHours(clockifyUnmappedMinutes);

    console.log(
      `[sync-clockify] Attribution: ${clockifyUnmappedEntries} entries with no project (${unmappedHours} h)`,
    );

    // =========================================================================
    // ALERT: clockify_unmapped_project -- lost-attribution watchdog
    // =========================================================================
    // Raised HERE, not in STEP 7, on purpose: the STEP 5.8 reconciliation
    // invariant returns 500 before STEP 7 is ever reached, so an attribution
    // incident that coincided with a reconciliation abort would be invisible.
    // Non-blocking -- alerting must never fail the sync.
    //
    // Clockify's payload carries no discriminator between "permission failure"
    // and "genuinely no project", so every project-less row counts. Production
    // has held zero of them across 2,018 rows / 8.5 months.
    // =========================================================================
    let attributionAlertResult: Record<string, unknown> = { action: 'attribution_alert_not_attempted' };

    try {
      const unmappedSeverity = clockifyUnmappedSeverity(
        clockifyUnmappedEntries,
        unmappedHours,
        minutesToHours(totalSourceMinutes),
      );
      const alertRangeStart = rangeStartISO.split('T')[0];
      const alertRangeEnd = rangeEndISO.split('T')[0];

      if (unmappedSeverity) {
        const entryWord = clockifyUnmappedEntries === 1 ? 'time entry' : 'time entries';
        const alertTitle =
          `Clockify returned ${clockifyUnmappedEntries} ${entryWord} (${unmappedHours.toFixed(2)} h) ` +
          `with no project for ${alertRangeStart} to ${alertRangeEnd} -- attribution is being lost`;

        const newMetadata = {
          sync_run_id: syncRunId,
          range_start: alertRangeStart,
          range_end: alertRangeEnd,
          unmapped_entries: clockifyUnmappedEntries,
          unmapped_hours: unmappedHours,
          sample_entry_ids: unmappedSampleEntryIds,
          affected_user_names: [...unmappedUserNames],
          sample_task_ids: unmappedSampleTaskIds,
        };

        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id, severity, metadata, dismissed_at')
          .eq('alert_type', 'clockify_unmapped_project')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (existingAlert) {
          // Alert exists — check if values changed
          const oldMeta = existingAlert.metadata as Record<string, unknown> || {};
          const valuesChanged = oldMeta.unmapped_entries !== clockifyUnmappedEntries
            || oldMeta.unmapped_hours !== unmappedHours
            || existingAlert.severity !== unmappedSeverity;

          if (valuesChanged) {
            // Values changed — update and clear dismissed_at so it reappears
            await supabase
              .from('sync_alerts')
              .update({
                severity: unmappedSeverity,
                title: alertTitle,
                metadata: newMetadata,
                dismissed_at: null,
                dismissed_by: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingAlert.id);

            attributionAlertResult = { action: 'attribution_alert_updated', severity: unmappedSeverity };
          } else {
            // Values are the same — leave it alone (keep dismissed state)
            attributionAlertResult = { action: 'attribution_alert_unchanged', severity: unmappedSeverity };
          }
        } else {
          // No active alert — insert new one
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_unmapped_project',
              severity: unmappedSeverity,
              title: alertTitle,
              entity_type: 'team',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: newMetadata,
            });

          attributionAlertResult = { action: 'attribution_alert_created', severity: unmappedSeverity };
        }

        console.error(`[sync-clockify] ${unmappedSeverity.toUpperCase()}: ${alertTitle}`);
      } else if (fetchComplete && clockifyUnmappedEntries === 0) {
        // Clean, complete run — auto-resolve any active alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_unmapped_project')
          .is('resolved_at', null);

        let resolved = 0;
        for (const alert of (activeAlerts || [])) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
          resolved++;
        }

        attributionAlertResult = { action: 'attribution_alert_resolved', alerts_resolved: resolved };
      } else {
        attributionAlertResult = { action: 'attribution_alert_skipped', reason: 'fetch_incomplete' };
      }
    } catch (attributionAlertError) {
      // Alerting must never block a sync
      attributionAlertResult = {
        action: 'attribution_alert_failed',
        error: attributionAlertError instanceof Error
          ? attributionAlertError.message
          : String(attributionAlertError),
      };
      console.error('[sync-clockify] Attribution alert error (non-blocking):', attributionAlertResult.error);
    }

    // =========================================================================
    // STEP 4: Batch upsert to timesheet_daily_rollups (n8n Supabase upsert node)
    // =========================================================================
    // 500-row batches, on conflict (clockify_workspace_id, task_id)
    // =========================================================================
    const BATCH_SIZE = 500;
    let totalUpserted = 0;
    let upsertError: string | null = null;

    if (rows.length > 0) {
      try {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);

          const { error: batchError } = await supabase
            .from('timesheet_daily_rollups')
            .upsert(batch, { onConflict: 'clockify_workspace_id,task_id' });

          if (batchError) {
            throw new Error(`Batch upsert error at offset ${i}: ${batchError.message}`);
          }

          totalUpserted += batch.length;
          console.log(`[sync-clockify] Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rows (total: ${totalUpserted})`);
        }
      } catch (err) {
        upsertError = err instanceof Error ? err.message : 'Failed to upsert timesheet_daily_rollups';
        console.error(`[sync-clockify] Upsert error: ${upsertError}`);
      }
    }

    console.log(`[sync-clockify] Upsert complete: ${totalUpserted} rows`);

    // =========================================================================
    // Compute total hours for diagnostics (source vs manifest)
    // =========================================================================
    // source_hours: sum of total_minutes from built rows (what we tried to upsert) / 60
    // manifest_hours: sum of total_minutes from the DB after upsert (what's actually stored)
    let sourceHours: number | null = null;
    let manifestHours: number | null = null;

    if (rows.length > 0) {
      sourceHours = minutesToHours(totalSourceMinutes);
    }

    // Query the DB for actual stored hours in the sync date range
    try {
      const diagRangeStart = rangeStartISO.split('T')[0];
      const diagRangeEnd = rangeEndISO.split('T')[0];
      const { data: dbTotals } = await supabase
        .from('timesheet_daily_rollups')
        .select('total_minutes')
        .eq('clockify_workspace_id', clockifyWorkspaceId)
        .gte('work_date', diagRangeStart)
        .lte('work_date', diagRangeEnd);

      if (dbTotals && dbTotals.length > 0) {
        let totalDbMinutes = 0;
        for (const row of dbTotals) {
          totalDbMinutes += row.total_minutes || 0;
        }
        manifestHours = Math.round((totalDbMinutes / 60) * 100) / 100;
      }
    } catch {
      // Non-blocking — manifest_hours will be null if query fails
    }

    console.log(`[sync-clockify] Hours — source: ${sourceHours}, manifest: ${manifestHours}`);

    // =========================================================================
    // STEP 4.5: Billing-config invariant -- no project may bill at the default
    // =========================================================================
    // See sweepProjectBillingConfig() above for why the check lives here and in
    // both sync functions. Non-blocking: an alerting failure must never break a
    // sync run.
    // =========================================================================
    let billingConfigResult: Record<string, unknown> = { action: 'billing_config_sweep_not_attempted' };

    try {
      billingConfigResult = await sweepProjectBillingConfig(supabase, 'sync-clockify');
    } catch (billingConfigError) {
      billingConfigResult = {
        action: 'billing_config_sweep_failed',
        error: billingConfigError instanceof Error
          ? billingConfigError.message
          : String(billingConfigError),
      };
      console.error(
        '[sync-clockify] Billing config sweep error (non-blocking):',
        billingConfigResult.error,
      );
    }

    // =========================================================================
    // STEP 5: Conditional cleanup — delete stale entries (n8n Node 6)
    // =========================================================================
    // Only runs if fetch was complete AND upsert succeeded.
    // Calls RPC cleanup_stale_timesheet_entries(p_workspace_id, p_range_start,
    //   p_range_end, p_sync_run_id)
    // =========================================================================
    let cleanupResult: Record<string, unknown> = { action: 'cleanup_not_attempted' };
    let deletedCount = 0;

    if (!fetchComplete) {
      cleanupResult = {
        action: 'cleanup_skipped',
        reason: 'fetch_incomplete',
        sync_run_id: syncRunId,
        message: 'Cleanup skipped because fetch did not complete successfully. No entries deleted.',
      };
      console.log(`[sync-clockify] Cleanup skipped: fetch incomplete`);
    } else if (upsertError) {
      cleanupResult = {
        action: 'cleanup_skipped',
        reason: 'upsert_error',
        sync_run_id: syncRunId,
        message: 'Cleanup skipped because upsert had errors.',
      };
      console.log(`[sync-clockify] Cleanup skipped: upsert error`);
    } else {
      // Extract date parts for the RPC (expects DATE, not TIMESTAMPTZ)
      const rangeStartDate = rangeStartISO.split('T')[0];
      const rangeEndDate = rangeEndISO.split('T')[0];

      try {
        const { data: rpcResult, error: rpcError } = await supabase
          .rpc('cleanup_stale_timesheet_entries', {
            p_workspace_id: clockifyWorkspaceId,
            p_range_start: rangeStartDate,
            p_range_end: rangeEndDate,
            p_sync_run_id: syncRunId,
          });

        if (rpcError) {
          throw new Error(`Cleanup RPC error: ${rpcError.message}`);
        }

        // RPC returns TABLE (deleted_count BIGINT) — result is array with one row
        deletedCount = Array.isArray(rpcResult)
          ? (rpcResult[0]?.deleted_count ?? 0)
          : (rpcResult?.deleted_count ?? 0);

        cleanupResult = {
          action: 'cleanup_executed',
          sync_run_id: syncRunId,
          deleted_count: deletedCount,
          range_start: rangeStartDate,
          range_end: rangeEndDate,
          message: `Cleanup complete. Deleted ${deletedCount} stale entries.`,
        };
        console.log(`[sync-clockify] Cleanup complete: deleted ${deletedCount} stale entries`);
      } catch (err) {
        cleanupResult = {
          action: 'cleanup_failed',
          reason: 'rpc_error',
          sync_run_id: syncRunId,
          error: err instanceof Error ? err.message : 'Unknown error calling cleanup RPC',
          message: 'Cleanup RPC call failed. Manual review may be needed.',
        };
        console.error(`[sync-clockify] Cleanup failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 5.5: Populate rounded_minutes for synced entries
    // =========================================================================
    // Non-blocking: failures are logged but never stop the sync.
    // Calls RPC populate_rounded_minutes(p_workspace_id, p_range_start, p_range_end)
    // =========================================================================
    let roundingResult: Record<string, unknown> = { action: 'rounding_not_attempted' };

    if (!fetchComplete) {
      roundingResult = {
        action: 'rounding_skipped',
        reason: 'fetch_incomplete',
        sync_run_id: syncRunId,
      };
      console.log(`[sync-clockify] Rounding population skipped: fetch incomplete`);
    } else {
      try {
        const roundingStartDate = rangeStartISO.split('T')[0];
        const roundingEndDate = rangeEndISO.split('T')[0];

        const { data: rpcRoundingResult, error: roundingError } = await supabase
          .rpc('populate_rounded_minutes', {
            p_workspace_id: clockifyWorkspaceId,
            p_range_start: roundingStartDate,
            p_range_end: roundingEndDate,
          });

        if (roundingError) {
          console.error('[sync-clockify] Rounding population error:', roundingError.message);
          roundingResult = {
            action: 'rounding_failed',
            reason: 'rpc_error',
            sync_run_id: syncRunId,
            error: roundingError.message,
          };
        } else {
          const updatedCount = typeof rpcRoundingResult === 'number'
            ? rpcRoundingResult
            : 0;
          roundingResult = {
            action: 'rounding_executed',
            sync_run_id: syncRunId,
            updated_count: updatedCount,
          };
          console.log(`[sync-clockify] Populated rounded_minutes for ${updatedCount} entries`);
        }
      } catch (err) {
        roundingResult = {
          action: 'rounding_failed',
          reason: 'exception',
          sync_run_id: syncRunId,
          error: (err as Error).message,
        };
        console.error(`[sync-clockify] Rounding population failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 5.6: Populate Layer 2 totals (task_totals + employee_totals)
    // =========================================================================
    // Non-blocking: failures are logged but never stop the sync.
    // Only runs if rounding completed successfully.
    // =========================================================================
    let layer2Result: Record<string, unknown> = { action: 'layer2_not_attempted' };

    if (roundingResult.action !== 'rounding_executed') {
        layer2Result = {
            action: 'layer2_skipped',
            reason: 'rounding_not_complete',
            sync_run_id: syncRunId,
        };
        console.log(`[sync-clockify] Layer 2 skipped: rounding did not complete`);
    } else {
        try {
            const l2StartDate = rangeStartISO.split('T')[0];
            const l2EndDate = rangeEndISO.split('T')[0];

            const { data: l2Data, error: l2Error } = await supabase
                .rpc('populate_layer2_totals', {
                    p_workspace_id: clockifyWorkspaceId,
                    p_range_start: l2StartDate,
                    p_range_end: l2EndDate,
                });

            if (l2Error) {
                console.error('[sync-clockify] Layer 2 error:', l2Error.message);
                layer2Result = { action: 'layer2_failed', reason: 'rpc_error', error: l2Error.message };
            } else {
                layer2Result = { action: 'layer2_executed', result: l2Data };
                console.log('[sync-clockify] Layer 2 populated:', JSON.stringify(l2Data));
            }
        } catch (err) {
            layer2Result = { action: 'layer2_failed', reason: 'exception', error: (err as Error).message };
            console.error('[sync-clockify] Layer 2 failed:', (err as Error).message);
        }
    }

    // =========================================================================
    // STEP 5.7: Populate task_monthly_totals
    // =========================================================================
    // Non-blocking: failures are logged but never stop the sync.
    // Only runs if rounding completed successfully.
    // =========================================================================
    let taskMonthlyResult: Record<string, unknown> = { action: 'task_monthly_not_attempted' };

    if (roundingResult.action !== 'rounding_executed') {
        taskMonthlyResult = {
            action: 'task_monthly_skipped',
            reason: 'rounding_not_complete',
            sync_run_id: syncRunId,
        };
        console.log(`[sync-clockify] Task monthly totals skipped: rounding did not complete`);
    } else {
        try {
            const tmStartDate = rangeStartISO.split('T')[0];
            const tmEndDate = rangeEndISO.split('T')[0];

            const { data: tmData, error: tmError } = await supabase
                .rpc('populate_task_monthly_totals', {
                    p_workspace_id: clockifyWorkspaceId,
                    p_range_start: tmStartDate,
                    p_range_end: tmEndDate,
                });

            if (tmError) {
                console.error('[sync-clockify] Task monthly totals error:', tmError.message);
                taskMonthlyResult = { action: 'task_monthly_failed', reason: 'rpc_error', error: tmError.message };
            } else {
                taskMonthlyResult = { action: 'task_monthly_executed', result: tmData };
                console.log('[sync-clockify] Task monthly totals populated:', JSON.stringify(tmData));
            }
        } catch (err) {
            taskMonthlyResult = { action: 'task_monthly_failed', reason: 'exception', error: (err as Error).message };
            console.error('[sync-clockify] Task monthly totals failed:', (err as Error).message);
        }
    }

    // =========================================================================
    // STEP 5.8: Reconciliation invariant (migration 101)
    // =========================================================================
    // Hard abort: if task_monthly_totals has diverged from the canonical-
    // resolved sum of timesheet_daily_rollups by more than 2 minutes for any
    // (canonical_project, summary_month) in the sync range, we must NOT drain
    // the recalculation queue -- billing would compute off corrupt totals.
    //
    // RPC invocation failures are logged but non-fatal (they don't block
    // drain); only actual discrepancies trigger the abort. This preserves
    // availability during transient RPC outages while guaranteeing correctness
    // whenever the check does run.
    // =========================================================================
    const rangeStartDate = rangeStartISO.split('T')[0];
    const rangeEndDate = rangeEndISO.split('T')[0];

    const { data: discrepancies, error: reconcileError } = await supabase.rpc(
      'validate_task_monthly_totals_vs_rollups',
      { p_range_start: rangeStartDate, p_range_end: rangeEndDate }
    );
    if (reconcileError) {
      console.error('[sync-clockify] reconciliation RPC failed:', reconcileError);
      // Continue to drain -- RPC failures shouldn't block a sync run, but must surface
    }
    if (discrepancies && discrepancies.length > 0) {
      // Sample stays in server-side logs ONLY. Do not include it in the
      // response body: discrepancy rows expose canonical_project_id values
      // and raw minute totals, which cross tenant boundaries in the
      // reconciliation scan.
      console.error('[sync-clockify] RECONCILIATION FAILURE -- aborting drain. Discrepancies:', JSON.stringify(discrepancies.slice(0, 20)));

      // This abort returns before sync_runs is written and before STEP 7, so it
      // is silent by construction. Raise the alert here (non-blocking) so the
      // abort itself can never be the reason nothing was reported.
      try {
        const { data: existingAbortAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_reconciliation_abort')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAbortAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_reconciliation_abort',
              severity: 'error',
              title:
                `Clockify sync aborted before recalculation: task_monthly_totals diverged from rollups ` +
                `in ${discrepancies.length} project-month(s) for ${rangeStartDate} to ${rangeEndDate} -- billing totals are frozen until this is resolved`,
              entity_type: 'team',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: {
                sync_run_id: syncRunId,
                range_start: rangeStartDate,
                range_end: rangeEndDate,
                discrepancy_count: discrepancies.length,
              },
            });
        }
      } catch (abortAlertError) {
        console.error(
          '[sync-clockify] Reconciliation abort alert failed (non-blocking):',
          abortAlertError instanceof Error ? abortAlertError.message : String(abortAlertError),
        );
      }

      return new Response(JSON.stringify({
        success: false,
        reason: 'reconciliation_failed',
        discrepancy_count: discrepancies.length,
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Invariant held (and was actually checked) -- auto-resolve any active abort
    // alert. Skipped when the RPC itself failed: we did not verify anything.
    try {
      const { data: activeAbortAlerts } = reconcileError
        ? { data: [] as { id: string }[] }
        : await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_reconciliation_abort')
          .is('resolved_at', null);

      for (const alert of (activeAbortAlerts || [])) {
        await supabase
          .from('sync_alerts')
          .update({
            resolved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', alert.id);
      }
    } catch (abortResolveError) {
      console.error(
        '[sync-clockify] Reconciliation abort auto-resolve failed (non-blocking):',
        abortResolveError instanceof Error ? abortResolveError.message : String(abortResolveError),
      );
    }

    // =========================================================================
    // STEP 6: Drain recalculation queue (n8n Node 7)
    // =========================================================================
    // Only runs if fetch was complete.
    // Calls RPC drain_recalculation_queue(p_max_depth) — default 12
    // =========================================================================
    let recalcResult: Record<string, unknown> = { action: 'recalculate_not_attempted' };

    if (!fetchComplete) {
      recalcResult = {
        action: 'recalculate_skipped',
        reason: 'fetch_incomplete',
        sync_run_id: syncRunId,
        message: 'Recalculation skipped because fetch did not complete successfully.',
      };
      console.log(`[sync-clockify] Recalculation skipped: fetch incomplete`);
    } else {
      try {
        const { data: rpcResult, error: rpcError } = await supabase
          .rpc('drain_recalculation_queue', { p_max_depth: 12 });

        if (rpcError) {
          throw new Error(`Recalculation RPC error: ${rpcError.message}`);
        }

        const processedCount = typeof rpcResult === 'number'
          ? rpcResult
          : (Array.isArray(rpcResult) ? (rpcResult[0] ?? 0) : 0);

        recalcResult = {
          action: 'recalculate_executed',
          sync_run_id: syncRunId,
          processed_count: processedCount,
          message: `Recalculation complete. Processed ${processedCount} queued project-months.`,
        };
        console.log(`[sync-clockify] Recalculation complete: processed ${processedCount} queued project-months`);
      } catch (err) {
        recalcResult = {
          action: 'recalculate_failed',
          reason: 'rpc_error',
          sync_run_id: syncRunId,
          error: err instanceof Error ? err.message : 'Unknown error calling drain_recalculation_queue RPC',
          message: 'Recalculation RPC call failed. Summary table may be stale until next sync.',
        };
        console.error(`[sync-clockify] Recalculation failed: ${(err as Error).message}`);
      }
    }

    // =========================================================================
    // STEP 7: Reconciliation alerts (new — follows sync_alerts pattern)
    // =========================================================================
    // Wrapped in try/catch — reconciliation failures never block core sync.
    // Alert types:
    //   clockify_sync_incomplete (error)    — fetch failed or hit safety limit
    //   clockify_zero_entries (warning)     — 0 entries returned
    //   clockify_high_deletion_count (warning) — cleanup deleted > 50 entries
    //   clockify_hours_mismatch (warning)   — Clockify total minutes per user
    //                                         don't match Manifest rollups
    // Auto-resolve on next successful sync.
    // =========================================================================
    let reconciliationResult: Record<string, unknown> = {
      alerts_created: 0,
      alerts_resolved: 0,
      reconciliation_error: null,
    };

    try {
      console.log('[sync-clockify] Starting reconciliation...');

      let alertsCreated = 0;
      let alertsResolved = 0;

      // --- Alert: clockify_sync_incomplete ---
      if (!fetchComplete) {
        // Check if active alert already exists
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_sync_incomplete')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          const errorSummary = fetchErrors.map((e) => e.message).join('; ') || 'Unknown error';
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_sync_incomplete',
              severity: 'error',
              title: `Clockify sync incomplete: ${errorSummary}`,
              entity_type: 'workspace',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: {
                sync_run_id: syncRunId,
                pages_fetched: page,
                entries_fetched: allTimeEntries.length,
                hit_safety_limit: hitSafetyLimit,
                errors: fetchErrors,
              },
            });
          alertsCreated++;
        }
      } else {
        // Fetch succeeded — auto-resolve any active clockify_sync_incomplete alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_sync_incomplete')
          .is('resolved_at', null);

        for (const alert of (activeAlerts || [])) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
          alertsResolved++;
        }
      }

      // --- Alert: clockify_zero_entries ---
      if (fetchComplete && allTimeEntries.length === 0) {
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_zero_entries')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_zero_entries',
              severity: 'warning',
              title: `Clockify sync returned 0 time entries for ${rangeStartISO.split('T')[0]} to ${rangeEndISO.split('T')[0]}`,
              entity_type: 'workspace',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: {
                sync_run_id: syncRunId,
                range_start: rangeStartISO,
                range_end: rangeEndISO,
              },
            });
          alertsCreated++;
        }
      } else if (allTimeEntries.length > 0) {
        // Non-zero entries — auto-resolve any active clockify_zero_entries alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_zero_entries')
          .is('resolved_at', null);

        for (const alert of (activeAlerts || [])) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
          alertsResolved++;
        }
      }

      // --- Alert: clockify_high_deletion_count ---
      if (deletedCount > 50) {
        const { data: existingAlert } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_high_deletion_count')
          .eq('entity_id', clockifyWorkspaceId)
          .is('resolved_at', null)
          .maybeSingle();

        if (!existingAlert) {
          await supabase
            .from('sync_alerts')
            .insert({
              alert_type: 'clockify_high_deletion_count',
              severity: 'warning',
              title: `Clockify cleanup deleted ${deletedCount} entries (threshold: 50)`,
              entity_type: 'workspace',
              entity_id: clockifyWorkspaceId,
              entity_name: 'Clockify Workspace',
              metadata: {
                sync_run_id: syncRunId,
                deleted_count: deletedCount,
                range_start: rangeStartISO,
                range_end: rangeEndISO,
              },
            });
          alertsCreated++;
        }
      } else if (deletedCount <= 50 && deletedCount >= 0 && fetchComplete) {
        // Deletion count is normal — auto-resolve any active high_deletion_count alerts
        const { data: activeAlerts } = await supabase
          .from('sync_alerts')
          .select('id')
          .eq('alert_type', 'clockify_high_deletion_count')
          .is('resolved_at', null);

        for (const alert of (activeAlerts || [])) {
          await supabase
            .from('sync_alerts')
            .update({
              resolved_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', alert.id);
          alertsResolved++;
        }
      }

      // --- Alert: clockify_hours_mismatch ---
      // Compare Clockify raw totals per user against Manifest (timesheet_daily_rollups)
      // Only run if fetch completed and upsert succeeded (data is reliable)
      if (fetchComplete && !upsertError && allTimeEntries.length > 0) {
        try {
          console.log('[sync-clockify] Starting hours mismatch reconciliation...');

          // 1. Sum Clockify raw entries per userId using Math.ceil(seconds / 60)
          const clockifyTotalsByUser: Record<string, { minutes: number; name: string }> = {};
          for (const entry of allTimeEntries) {
            const userId = (entry?.userId as string) || null;
            if (!userId) continue;

            const timeInterval = entry?.timeInterval as Record<string, unknown> | undefined;
            const durationSeconds = typeof timeInterval?.duration === 'number'
              ? timeInterval.duration
              : 0;

            if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;

            const minutes = Math.ceil(durationSeconds / 60);

            if (!clockifyTotalsByUser[userId]) {
              clockifyTotalsByUser[userId] = {
                minutes: 0,
                name: (entry?.userName as string) || 'Unknown',
              };
            }
            clockifyTotalsByUser[userId].minutes += minutes;
          }

          // 2. Query Manifest's timesheet_daily_rollups for the same date range, grouped by user_id
          const rangeStartDate = rangeStartISO.split('T')[0];
          const rangeEndDate = rangeEndISO.split('T')[0];

          const { data: manifestRollups, error: manifestError } = await supabase
            .from('timesheet_daily_rollups')
            .select('user_id, total_minutes')
            .eq('clockify_workspace_id', clockifyWorkspaceId)
            .gte('work_date', rangeStartDate)
            .lte('work_date', rangeEndDate);

          if (manifestError) {
            throw new Error(`Manifest rollups query error: ${manifestError.message}`);
          }

          const manifestTotalsByUser: Record<string, number> = {};
          for (const row of (manifestRollups || [])) {
            const userId = row.user_id;
            if (userId) {
              manifestTotalsByUser[userId] = (manifestTotalsByUser[userId] || 0) + (row.total_minutes || 0);
            }
          }

          // 3. Compare per user and generate mismatch alerts
          const allUserIds = new Set([
            ...Object.keys(clockifyTotalsByUser),
            ...Object.keys(manifestTotalsByUser),
          ]);

          const mismatchedUserIds: string[] = [];

          for (const userId of allUserIds) {
            const clockifyMinutes = clockifyTotalsByUser[userId]?.minutes || 0;
            const manifestMinutes = manifestTotalsByUser[userId] || 0;

            if (clockifyMinutes !== manifestMinutes) {
              mismatchedUserIds.push(userId);
              const userName = clockifyTotalsByUser[userId]?.name || 'Unknown';

              const newMetadata = {
                clockify_minutes: clockifyMinutes,
                manifest_minutes: manifestMinutes,
                range_start: rangeStartDate,
                range_end: rangeEndDate,
              };

              // Check if an active alert already exists for this user
              const { data: existingAlert } = await supabase
                .from('sync_alerts')
                .select('id, metadata, dismissed_at')
                .eq('alert_type', 'clockify_hours_mismatch')
                .eq('entity_id', userId)
                .is('resolved_at', null)
                .maybeSingle();

              if (existingAlert) {
                // Alert exists — check if values changed
                const oldMeta = existingAlert.metadata as Record<string, unknown> || {};
                const valuesChanged = oldMeta.clockify_minutes !== clockifyMinutes
                  || oldMeta.manifest_minutes !== manifestMinutes;

                if (valuesChanged) {
                  // Values changed — update and clear dismissed_at so it reappears
                  await supabase
                    .from('sync_alerts')
                    .update({
                      title: `Hours mismatch: ${userName} has ${clockifyMinutes} minutes in Clockify but ${manifestMinutes} minutes in Manifest`,
                      metadata: newMetadata,
                      dismissed_at: null,
                      dismissed_by: null,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', existingAlert.id);

                  alertsCreated++;
                }
                // If values are the same, leave it alone (keep dismissed state)
              } else {
                // No active alert — insert new one
                await supabase
                  .from('sync_alerts')
                  .insert({
                    alert_type: 'clockify_hours_mismatch',
                    severity: 'warning',
                    title: `Hours mismatch: ${userName} has ${clockifyMinutes} minutes in Clockify but ${manifestMinutes} minutes in Manifest`,
                    entity_type: 'user',
                    entity_id: userId,
                    entity_name: userName,
                    metadata: newMetadata,
                  });

                alertsCreated++;
              }
            }
          }

          // 4. Auto-resolve mismatch alerts for users that now match
          const { data: activeMismatchAlerts } = await supabase
            .from('sync_alerts')
            .select('id, entity_id')
            .eq('alert_type', 'clockify_hours_mismatch')
            .is('resolved_at', null);

          for (const alert of (activeMismatchAlerts || [])) {
            if (alert.entity_id && !mismatchedUserIds.includes(alert.entity_id)) {
              await supabase
                .from('sync_alerts')
                .update({
                  resolved_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', alert.id);

              alertsResolved++;
            }
          }

          console.log(
            `[sync-clockify] Hours mismatch reconciliation: ` +
            `${mismatchedUserIds.length} mismatches found, ` +
            `users checked: ${allUserIds.size}`,
          );
        } catch (hoursMismatchError) {
          // Hours mismatch reconciliation failure is non-blocking
          console.error(
            '[sync-clockify] Hours mismatch reconciliation error (non-blocking):',
            hoursMismatchError instanceof Error ? hoursMismatchError.message : String(hoursMismatchError),
          );
        }
      }

      reconciliationResult = {
        alerts_created: alertsCreated,
        alerts_resolved: alertsResolved,
        reconciliation_error: null,
      };

      console.log(`[sync-clockify] Reconciliation complete: ${alertsCreated} created, ${alertsResolved} resolved`);
    } catch (reconciliationError) {
      reconciliationResult = {
        alerts_created: 0,
        alerts_resolved: 0,
        reconciliation_error: reconciliationError instanceof Error
          ? reconciliationError.message
          : String(reconciliationError),
      };
      console.error(
        '[sync-clockify] Reconciliation error (non-blocking):',
        reconciliationResult.reconciliation_error,
      );
    }

    // =========================================================================
    // STEP 8: Return comprehensive summary JSON
    // =========================================================================
    const result = {
      success: fetchComplete && !upsertError,
      action: 'clockify_timesheet_sync_complete',
      sync_run_id: syncRunId,
      sync_run_at: syncRunAt,
      range_start: rangeStartISO,
      range_end: rangeEndISO,
      fetch: {
        complete: fetchComplete,
        pages_fetched: page,
        page_size: PAGE_SIZE,
        total_entries: allTimeEntries.length,
        hit_safety_limit: hitSafetyLimit,
        error_count: fetchErrors.length,
        errors: fetchErrors,
      },
      transform: {
        rows_built: rows.length,
        skipped_no_task_id: skippedNoTaskId,
        skipped_no_work_date: skippedNoWorkDate,
        skipped_zero_duration: skippedZeroDuration,
      },
      attribution: {
        unmapped_entries: clockifyUnmappedEntries,
        unmapped_hours: unmappedHours,
        alert: attributionAlertResult,
      },
      upsert: {
        rows_upserted: totalUpserted,
        batch_size: BATCH_SIZE,
        error: upsertError,
      },
      billing_config: billingConfigResult,
      cleanup: cleanupResult,
      rounding: roundingResult,
      layer2: layer2Result,
      taskMonthly: taskMonthlyResult,
      recalculation: recalcResult,
      reconciliation: reconciliationResult,
    };

    console.log(`[sync-clockify] Complete:`, JSON.stringify(result));

    // =========================================================================
    // STEP 9: Persist sync run to sync_runs table (diagnostics)
    // =========================================================================
    try {
      await supabase.from('sync_runs').insert({
        sync_type: 'clockify_timesheets',
        sync_run_id: syncRunId,
        started_at: syncRunAt,
        success: fetchComplete && !upsertError,
        source_total: rows.length,
        manifest_total: totalUpserted,
        deleted_count: deletedCount,
        source_hours: sourceHours,
        manifest_hours: manifestHours,
        // Rows written with project_id = NULL (134). withheld_location_entries
        // is left NULL on purpose: Clockify has no discriminator between a
        // permission failure and genuinely project-less time.
        unmapped_entries: clockifyUnmappedEntries,
        unmapped_hours: unmappedHours,
        error_message: upsertError || (fetchErrors.length > 0 ? fetchErrors[0].message : null),
        summary: result,
      });
    } catch (syncRunErr) {
      console.error('[sync-clockify] Failed to persist sync run (non-blocking):', syncRunErr);
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('[sync-clockify] Unhandled error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      500,
    );
  }
});
