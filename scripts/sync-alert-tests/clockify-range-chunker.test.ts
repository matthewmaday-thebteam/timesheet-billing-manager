// =============================================================================
// Tests for splitRangeByCalendarMonth (sync-clockify-timesheets)
// =============================================================================
// Run from the repo root:  node --test scripts/sync-alert-tests/*.test.ts
//
// The sentinel block below is a VERBATIM mirror of the one in
// supabase/functions/sync-clockify-timesheets/index.ts. The final test asserts
// the two copies are byte-identical, so edit both together.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- BEGIN PURE RANGE CHUNKER ---
/**
 * Splits an ISO date range into contiguous chunks that each lie inside one UTC
 * calendar month, so no chunk spans more than 31 days.
 *
 * Why: Clockify's April 2026 plan change caps a detailed report on the Free
 * plan at one month (31 days), enforced per workspace. This workspace started
 * getting 400 Bad Request on 2026-10-12 because the automated window (14-day
 * lookback + current month) is about 45 days long.
 *
 * The first chunk starts at startISO exactly; each chunk ends at the last
 * millisecond of its month or at endISO, whichever is earlier; the next chunk
 * starts 1 ms later (the first millisecond of the following month). Invalid
 * input (unparseable, or end before start) is returned as a single untouched
 * chunk so the API reports the problem exactly as it did before.
 */
function splitRangeByCalendarMonth(
  startISO: string,
  endISO: string,
): Array<{ start: string; end: string }> {
  const startMs = Date.parse(startISO);
  const endMs = Date.parse(endISO);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return [{ start: startISO, end: endISO }];
  }

  const chunks: Array<{ start: string; end: string }> = [];
  let chunkStartMs = startMs;
  let chunkStartISO = startISO;

  while (true) {
    const chunkStartDate = new Date(chunkStartMs);
    const nextMonthStartMs = Date.UTC(
      chunkStartDate.getUTCFullYear(),
      chunkStartDate.getUTCMonth() + 1,
      1,
      0, 0, 0, 0,
    );
    const monthEndMs = nextMonthStartMs - 1;

    if (endMs <= monthEndMs) {
      chunks.push({ start: chunkStartISO, end: endISO });
      return chunks;
    }

    chunks.push({ start: chunkStartISO, end: new Date(monthEndMs).toISOString() });
    chunkStartMs = nextMonthStartMs;
    chunkStartISO = new Date(nextMonthStartMs).toISOString();
  }
}
// --- END PURE RANGE CHUNKER ---

// =============================================================================
// Helpers
// =============================================================================

const DAY_MS = 86_400_000;

type Chunk = { start: string; end: string };

/** Invariants every valid split must satisfy. */
function assertWellFormed(chunks: Chunk[], startISO: string, endISO: string): void {
  assert.ok(chunks.length >= 1, 'at least one chunk');
  assert.equal(chunks[0].start, startISO, 'first chunk starts at input start');
  assert.equal(chunks[chunks.length - 1].end, endISO, 'last chunk ends at input end');

  chunks.forEach((chunk, i) => {
    const startMs = Date.parse(chunk.start);
    const endMs = Date.parse(chunk.end);
    assert.ok(endMs >= startMs, `chunk ${i} is not inverted`);
    assert.ok(endMs - startMs < 31 * DAY_MS, `chunk ${i} spans less than 31 days`);
    assert.equal(
      new Date(startMs).getUTCMonth(),
      new Date(endMs).getUTCMonth(),
      `chunk ${i} lies inside one UTC month`,
    );
    if (i > 0) {
      assert.equal(startMs, Date.parse(chunks[i - 1].end) + 1, `chunk ${i} is contiguous with chunk ${i - 1}`);
    }
  });
}

// =============================================================================
// Cases
// =============================================================================

