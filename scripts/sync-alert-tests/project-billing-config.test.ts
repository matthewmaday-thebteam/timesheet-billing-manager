// Run with: node --test scripts/sync-alert-tests/*.test.ts
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
//
// The block between the BEGIN/END sentinels below is a VERBATIM mirror of the
// same block in BOTH sync Edge Functions. Those files import Deno/remote
// modules and cannot be imported from Node, and this repo's convention for
// Edge Functions is copy-paste rather than shared modules (see
// supabase/functions/_shared/qbo-token.ts, which is inlined by its callers).
// The final test in this file re-reads all three sources and asserts the copies
// are byte-identical, so they cannot silently drift.
//
// Every fixture below is a real production row, read from project ref
// yptbnsegcfpizwhipeep on 2026-09-17. Task-name lists are the real names,
// truncated to the ones that decide a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
// Production fixtures -- the three real ClickUp folder-ID migrations
// =============================================================================

/** Taggable, client_id 90159454334. The lineage the migrations broke away from. */
const TAGGABLE_LEGACY: ProjectWorkProfile = {
  externalId: '901513467233',
  name: 'No Project',
  firstWorkDate: '2026-01-05',
  lastWorkDate: '2026-08-17',
  userIds: ['100639076', '87366087'], // Dobromir Petrevski, Kamen Kamenov
  taskNames: [
    'Database cleanup',
    'Deployments',
    'Troubleshooting Issues',
    'Operator Portal - Dashboard, Payouts, Reports',
    'Customer Support',
    'Server Migration',
  ],
};

/** 1200690000003130 -- SLA Development. 48 + 40 = 88.00 h across the handover. */
const SLA_DEVELOPMENT: ProjectWorkProfile = {
  externalId: '1200690000003130',
  name: 'SLA Development',
  firstWorkDate: '2026-08-18',
  lastWorkDate: '2026-09-17',
  userIds: ['100639076', '87366087'],
  taskNames: [
    'Database cleanup',
    'Deployments',
    'Troubleshooting Issues',
    'Operator Portal - Dashboard, Payouts, Reports',
    'Machine setup',
    'Capture App V1 integration for photos',
  ],
};

/** 1200690000003417 -- the placeholder with no clean predecessor. */
const TAGGABLE_PLACEHOLDER: ProjectWorkProfile = {
  externalId: '1200690000003417',
  name: 'No Project',
  firstWorkDate: '2026-09-14',
  lastWorkDate: '2026-09-14',
  userIds: ['87366087'], // Kamen Kamenov
  taskNames: ['Photo uploader issue with Android devices'],
};

/** luxus, client_id 901511386927. 3.25 h, one entry, "App QA". */
const LUXUS_LEGACY: ProjectWorkProfile = {
  externalId: '901516728478',
  name: 'No Project',
  firstWorkDate: '2026-08-10',
  lastWorkDate: '2026-08-10',
  userIds: ['100767901'], // Valeri Stoyanov
  taskNames: ['App QA'],
};

/** 1200690000003113 -- Luxus project. 9.25 h, same person, same task name. */
const LUXUS_PROJECT: ProjectWorkProfile = {
  externalId: '1200690000003113',
  name: 'Luxus project',
  firstWorkDate: '2026-08-26',
  lastWorkDate: '2026-08-27',
  userIds: ['100767901'],
  taskNames: ['App QA'],
};

/** Every project the sweep would offer as a candidate on client 90159454334. */
const TAGGABLE_POOL = [TAGGABLE_LEGACY, SLA_DEVELOPMENT, TAGGABLE_PLACEHOLDER];
const LUXUS_POOL = [LUXUS_LEGACY, LUXUS_PROJECT];

// =============================================================================
// classifyProjectBillingConfig -- the financial invariant
// =============================================================================

test('all three folder-ID migrations would have been caught at creation time', () => {
  // At creation each had a projects row and neither a project_monthly_rates nor
  // a project_group_members row: get_effective_project_rate -> RAISE WARNING ->
  // get_default_rate() = $45.00 with rate_source 'default'.
  const atCreation = { isGroupMember: false, hasRateRow: false, hasRoundingRow: false };
  assert.equal(classifyProjectBillingConfig(atCreation), 'missing_rate');
  assert.equal(projectBillingConfigSeverity(classifyProjectBillingConfig(atCreation)), 'error');
});

test('remediated by grouping: 1200690000003113 and 1200690000003130 no longer fire', () => {
  // Both were fixed by project_group_members rows. Billing resolves a member
  // through its group primary, so its own empty config rows are correct.
  assert.equal(
    classifyProjectBillingConfig({ isGroupMember: true, hasRateRow: false, hasRoundingRow: false }),
    'configured',
  );
});

