// =============================================================================
// anthropicTranslate — capped Anthropic Messages API translation (Deno only).
// =============================================================================
// Shared BY COPY between the ingest-expenses and translate-expense-descriptions
// edge functions. Keep both copies byte-identical. Not part of the browser/test
// build (it performs network I/O) — the pure, tested logic lives in
// translateBatch.ts, which this module orchestrates.
//
// Robustness fixes over the original inline ingest implementation (which
// translated only a handful of rows on the 2026-07-01 812-row ingest, then
// silently degraded the rest to 'none'):
//   1. Index-aligned JSON ARRAY output (values only) instead of a verbatim-keyed
//      JSON object — the model no longer has to echo each Cyrillic key
//      byte-for-byte, which was silently dropping most translations.
//   2. max_tokens sized for a full 50-row batch (the old 4096 truncated large
//      batches; the truncated JSON then failed to parse → whole batch lost).
//   3. Non-OK HTTP responses are LOGGED (was a bare `continue`) so 429 / 529 /
//      model errors leave a trace instead of vanishing.
//   4. A per-invocation batch cap + optional wall-clock budget bound total AI
//      time so translation can never exhaust the function's execution budget;
//      whatever is not translated is returned in `remaining` and stays 'none'.
// =============================================================================

import { AI_BATCH_SIZE, parseTranslationArray, planBatches } from './translateBatch.ts';

const SYSTEM_PROMPT =
  'You translate Bulgarian bank-transaction descriptions into concise English. ' +
  'The input is a JSON array of strings (digits already masked as "#"). ' +
  'Return ONLY a JSON array of the SAME LENGTH, where element i is the English ' +
  'translation of input element i. Preserve the "#" placeholders. No commentary.';

/** Output ceiling per batch. 50 short English descriptions fit comfortably;
 *  the old 4096 truncated large batches into unparseable JSON. */
const ANTHROPIC_MAX_TOKENS = 8192;

export interface TranslateOptions {
  apiKey: string;
  model: string;
  /** Maximum Anthropic batches to run this invocation (execution-budget cap). */
  maxBatches: number;
  /** Optional wall-clock budget (ms); remaining batches stop once exceeded. */
  timeBudgetMs?: number;
}

export interface TranslateKeysResult {
  /** normalized key → English translation, for keys that succeeded. */
  translations: Map<string, string>;
  /** Keys not translated this invocation (over the cap or out of time budget)
   *  — they remain 'none' for a subsequent invocation / the backlog. */
  remaining: string[];
}

/** One Anthropic Messages call for a single batch. A failed call (non-OK HTTP,
 *  malformed body) returns an empty map — never throws. */
async function translateOneBatch(
  batch: string[],
  apiKey: string,
  model: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(batch) }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('anthropicTranslate: batch HTTP error', resp.status, body.slice(0, 500));
    return out; // degrade — these keys stay 'none'
  }

  const data = await resp.json();
  const text = (data.content ?? [])
    .filter((b: { type?: string }) => b.type === 'text')
    .map((b: { text?: string }) => b.text ?? '')
    .join('');

  const translations = parseTranslationArray(text);
  for (let i = 0; i < batch.length; i++) {
    const en = translations[i];
    if (typeof en === 'string' && en.trim()) out.set(batch[i], en.trim());
  }
  return out;
}

/**
 * Translate unique normalized keys via the Anthropic Messages API, capped to
 * `maxBatches` batches (and an optional time budget) per invocation. A single
 * failed batch degrades to 'none'; the call as a whole never throws.
 */
export async function translateKeys(
  keys: string[],
  opts: TranslateOptions,
): Promise<TranslateKeysResult> {
  const translations = new Map<string, string>();
  const { batches, remaining } = planBatches(keys, AI_BATCH_SIZE, opts.maxBatches);
  const leftover: string[] = [...remaining];
  const started = Date.now();

  for (let b = 0; b < batches.length; b++) {
    if (opts.timeBudgetMs != null && Date.now() - started >= opts.timeBudgetMs) {
      // Out of time — everything not yet attempted stays 'none' for the backlog.
      for (let k = b; k < batches.length; k++) leftover.push(...batches[k]);
      break;
    }
    try {
      const batchMap = await translateOneBatch(batches[b], opts.apiKey, opts.model);
      for (const [k, v] of batchMap) translations.set(k, v);
    } catch (err) {
      console.error('anthropicTranslate: batch threw', err);
      // Leave this batch's keys untranslated ('none'); continue with the rest.
    }
  }

  return { translations, remaining: leftover };
}
