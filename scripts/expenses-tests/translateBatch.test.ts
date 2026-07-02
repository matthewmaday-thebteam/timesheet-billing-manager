// Run with: node --test scripts/expenses-tests/*.test.ts
// Pure-logic coverage for the AI-translation seam (translateBatch.ts). No
// network is exercised — only the batch-cap, response-parse, and needs-review
// clearing rules, which are the parts that decide correctness on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planBatches,
  parseTranslationArray,
  canClearNeedsReviewAfterTranslation,
  AI_BATCH_SIZE,
} from '../../src/lib/expenses/translateBatch.ts';

const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);

test('planBatches: chunks by batchSize and enforces the batch cap', () => {
  // 250 keys, size 50, cap 2 → 2 batches of 50, 150 remaining (the 2b→backlog
  // and the 2a→in-ingest behaviour that fixes the unbounded original).
  const { batches, remaining } = planBatches(keys(250), 50, 2);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 50);
  assert.equal(batches[1].length, 50);
  assert.equal(remaining.length, 150);
  // No key is lost or duplicated across batches + remaining.
  const seen = new Set([...batches.flat(), ...remaining]);
  assert.equal(seen.size, 250);
});

test('planBatches: last partial batch + everything fits under the cap', () => {
  const { batches, remaining } = planBatches(keys(120), 50, 8);
  assert.deepEqual(
    batches.map((b) => b.length),
    [50, 50, 20],
  );
  assert.equal(remaining.length, 0);
});

test('planBatches: empty input and zero cap are safe no-ops', () => {
  assert.deepEqual(planBatches([], 50, 2), { batches: [], remaining: [] });
  const { batches, remaining } = planBatches(keys(10), 50, 0);
  assert.equal(batches.length, 0);
  assert.equal(remaining.length, 10);
});

test('parseTranslationArray: parses a clean JSON array', () => {
  assert.deepEqual(parseTranslationArray('["fee","payment"]'), ['fee', 'payment']);
});

test('parseTranslationArray: tolerates surrounding prose / code fences', () => {
  assert.deepEqual(
    parseTranslationArray('Here you go:\n```json\n["a","b"]\n```'),
    ['a', 'b'],
  );
});

test('parseTranslationArray: truncated / malformed output degrades to []', () => {
  // The original 4096-token cap truncated large batches; the fix returns [] so
  // the batch degrades to "none" instead of throwing and losing everything.
  assert.deepEqual(parseTranslationArray('["a","b","truncat'), []);
  assert.deepEqual(parseTranslationArray('not json at all'), []);
  assert.deepEqual(parseTranslationArray('{"a":"b"}'), []); // object, not array
});

test('parseTranslationArray: non-string elements coerce to empty strings', () => {
  // Empty strings are treated as "no translation" by the caller (skipped).
  assert.deepEqual(parseTranslationArray('["ok", 5, null, "fine"]'), ['ok', '', '', 'fine']);
});

test('canClearNeedsReviewAfterTranslation: only vendor_rule and manual clear', () => {
  assert.equal(canClearNeedsReviewAfterTranslation('vendor_rule'), true);
  assert.equal(canClearNeedsReviewAfterTranslation('manual'), true);
  // keyword_rule may carry an unpersisted force_review flag → keep flagged.
  assert.equal(canClearNeedsReviewAfterTranslation('keyword_rule'), false);
  // fallback has no real category → keep flagged.
  assert.equal(canClearNeedsReviewAfterTranslation('fallback'), false);
  assert.equal(canClearNeedsReviewAfterTranslation(null), false);
  assert.equal(canClearNeedsReviewAfterTranslation(undefined), false);
});

test('AI_BATCH_SIZE is the expected 50', () => {
  assert.equal(AI_BATCH_SIZE, 50);
});
