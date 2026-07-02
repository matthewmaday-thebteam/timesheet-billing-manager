// =============================================================================
// categorize — rule engine over vendor + keyword rules.
// =============================================================================
// Order (locked):
//   1. Vendor rules (case-insensitive; 'exact' = full-string equal,
//      'contains' = substring), lowest `priority` first.
//   2. Keyword rules (case-insensitive substring of the description),
//      lowest `priority` first.
//   3. Fallback → category 15 (Miscellaneous), needs_review = true.
// Case-folding uses toUpperCase to align with normalizeDescription and to fold
// Cyrillic correctly (vendor patterns and beneficiaries may be Cyrillic).
// Vendor rules match against the counterparty (beneficiary for debits, payer
// for credits); keyword rules against the original description text.
// A matched rule that resolves to the fallback category (15) still flags
// needs_review (defence in depth — the miner also drops vendor→15 rules).
// =============================================================================

import {
  FALLBACK_CATEGORY_ID,
  type CategorizeResult,
  type KeywordRule,
  type VendorRule,
} from './types.ts';

function byPriority<T extends { priority: number }>(a: T, b: T): number {
  return a.priority - b.priority;
}

export function categorize(
  vendor: string | null,
  description: string | null,
  vendorRules: readonly VendorRule[],
  keywordRules: readonly KeywordRule[],
): CategorizeResult {
  const vendorUc = (vendor ?? '').trim().toUpperCase();
  if (vendorUc) {
    for (const rule of [...vendorRules].sort(byPriority)) {
      const pattern = rule.pattern.trim().toUpperCase();
      if (!pattern) continue;
      const matched = rule.match_type === 'exact' ? vendorUc === pattern : vendorUc.includes(pattern);
      if (matched) {
        return {
          categoryId: rule.category_id,
          categorySource: 'vendor_rule',
          needsReview: rule.category_id === FALLBACK_CATEGORY_ID,
        };
      }
    }
  }

  const descUc = (description ?? '').toUpperCase();
  if (descUc) {
    for (const rule of [...keywordRules].sort(byPriority)) {
      const keyword = rule.keyword.trim().toUpperCase();
      if (!keyword) continue;
      if (descUc.includes(keyword)) {
        return {
          categoryId: rule.category_id,
          categorySource: 'keyword_rule',
          // Fallback category always flags review; force_review flags it even
          // when a real category was assigned (e.g. UNICREDIT BULBANK rules).
          needsReview: rule.category_id === FALLBACK_CATEGORY_ID || rule.force_review === true,
        };
      }
    }
  }

  return { categoryId: FALLBACK_CATEGORY_ID, categorySource: 'fallback', needsReview: true };
}