test('the automated window (Sep 17 -> Oct 31) splits into Sep and Oct chunks', () => {
  const start = '2026-09-17T00:00:00.000Z';
  const end = '2026-10-31T23:59:59.999Z';
  const chunks = splitRangeByCalendarMonth(start, end);
  assert.deepEqual(chunks, [
    { start: '2026-09-17T00:00:00.000Z', end: '2026-09-30T23:59:59.999Z' },
    { start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T23:59:59.999Z' },
  ]);
  assertWellFormed(chunks, start, end);
});

test('a range inside one month returns one chunk identical to the input', () => {
  const start = '2026-10-01T00:00:00.000Z';
  const end = '2026-10-31T23:59:59.999Z';
  const chunks = splitRangeByCalendarMonth(start, end);
  assert.deepEqual(chunks, [{ start, end }]);
  assertWellFormed(chunks, start, end);
});

test('two full months (Sep 1 -> Oct 31) return two chunks', () => {
  const start = '2026-09-01T00:00:00.000Z';
  const end = '2026-10-31T23:59:59.999Z';
  const chunks = splitRangeByCalendarMonth(start, end);
  assert.deepEqual(chunks, [
    { start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T23:59:59.999Z' },
    { start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T23:59:59.999Z' },
  ]);
  assertWellFormed(chunks, start, end);
});

test('a range across the year boundary returns three chunks ending at the input end', () => {
  const start = '2025-12-20T00:00:00.000Z';
  const end = '2026-02-15T12:00:00.000Z';
  const chunks = splitRangeByCalendarMonth(start, end);
  assert.deepEqual(chunks, [
    { start: '2025-12-20T00:00:00.000Z', end: '2025-12-31T23:59:59.999Z' },
    { start: '2026-01-01T00:00:00.000Z', end: '2026-01-31T23:59:59.999Z' },
    { start: '2026-02-01T00:00:00.000Z', end: '2026-02-15T12:00:00.000Z' },
  ]);
  assertWellFormed(chunks, start, end);
});

test('every automated window for 2025-2027 is well formed and has at most two chunks', () => {
  for (let year = 2025; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      const firstOfMonth = Date.UTC(year, month, 1);
      const start = new Date(firstOfMonth - 14 * DAY_MS).toISOString();
      const end = new Date(Date.UTC(year, month + 1, 1) - 1).toISOString();
      const chunks = splitRangeByCalendarMonth(start, end);
      assert.equal(chunks.length, 2, `${start}..${end}`);
      assertWellFormed(chunks, start, end);
    }
  }
});

test('invalid input returns the single untouched chunk', () => {
  const valid = '2026-10-01T00:00:00.000Z';
  assert.deepEqual(splitRangeByCalendarMonth('not-a-date', valid), [{ start: 'not-a-date', end: valid }]);
  assert.deepEqual(splitRangeByCalendarMonth(valid, 'not-a-date'), [{ start: valid, end: 'not-a-date' }]);

  const later = '2026-10-31T23:59:59.999Z';
  assert.deepEqual(splitRangeByCalendarMonth(later, valid), [{ start: later, end: valid }]);
});

// =============================================================================
// Drift guard
// =============================================================================

test('the mirrored chunker is byte-identical to the Edge Function source', () => {
  // Markers are assembled at runtime so these literals do not match themselves.
  const begin = '// --- ' + 'BEGIN PURE RANGE CHUNKER ---';
  const end = '// --- ' + 'END PURE RANGE CHUNKER ---';

  const extract = (source: string, label: string): string => {
    const start = source.indexOf(begin);
    const stop = source.indexOf(end);
    assert.ok(start !== -1 && stop > start, `sentinels missing in ${label}`);
    return source.slice(start, stop + end.length);
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const edgeFunction = readFileSync(
    path.join(repoRoot, 'supabase', 'functions', 'sync-clockify-timesheets', 'index.ts'),
    'utf8',
  );
  const thisFile = readFileSync(fileURLToPath(import.meta.url), 'utf8');

  assert.equal(
    extract(thisFile, 'this test file'),
    extract(edgeFunction, 'sync-clockify-timesheets/index.ts'),
    'The chunker in sync-clockify-timesheets/index.ts changed without updating this mirror.',
  );
});