test('remediated by explicit rows: 1200690000003417 no longer fires', () => {
  // Fixed with its own rate + rounding rows rather than a group.
  assert.equal(
    classifyProjectBillingConfig({ isGroupMember: false, hasRateRow: true, hasRoundingRow: true }),
    'configured',
  );
});

test('a correctly configured project never fires -- 901513467233, $50 from 2026-03-01, 15/entry from 2026-04-01', () => {
  const control = { isGroupMember: false, hasRateRow: true, hasRoundingRow: true };
  assert.equal(classifyProjectBillingConfig(control), 'configured');
  assert.equal(projectBillingConfigSeverity(classifyProjectBillingConfig(control)), null);
});

test('rate present but rounding absent is its own, lesser signal', () => {
  // get_effective_project_rounding falls back to the 'task' mode, silently
  // changing the billable hour basis -- 2.25 h on one project-month here.
  const status = classifyProjectBillingConfig({
    isGroupMember: false,
    hasRateRow: true,
    hasRoundingRow: false,
  });
  assert.equal(status, 'missing_rounding');
  assert.equal(projectBillingConfigSeverity(status), 'warning');
});

test('a missing rate outranks a missing rounding -- one alert, the worse one', () => {
  assert.equal(
    classifyProjectBillingConfig({ isGroupMember: false, hasRateRow: false, hasRoundingRow: true }),
    'missing_rate',
  );
});

test('group membership wins over every other fact', () => {
  for (const hasRateRow of [true, false]) {
    for (const hasRoundingRow of [true, false]) {
      assert.equal(
        classifyProjectBillingConfig({ isGroupMember: true, hasRateRow, hasRoundingRow }),
        'configured',
      );
    }
  }
});

// =============================================================================
// findSuccessionCandidates / summarizeSuccession -- advisory only
// =============================================================================

test('1200690000003130: contiguous 08-17 -> 08-18, same resources, shared task names', () => {
  const summary = summarizeSuccession(findSuccessionCandidates(SLA_DEVELOPMENT, TAGGABLE_POOL));

  assert.ok(summary.candidate, 'expected a named predecessor');
  assert.equal(summary.candidate.external_id, '901513467233');
  assert.equal(summary.candidate.confidence, 'likely');
  assert.equal(summary.candidate.contiguous_handover, true);
  assert.equal(summary.candidate.gap_days, 1);
  assert.equal(summary.candidate.handover, '2026-08-17 -> 2026-08-18');
  assert.equal(summary.candidate.resource_continuity, true);
  assert.deepEqual(summary.candidate.shared_user_ids, ['100639076', '87366087']);
  assert.equal(summary.candidate.task_continuity, true);
  assert.deepEqual(summary.candidate.shared_task_names, [
    'Database cleanup',
    'Deployments',
    'Troubleshooting Issues',
    'Operator Portal - Dashboard, Payouts, Reports',
  ]);
  assert.equal(summary.ambiguous, false);
});

test('1200690000003113: "App QA" -> "App QA" was decisive, across a 16-day gap', () => {
  const summary = summarizeSuccession(findSuccessionCandidates(LUXUS_PROJECT, LUXUS_POOL));

  assert.ok(summary.candidate, 'expected a named predecessor');
  assert.equal(summary.candidate.external_id, '901516728478');
  assert.equal(summary.candidate.confidence, 'likely');
  assert.equal(summary.candidate.gap_days, 16);
  assert.deepEqual(summary.candidate.shared_user_ids, ['100767901']);
  assert.deepEqual(summary.candidate.shared_task_names, ['App QA']);
  assert.equal(summary.ambiguous, false);
});

test('1200690000003417: alerts, but asserts NO confident candidate', () => {
  const summary = summarizeSuccession(findSuccessionCandidates(TAGGABLE_PLACEHOLDER, TAGGABLE_POOL));

  // The invariant still fires for this project -- only the hint is withheld.
  assert.equal(summary.candidate, null);
  assert.equal(summary.ambiguous, true);
  assert.equal(summary.note, '1 partial match only, no full match');

  // 901513467233 shares the resource and lands inside the handover window, but
  // "Photo uploader issue with Android devices" appears nowhere before it.
  assert.equal(summary.candidates.length, 1);
  assert.equal(summary.candidates[0].external_id, '901513467233');
  assert.equal(summary.candidates[0].confidence, 'possible');
  assert.equal(summary.candidates[0].task_continuity, false);
});

test('an overlapping project is never a predecessor', () => {
  // SLA Development was still running on 2026-09-17 when the placeholder opened
  // on 2026-09-14, so it cannot be a handover however well the people match.
  const candidates = findSuccessionCandidates(TAGGABLE_PLACEHOLDER, TAGGABLE_POOL);
  assert.equal(candidates.some((c) => c.external_id === '1200690000003130'), false);
});

