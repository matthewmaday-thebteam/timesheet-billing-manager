// Run with: node --test scripts/sync-alert-tests/
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
//
// The block between the BEGIN/END sentinels below is a VERBATIM mirror of the
// same block in supabase/functions/sync-clickup-timesheets/index.ts. That file
// imports Deno/remote modules and cannot be imported from Node, and this repo's
// convention for Edge Functions is copy-paste rather than shared modules
// (see supabase/functions/_shared/qbo-token.ts, which is inlined by its
// callers). The final test in this file re-reads both sources and asserts the
// two copies are byte-identical, so they cannot silently drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// --- BEGIN PURE CLASSIFIER ---
type ClickUpEntryClass = 'mapped' | 'withheld' | 'untasked';

/** First N offending entry ids carried in alert metadata for diagnosis. */
const ALERT_SAMPLE_LIMIT = 10;

/** Minutes -> hours, rounded to 2dp (repo-wide hours convention). */
function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Classify a raw ClickUp time entry by whether Manifest can attribute it to a
 * project (folder).
 *
 * The 2026-09-10 permission incident proved the failure mode: when the sync
 * account loses read access to a Space, ClickUp keeps returning the entry AND
 * its `task` object but strips `task_location`. The row was then written with
 * project_id = NULL and saved anyway, silently losing attribution.
 *
 *   'withheld'  no folder id, but the entry carries a real task  -> the incident.
 *               Baseline is zero BY CONSTRUCTION: an entry attached to a task
 *               cannot legitimately have no folder. Alertable at >= 1.
 *   'untasked'  no folder id and no task at all -> a legitimate, recurring
 *               pattern (untasked manual time). Counted, never alerted on.
 *   'mapped'    folder id present -> attribution is intact.
 */
function classifyClickUpEntry(
  entry: Record<string, unknown> | null | undefined,
): ClickUpEntryClass {
  const taskLocation = entry?.task_location as Record<string, unknown> | null | undefined;
  const folderId = (taskLocation?.folder_id as string) || null;
  if (folderId) return 'mapped';

  const task = entry?.task;
  const taskId = (task !== null && typeof task === 'object')
    ? (task as Record<string, unknown>).id
    : null;
  const hasTaskId = taskId !== null && taskId !== undefined && String(taskId).length > 0;

  return hasTaskId ? 'withheld' : 'untasked';
}

/**
 * Graduated severity for the unmapped-location signal.
 * Returns null when no alert should be raised.
 */
function clickupUnmappedSeverity(
  withheldEntries: number,
  withheldHours: number,
  runSourceHours: number,
): 'warning' | 'error' | null {
  if (withheldEntries < 1) return null;
  const material = withheldHours >= 8
    || (runSourceHours > 0 && withheldHours >= runSourceHours * 0.05);
  return material ? 'error' : 'warning';
}
// --- END PURE CLASSIFIER ---

// =============================================================================
// classifyClickUpEntry
// =============================================================================

test('mapped: a full task_location with a folder_id is attributed', () => {
  assert.equal(
    classifyClickUpEntry({
      id: '4021001',
      task_location: { space_id: '9001', folder_id: '9002', folder_name: 'RFID Platform' },
      task: { id: '86abc123', name: 'Failing orders' },
    }),
    'mapped',
  );
});

test('withheld: task_location stripped but the task survives — the 2026-09-10 incident', () => {
  // ClickUp kept returning the entry and its task name while the sync account
  // had lost read access to the Space. project_id was written NULL and saved.
  assert.equal(
    classifyClickUpEntry({
      id: '4021002',
      task: { id: '86abc123', name: 'Failing orders' },
      description: '',
      billable: true,
    }),
    'withheld',
  );
});

test('withheld: task_location present but folder_id absent still loses attribution', () => {
  assert.equal(
    classifyClickUpEntry({
      id: '4021003',
      task_location: { space_id: '9001', space_name: 'Engineering' },
      task: { id: '86def456', name: 'API endpoint /get-orders-rfid optimization' },
    }),
    'withheld',
  );
});

test('withheld: an empty-string folder_id is not a folder', () => {
  assert.equal(
    classifyClickUpEntry({
      id: '4021004',
      task_location: { folder_id: '' },
      task: { id: '86def456', name: 'Some task' },
    }),
    'withheld',
  );
});

test('untasked: Kamen regression — task "0", no description, not billable', () => {
  // 21 rows / 86.50 h of genuinely untasked time. This is the ONLY legitimately
  // unmapped population in production and it must never alert.
  assert.equal(
    classifyClickUpEntry({ id: '4021005', task: '0', description: '', billable: false }),
    'untasked',
  );
});

