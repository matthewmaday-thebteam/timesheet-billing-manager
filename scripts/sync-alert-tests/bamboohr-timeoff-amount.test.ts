// =============================================================================
// Tests for parseTimeOffDays (sync-bamboohr-timeoff)
// =============================================================================
// Run from the repo root:
//   deno test scripts/sync-alert-tests/bamboohr-timeoff-amount.test.ts
//   node --test scripts/sync-alert-tests/*.test.ts
//
// Regression: Parental leave is tracked in HOURS in BambooHR. Request 2128
// (1408 hours) was stored as 1408 "days", overflowing total_days numeric(5,2)
// and failing every sync from 2026-10-21.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTimeOffDays } from '../../supabase/functions/sync-bamboohr-timeoff/_lib/timeOffAmount.ts';

test('a days object returns the amount unchanged', () => {
  assert.equal(parseTimeOffDays({ unit: 'days', amount: '3' }, 1), 3);
  assert.equal(parseTimeOffDays({ unit: 'days', amount: '0.5' }, 1), 0.5);
  assert.equal(parseTimeOffDays({ unit: 'days', amount: 2 }, 1), 2);
});

test('an hours object converts at 8 hours per workday', () => {
  assert.equal(parseTimeOffDays({ unit: 'hours', amount: '240' }, 2116), 30);
  assert.equal(parseTimeOffDays({ unit: 'hours', amount: '1408' }, 2128), 176);
  assert.equal(parseTimeOffDays({ unit: 'hours', amount: 4 }, 1), 0.5);
});

test('hours conversion rounds to 2 decimals so it fits numeric(5,2)', () => {
  assert.equal(parseTimeOffDays({ unit: 'hours', amount: '1' }, 1), 0.13); // 0.125
  assert.equal(parseTimeOffDays({ unit: 'hours', amount: '10' }, 1), 1.25);
  assert.equal(parseTimeOffDays({ unit: 'hours', amount: '7.5' }, 1), 0.94); // 0.9375
});

test('a bare number or numeric string is treated as days (legacy shape)', () => {
  assert.equal(parseTimeOffDays(5, 1), 5);
  assert.equal(parseTimeOffDays('2.5', 1), 2.5);
});

test('a missing amount is 0, as before', () => {
  assert.equal(parseTimeOffDays(undefined, 1), 0);
  assert.equal(parseTimeOffDays(null, 1), 0);
  assert.equal(parseTimeOffDays({ unit: 'days' }, 1), 0);
  assert.equal(parseTimeOffDays({ unit: 'hours', amount: '' }, 1), 0);
});

test('an unknown unit throws, naming the request id and the unit', () => {
  assert.throws(
    () => parseTimeOffDays({ unit: 'weeks', amount: '2' }, 4242),
    (err: Error) => err.message.includes('4242') && err.message.includes('"weeks"'),
  );
});

test('an amount object with no unit throws rather than guessing', () => {
  assert.throws(
    () => parseTimeOffDays({ amount: '8' }, 77),
    (err: Error) => err.message.includes('77') && err.message.includes('undefined'),
  );
});