test('a project is never its own predecessor', () => {
  const candidates = findSuccessionCandidates(SLA_DEVELOPMENT, TAGGABLE_POOL);
  assert.equal(candidates.some((c) => c.external_id === SLA_DEVELOPMENT.externalId), false);
});

test('resource continuity accepts a strict subset, rejects a stranger', () => {
  const subset = findSuccessionCandidates(
    { ...SLA_DEVELOPMENT, userIds: ['87366087'] },
    [TAGGABLE_LEGACY],
  );
  assert.equal(subset[0].resource_continuity, true);

  const stranger = findSuccessionCandidates(
    { ...SLA_DEVELOPMENT, userIds: ['87366087', '695d2fd8a08e830e6c32b0fe'] },
    [TAGGABLE_LEGACY],
  );
  assert.equal(stranger[0].resource_continuity, false);
  assert.equal(stranger[0].confidence, 'possible'); // contiguity + tasks only
});

test('task names match case- and whitespace-insensitively, reported as the successor spells them', () => {
  const [candidate] = findSuccessionCandidates(
    { ...LUXUS_PROJECT, taskNames: ['  app   qa  '] },
    [LUXUS_LEGACY],
  );
  assert.equal(candidate.task_continuity, true);
  assert.deepEqual(candidate.shared_task_names, ['  app   qa  ']);
});

test('the handover window: 31 days in, 32 days out', () => {
  const inWindow = findSuccessionCandidates(
    { ...LUXUS_PROJECT, firstWorkDate: '2026-09-10' }, // 31 days after 08-10
    [LUXUS_LEGACY],
  );
  assert.equal(inWindow[0].contiguous_handover, true);
  assert.equal(inWindow[0].gap_days, 31);

  const outOfWindow = findSuccessionCandidates(
    { ...LUXUS_PROJECT, firstWorkDate: '2026-09-11' }, // 32 days
    [LUXUS_LEGACY],
  );
  assert.equal(outOfWindow[0].contiguous_handover, false);
  assert.equal(outOfWindow[0].gap_days, null);
  assert.equal(outOfWindow[0].confidence, 'possible');
});

test('a project that went quiet before the lookback window is a different era, not a handover', () => {
  const stale = findSuccessionCandidates(
    { ...LUXUS_PROJECT, firstWorkDate: '2027-01-01' }, // 144 days after 08-10
    [LUXUS_LEGACY],
  );
  assert.deepEqual(stale, []);
});

test('one signal is noise and is dropped', () => {
  const unrelated: ProjectWorkProfile = {
    externalId: '999',
    name: 'Unrelated',
    firstWorkDate: '2026-08-01',
    lastWorkDate: '2026-08-15',
    userIds: ['nobody'],
    taskNames: ['Nothing in common'],
  };
  assert.deepEqual(findSuccessionCandidates(SLA_DEVELOPMENT, [unrelated]), []);
});

test('two full matches are ambiguous and neither is asserted', () => {
  const twin: ProjectWorkProfile = { ...TAGGABLE_LEGACY, externalId: '901513467999' };
  const summary = summarizeSuccession(
    findSuccessionCandidates(SLA_DEVELOPMENT, [TAGGABLE_LEGACY, twin]),
  );
  assert.equal(summary.candidate, null);
  assert.equal(summary.ambiguous, true);
  assert.match(summary.note, /ambiguous, asserting none/);
});

test('no candidates at all is reported as absence, not ambiguity', () => {
  const summary = summarizeSuccession([]);
  assert.equal(summary.candidate, null);
  assert.equal(summary.ambiguous, false);
  assert.equal(summary.note, 'no predecessor found on this client');
});

test('ranking is deterministic so the alert text does not churn between syncs', () => {
  const first = findSuccessionCandidates(TAGGABLE_PLACEHOLDER, TAGGABLE_POOL);
  const second = findSuccessionCandidates(TAGGABLE_PLACEHOLDER, [...TAGGABLE_POOL].reverse());
  assert.deepEqual(first, second);
});

// =============================================================================
// buildBillingConfigAlertTitle -- the dashboard renders nothing else
// =============================================================================

test('the missing-rate title carries name, external id, client, the default rate and the fix', () => {
  const title = buildBillingConfigAlertTitle({
    status: 'missing_rate',
    projectName: 'SLA Development',
    externalId: '1200690000003130',
    clientName: 'Taggable',
    hoursAccumulated: 93.73,
    firstSeenMonth: '2026-08-01',
    succession: summarizeSuccession(findSuccessionCandidates(SLA_DEVELOPMENT, TAGGABLE_POOL)),
  });

  assert.match(title, /SLA Development/);
  assert.match(title, /1200690000003130/);
  assert.match(title, /client Taggable/);
  assert.match(title, /93\.73 h logged/);
  assert.match(title, /\$45\.00 default rate/);
  assert.match(title, /Likely predecessor "No Project" \(external id 901513467233\)/);
  assert.match(title, /contiguous handover 2026-08-17 -> 2026-08-18/);
  assert.match(title, /Advisory only -- nothing was attached automatically/);
  assert.match(title, /Fix:/);
});