test('untasked: task null', () => {
  assert.equal(classifyClickUpEntry({ id: '4021006', task: null }), 'untasked');
});

test('untasked: task is an object with no id', () => {
  assert.equal(classifyClickUpEntry({ id: '4021007', task: {} }), 'untasked');
});

test('untasked: task absent entirely, and a missing entry never throws', () => {
  assert.equal(classifyClickUpEntry({ id: '4021008' }), 'untasked');
  assert.equal(classifyClickUpEntry(null), 'untasked');
  assert.equal(classifyClickUpEntry(undefined), 'untasked');
});

// =============================================================================
// clickupUnmappedSeverity
// =============================================================================

test('no withheld entries — no alert', () => {
  assert.equal(clickupUnmappedSeverity(0, 0, 500), null);
});

test('one withheld entry is enough to warn (baseline is zero by construction)', () => {
  assert.equal(clickupUnmappedSeverity(1, 0.5, 500), 'warning');
});

test('Kamen: 21 untasked entries produce zero withheld entries and no alert', () => {
  const kamenEntries = Array.from({ length: 21 }, (_, i) => ({
    id: `kamen-${i}`,
    task: '0',
    description: '',
    billable: false,
  }));

  let withheldEntries = 0;
  let untaskedEntries = 0;
  for (const entry of kamenEntries) {
    const klass = classifyClickUpEntry(entry);
    if (klass === 'withheld') withheldEntries++;
    else if (klass === 'untasked') untaskedEntries++;
  }

  assert.equal(withheldEntries, 0);
  assert.equal(untaskedEntries, 21);
  // 86.50 h of untasked time, and still silent.
  assert.equal(clickupUnmappedSeverity(withheldEntries, 0, 86.5), null);
});

test('the real incident escalates to error', () => {
  assert.equal(clickupUnmappedSeverity(345, 1075.4, 1800), 'error');
});

test('escalation thresholds: >= 8 h absolute, or >= 5% of run source hours', () => {
  assert.equal(clickupUnmappedSeverity(1, 7.99, 5000), 'warning');
  assert.equal(clickupUnmappedSeverity(1, 8, 5000), 'error');       // absolute floor
  assert.equal(clickupUnmappedSeverity(3, 24.99, 500), 'error');     // 8 h floor dominates
  assert.equal(clickupUnmappedSeverity(3, 5, 100), 'error');         // exactly 5%
  assert.equal(clickupUnmappedSeverity(3, 4.99, 100), 'warning');    // just under 5%
  assert.equal(clickupUnmappedSeverity(1, 1, 0), 'warning');         // no source hours -> no ratio
});

// =============================================================================
// Shared helpers carried by the mirrored block
// =============================================================================

test('minutesToHours rounds to 2dp; ALERT_SAMPLE_LIMIT caps metadata samples', () => {
  assert.equal(minutesToHours(0), 0);
  assert.equal(minutesToHours(90), 1.5);
  assert.equal(minutesToHours(64524), 1075.4); // the incident's 1,075.40 h
  assert.equal(minutesToHours(5190), 86.5);    // Kamen's 86.50 h
  assert.equal(ALERT_SAMPLE_LIMIT, 10);
});

// =============================================================================
// Drift guard
// =============================================================================

test('the mirrored classifier is byte-identical to the Edge Function source', () => {
  // Markers are assembled at runtime so these literals do not match themselves.
  const begin = '// --- ' + 'BEGIN PURE CLASSIFIER ---';
  const end = '// --- ' + 'END PURE CLASSIFIER ---';

  const extract = (source: string, label: string): string => {
    const start = source.indexOf(begin);
    const stop = source.indexOf(end);
    assert.ok(start !== -1 && stop > start, `sentinels missing in ${label}`);
    return source.slice(start, stop + end.length).replace(/\r\n/g, '\n');
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const edgeFunction = readFileSync(
    path.join(repoRoot, 'supabase', 'functions', 'sync-clickup-timesheets', 'index.ts'),
    'utf8',
  );
  const thisFile = readFileSync(fileURLToPath(import.meta.url), 'utf8');

  assert.equal(
    extract(thisFile, 'this test file'),
    extract(edgeFunction, 'sync-clickup-timesheets/index.ts'),
    'The classifier in sync-clickup-timesheets/index.ts changed without updating this mirror.',
  );
});
