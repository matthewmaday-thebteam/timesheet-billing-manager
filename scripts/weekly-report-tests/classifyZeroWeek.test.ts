// Run with: node --test scripts/weekly-report-tests/classifyZeroWeek.test.ts
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
//
// Specification for the zero-week classifier used by the
// send-weekly-revenue-report edge function. The edge function carries a
// replicated copy of these functions (Deno cannot import from src/); this file
// is the authority on their behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyZeroWeek,
  countWeeksWithHours,
  sumPriorWeekHours,
} from '../../src/lib/weeklyReports/classifyZeroWeek.ts';

test('classifyZeroWeek: four zero weeks => expected (paused client, holiday)', () => {
  assert.equal(classifyZeroWeek([0, 0, 0, 0]), 'expected');
});

test('classifyZeroWeek: one non-zero prior week => anomalous', () => {
  assert.equal(classifyZeroWeek([0, 0, 0, 12.5]), 'anomalous');
  assert.equal(classifyZeroWeek([12.5, 0, 0, 0]), 'anomalous');
  assert.equal(classifyZeroWeek([0.01]), 'anomalous');
});

test('classifyZeroWeek: empty history (newly enabled company) => expected', () => {
  assert.equal(classifyZeroWeek([]), 'expected');
});

test('classifyZeroWeek: a fully active company => anomalous (the 2026-09-10 incident)', () => {
  assert.equal(classifyZeroWeek([268.75, 271.5, 264.25, 270.5]), 'anomalous');
});

test('countWeeksWithHours: counts only weeks with hours > 0', () => {
  assert.equal(countWeeksWithHours([]), 0);
  assert.equal(countWeeksWithHours([0, 0, 0, 0]), 0);
  assert.equal(countWeeksWithHours([0, 3, 0, 8]), 2);
  assert.equal(countWeeksWithHours([1, 2, 3, 4]), 4);
});

test('sumPriorWeekHours: totals to 2dp, ignores non-positive values', () => {
  assert.equal(sumPriorWeekHours([]), 0);
  assert.equal(sumPriorWeekHours([0, 0]), 0);
  assert.equal(sumPriorWeekHours([1.005, 2.005, 3.0]), 6.01);
  assert.equal(sumPriorWeekHours([268.75, 271.5, 264.25, 270.5]), 1075);
});