test('an ambiguous title names no predecessor', () => {
  const title = buildBillingConfigAlertTitle({
    status: 'missing_rate',
    projectName: 'No Project',
    externalId: '1200690000003417',
    clientName: 'Taggable',
    hoursAccumulated: 7,
    firstSeenMonth: '2026-09-01',
    succession: summarizeSuccession(findSuccessionCandidates(TAGGABLE_PLACEHOLDER, TAGGABLE_POOL)),
  });

  assert.match(title, /1200690000003417/);
  assert.match(title, /\$45\.00 default rate/);
  assert.match(title, /No confident predecessor/);
  assert.equal(/Likely predecessor/.test(title), false);
});

test('the missing-rounding title says rate is fine and the hour basis is not', () => {
  const title = buildBillingConfigAlertTitle({
    status: 'missing_rounding',
    projectName: 'Butler',
    externalId: '69d37e5197ee35281c77fa67',
    clientName: 'The B Team',
    hoursAccumulated: 120.5,
    firstSeenMonth: '2026-04-01',
    succession: null,
  });

  assert.match(title, /has a rate but no rounding row/);
  assert.match(title, /"task" rounding default/);
  assert.match(title, /billable hour basis/);
  assert.equal(/\$45\.00 default rate/.test(title), false);
});

test('a title survives a missing client, unknown hours and a runaway name', () => {
  const title = buildBillingConfigAlertTitle({
    status: 'missing_rate',
    projectName: 'x'.repeat(200),
    externalId: '1200690000009999',
    clientName: null,
    hoursAccumulated: null,
    firstSeenMonth: null,
    succession: null,
  });

  assert.match(title, /no client/);
  assert.match(title, /hours not evaluated/);
  // A search that did not run must never read as "there is no predecessor".
  assert.match(title, /Predecessor search did not run/);
  assert.ok(title.length < 600, `title ran away: ${title.length} chars`);
});

// =============================================================================
// Helpers carried by the mirrored block
// =============================================================================

test('wholeDaysBetween and shiftDateISO are calendar-day exact', () => {
  assert.equal(wholeDaysBetween('2026-08-17', '2026-08-18'), 1);
  assert.equal(wholeDaysBetween('2026-08-10', '2026-08-26'), 16);
  assert.equal(wholeDaysBetween('2026-08-18', '2026-08-17'), -1);
  assert.ok(Number.isNaN(wholeDaysBetween('not-a-date', '2026-08-18')));
  assert.equal(shiftDateISO('2026-09-14', -120), '2026-05-17');
  assert.equal(shiftDateISO('nonsense', -1), '');
});

test('the constants match the database defaults they stand in for', () => {
  assert.equal(DEFAULT_RATE_USD, 45);            // get_default_rate()
  assert.equal(DEFAULT_ROUNDING_MODE, 'task');   // get_effective_project_rounding fallback
  assert.equal(SUCCESSION_LOOKBACK_DAYS, 120);
  assert.equal(SUCCESSION_MAX_GAP_DAYS, 31);
  assert.equal(SUCCESSION_TITLE_SAMPLE, 3);
  assert.equal(TITLE_NAME_MAX_CHARS, 60);
});

// =============================================================================
// Drift guard
// =============================================================================

test('the mirrored block is byte-identical in both Edge Functions', () => {
  // Markers are assembled at runtime so these literals do not match themselves.
  const begin = '// --- ' + 'BEGIN PURE BILLING CONFIG ---';
  const end = '// --- ' + 'END PURE BILLING CONFIG ---';

  const extract = (source: string, label: string): string => {
    const start = source.indexOf(begin);
    const stop = source.indexOf(end);
    assert.ok(start !== -1 && stop > start, `sentinels missing in ${label}`);
    return source.slice(start, stop + end.length).replace(/\r\n/g, '\n');
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const mine = extract(readFileSync(fileURLToPath(import.meta.url), 'utf8'), 'this test file');

  for (const fn of ['sync-clickup-timesheets', 'sync-clockify-timesheets']) {
    const source = readFileSync(
      path.join(repoRoot, 'supabase', 'functions', fn, 'index.ts'),
      'utf8',
    );
    assert.equal(
      mine,
      extract(source, `${fn}/index.ts`),
      `The billing-config block in ${fn}/index.ts changed without updating this mirror.`,
    );
  }
});
