// =============================================================================
// translateBatch — pure, network-free helpers for the AI-translation path.
// =============================================================================
// Shared BY COPY between the browser/test build (src/lib/expenses) and BOTH
// edge functions (ingest-expenses/_lib, translate-expense-descriptions/_lib).
// Keep all three copies byte-identical. Nothing here imports React, Supabase,
// Deno, or performs I/O — it is safe in browser, Deno, and Node, and is the
// unit-tested seam for the batch-cap / response-parse / needs-review logic.
//
// Why these helpers exist (root cause of the 2026-07-01 ingest miss):
//   - The original in-ingest fallback ran an UNBOUNDED number of sequential
//     Anthropic calls (one per 50 dictionary-misses) BEFORE committing rows —
//     an execution-budget hazard on large uploads. `planBatches` bounds the AI
//     work per invocation so whatever is not translated simply stays 'none'
//     for the backlog processor to finish later.
//   - It asked the model to echo each Cyrillic key verbatim as a JSON *object*
//     key and matched on that; models rarely echo keys byte-for-byte, so most
//     translations silently missed. `parseTranslationArray` consumes an
//     index-aligned JSON *array* (values only) instead — nothing to echo.
// =============================================================================

/** Anthropic batch size — number of unique descriptions per Messages call. */
export const AI_BATCH_SIZE = 50;

/**
 * Per-invocation batch cap for the IN-INGEST fallback. Bounds how much
 * sequential Anthropic work a single (possibly 800+ row) ingest can trigger so
 * the translate step can never threaten the edge function's wall-clock budget.
 * Keys beyond the cap stay 'none' and are picked up by the backlog processor.
 */
export const INGEST_MAX_AI_BATCHES = 2;

/**
 * Per-invocation batch cap for the BACKLOG processor
 * (translate-expense-descriptions). The processor returns {remaining} and is
 * re-invoked by the admin UI until the backlog is drained, so each call stays
 * comfortably inside the execution budget.
 */
export const BACKLOG_MAX_AI_BATCHES = 8;

/**
 * Default Anthropic model for expense translation. Overridable per environment
 * via EXPENSES_TRANSLATE_MODEL. `claude-haiku-4-5` is a current, valid model id
 * (verified against the model catalog on 2026-07-02) — fast and low-cost, which
 * suits short bank-description translation.
 */
export const EXPENSES_TRANSLATE_FALLBACK_MODEL = 'claude-haiku-4-5';

export interface BatchPlan {
  /** The batches to translate this invocation (at most `maxBatches`). */
  batches: string[][];
  /** Keys not attempted this invocation (over the cap) — remain 'none'. */
  remaining: string[];
}

/**
 * Split `keys` into ≤`batchSize` chunks, keeping at most `maxBatches` of them.
 * Any keys beyond the cap are returned in `remaining` (they stay 'none' and are
 * handled by a later invocation). Pure — no I/O, deterministic.
 */
export function planBatches(
  keys: readonly string[],
  batchSize: number,
  maxBatches: number,
): BatchPlan {
  const safeBatch = Math.max(1, Math.floor(batchSize));
  const cap = Math.max(0, Math.floor(maxBatches));
  const batches: string[][] = [];
  let i = 0;
  for (; i < keys.length && batches.length < cap; i += safeBatch) {
    batches.push(keys.slice(i, i + safeBatch));
  }
  return { batches, remaining: keys.slice(i) };
}

/**
 * Parse the model's reply into an array of English translations aligned to the
 * input batch order. Returns [] on any malformed / truncated output so a bad
 * batch degrades to 'none' rather than throwing (never fails ingestion). Pure.
 */
export function parseTranslationArray(text: string): string[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => (typeof v === 'string' ? v : ''));
  } catch {
    return [];
  }
}

/**
 * needs_review clearing rule (financial-integrity constraint).
 *
 * Clearing needs_review after a successful AI translation is safe ONLY when the
 * MISSING TRANSLATION was the sole reason the row was flagged. We approximate
 * this conservatively from the persisted `category_source`:
 *
 *   - 'vendor_rule' | 'manual' → the category was resolved deterministically or
 *     by a human, so translation was the only open item → SAFE to clear.
 *   - 'keyword_rule'           → may carry a force_review flag we do not persist
 *     → leave flagged for a human.
 *   - 'fallback' (and null)    → no real category was assigned → leave flagged.
 *
 * Over-flagging is safe (a human still sees it); wrongly clearing is not — so we
 * only clear the two provably-safe cases. Pure.
 */
export function canClearNeedsReviewAfterTranslation(
  categorySource: string | null | undefined,
): boolean {
  return categorySource === 'vendor_rule' || categorySource === 'manual';
}
