// =============================================================================
// translate — dictionary translation with Cyrillic passthrough detection.
// =============================================================================
// The dictionary lookup keys off `lookupText` — canonically the payment reason
// (Основание за плащане) + ' ' + operation description (Описание на операцията),
// normalized the same way Agent A's miner built the seed keys. The `passthrough`
// value (defaults to `lookupText`) is what gets stored when no translation is
// needed — the edge function passes the FULL description_original there so a
// Latin row stores its complete readable text.
//
// Order (locked):
//   1. No Cyrillic in lookupText → passthrough (translated = passthroughText).
//   2. Dictionary hit on normalizeDescription(lookupText) → 'dictionary'.
//   3. Otherwise → 'none' + needs_review (AI fallback is orchestrated ONLY in
//      the ingest-expenses edge function, per the recorded carve-out; this pure
//      function never makes network calls).
// =============================================================================

import { normalizeDescription } from './normalizeDescription.ts';
import type { TranslateResult } from './types.ts';

// Matches Agent A's mining script exactly: Cyrillic (U+0400–U+04FF) plus the
// Cyrillic Supplement block (U+0500–U+052F).
const CYRILLIC = /[Ѐ-ӿԀ-ԯ]/;

export function hasCyrillic(text: string): boolean {
  return CYRILLIC.test(text);
}

/** Dictionary maps a normalized key -> English translation. */
export type TranslationDict = ReadonlyMap<string, string>;

export function translate(
  lookupText: string | null,
  dict: TranslationDict,
  passthroughText: string | null = lookupText,
): TranslateResult {
  const text = lookupText ?? '';

  if (!hasCyrillic(text)) {
    return { translated: passthroughText ?? text, translationSource: 'passthrough', needsReview: false };
  }

  const hit = dict.get(normalizeDescription(text));
  if (hit != null) {
    return { translated: hit, translationSource: 'dictionary', needsReview: false };
  }

  return { translated: null, translationSource: 'none', needsReview: true };
}
