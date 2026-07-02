// Run with: node --test scripts/expenses-tests/
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDescription } from '../../src/lib/expenses/normalizeDescription.ts';
import { convertToEur, round2 } from '../../src/lib/expenses/convertToEur.ts';
import { assignMonth } from '../../src/lib/expenses/assignMonth.ts';
import { categorize } from '../../src/lib/expenses/categorize.ts';
import { translate, hasCyrillic } from '../../src/lib/expenses/translate.ts';
import { buildRowHashCanonical, rowHash } from '../../src/lib/expenses/rowHash.ts';
import type { KeywordRule, VendorRule } from '../../src/lib/expenses/types.ts';

test('normalizeDescription: NFC → upper → digit-mask → collapse ws → trim', () => {
  assert.equal(normalizeDescription('  Такса   12.50 лв '), 'ТАКСА # ЛВ');
  // Space is NOT a [.,] separator, so "1 300,00" is two separate digit runs.
  assert.equal(normalizeDescription('POS 1 300,00 EUR'), 'POS # # EUR');
  assert.equal(normalizeDescription('POS 1300,00 EUR'), 'POS # EUR');
  assert.equal(normalizeDescription('ф-ра 0000000526'), 'Ф-РА #');
  assert.equal(normalizeDescription('Ref: 5363200080/2025'), 'REF: #/#');
});

test('convertToEur: EUR account is identity (rate 1.0, source identity)', () => {
  const c = convertToEur('EUR', 100);
  assert.equal(c.eurAmount, 100);
  assert.equal(c.conversionRate, 1);
  assert.equal(c.rateSource, 'identity');
  assert.equal(c.rateDate, null);
});

test('convertToEur: EUR-acct / USD-op — EUR = ACCOUNT amount, never derived from USD', () => {
  // Account booked 273.00 EUR; the 297.00 USD operation amount is informational.
  assert.equal(convertToEur('EUR', 273).eurAmount, 273);
});

test('convertToEur: BGN account uses the peg round2(x / 1.95583)', () => {
  assert.equal(convertToEur('BGN', 100).eurAmount, 51.13);
  assert.equal(convertToEur('BGN', 2030).eurAmount, 1037.92);
  assert.equal(convertToEur('BGN', 24491.1).eurAmount, 12522.1);
  assert.equal(convertToEur('BGN', 17.4).eurAmount, 8.9);
  const c = convertToEur('BGN', 100);
  assert.equal(c.conversionRate, 1.95583);
  assert.equal(c.rateSource, 'peg');
  assert.equal(c.rateDate, null);
});

test('convertToEur: BGN-acct regardless of operation currency (EUR-op / USD-op)', () => {
  // Operation currency is irrelevant — EUR always derives from the BGN account amount.
  assert.equal(convertToEur('BGN', 195.583).eurAmount, 100);
});

test('convertToEur: zero-amount anomaly rows convert to 0 (never dropped)', () => {
  assert.equal(convertToEur('EUR', 0).eurAmount, 0);
  assert.equal(convertToEur('BGN', 0).eurAmount, 0);
});

test('round2: sign preserved (half away from zero)', () => {
  assert.equal(round2(-100 / 1.95583), -51.13);
});

test('assignMonth: buckets by value date, not booking date', () => {
  assert.equal(assignMonth('2026-01-31'), '2026-01');
  assert.equal(assignMonth('2025-12-26'), '2025-12');
});

test('categorize: vendor exact vs contains, priority order', () => {
  const vendorRules: VendorRule[] = [
    { match_type: 'contains', pattern: 'clickup', category_id: 3, priority: 10 },
    { match_type: 'exact', pattern: 'acme ltd', category_id: 7, priority: 5 },
    { match_type: 'contains', pattern: 'a', category_id: 99, priority: 1 },
  ];
  const keywordRules: KeywordRule[] = [
    { keyword: 'такса', category_id: 4, priority: 10 },
    { keyword: 'наем', category_id: 10, priority: 5 },
  ];

  // Lowest priority ('a', priority 1) wins even though exact 'acme ltd' also matches.
  assert.equal(categorize('ACME LTD', 'x', vendorRules, keywordRules).categoryId, 99);
  // contains match on the vendor string
  assert.equal(categorize('Order via ClickUp', 'x', vendorRules, keywordRules).categoryId, 99);
  // no vendor match → keyword substring on description (Cyrillic, case-insensitive)
  const kw = categorize('Unknown', 'Дължима периодична ТАКСА', vendorRules, keywordRules);
  assert.equal(kw.categoryId, 4);
  assert.equal(kw.categorySource, 'keyword_rule');
});

test('categorize: exact requires full-string equality, contains is substring', () => {
  const vendorRules: VendorRule[] = [{ match_type: 'exact', pattern: 'acme ltd', category_id: 7, priority: 5 }];
  assert.equal(categorize('ACME LTD', '', vendorRules, []).categoryId, 7);
  // exact does NOT match a superstring → fallback
  const r = categorize('ACME LTD BULGARIA', '', vendorRules, []);
  assert.equal(r.categoryId, 15);
  assert.equal(r.categorySource, 'fallback');
});

test('categorize: unmatched → category 15 + needs_review (never dropped)', () => {
  const r = categorize('zzz', 'qqq', [], []);
  assert.equal(r.categoryId, 15);
  assert.equal(r.categorySource, 'fallback');
  assert.equal(r.needsReview, true);
});

test('categorize: a MATCHED rule resolving to category 15 still flags needs_review (F5)', () => {
  const vendorTo15: VendorRule[] = [{ match_type: 'contains', pattern: 'misc', category_id: 15, priority: 1 }];
  const v = categorize('MISC HOLDINGS', '', vendorTo15, []);
  assert.equal(v.categoryId, 15);
  assert.equal(v.categorySource, 'vendor_rule');
  assert.equal(v.needsReview, true);

  const keywordTo15: KeywordRule[] = [{ keyword: 'разни', category_id: 15, priority: 1 }];
  const k = categorize('Unknown', 'ПЛАЩАНЕ РАЗНИ', [], keywordTo15);
  assert.equal(k.categoryId, 15);
  assert.equal(k.categorySource, 'keyword_rule');
  assert.equal(k.needsReview, true);
});

test('categorize: keyword rule with force_review=true flags needs_review despite a real category', () => {
  const forced: KeywordRule[] = [
    { keyword: 'unicredit', category_id: 4, priority: 1, force_review: true },
    { keyword: 'figma', category_id: 3, priority: 2 }, // no force_review → not flagged
  ];
  const f = categorize('Unknown', 'UNICREDIT BULBANK FEE', [], forced);
  assert.equal(f.categoryId, 4);
  assert.equal(f.categorySource, 'keyword_rule');
  assert.equal(f.needsReview, true); // forced

  const notForced = categorize('Unknown', 'FIGMA SUBSCRIPTION', [], forced);
  assert.equal(notForced.categoryId, 3);
  assert.equal(notForced.needsReview, false); // real category, not forced
});

// ---------------------------------------------------------------------------
// Regression: real POS/card description lines from the user's English-UI export
// that fell to Miscellaneous because the seeded keyword was the CLEAN romanized
// vendor name, which is not a substring of the shorter POS merchant descriptor.
// Migration 128 adds the shorter, still-unambiguous substrings. These fixtures
// are the exact strings observed in prod (category_source='fallback', cat 15).
// ---------------------------------------------------------------------------
test('categorize: seed clean-vendor keyword misses POS descriptor; 128 delta recovers it', () => {
  const seedOnly: KeywordRule[] = [
    { keyword: 'HIGHLEVEL INC.', category_id: 3, priority: 15 },
    { keyword: 'KAFFEKAPSLEN', category_id: 6, priority: 15 },
    { keyword: 'A1 BULGARIA LTD', category_id: 11, priority: 15 },
    { keyword: 'EPAY OFFICE1.BG', category_id: 9, priority: 15 },
  ];
  const withDelta: KeywordRule[] = [
    ...seedOnly,
    { keyword: 'HIGHLEVEL', category_id: 3, priority: 15 },
    { keyword: 'KAFFEK', category_id: 6, priority: 15 },
    { keyword: 'A1.BG', category_id: 11, priority: 15 },
    { keyword: 'OFFICE1.BG', category_id: 9, priority: 15 },
  ];

  // Exact prod description_original strings (vendor field null/company for POS).
  const observed: Array<[string, number]> = [
    ['ПОС 84.00 EUR авт.код:504410-HIGHLEVEL AGENCY SUB/DALLAS/USA', 3],
    ['ПОС 83.53 EUR авт.код:112233-HIGHLEVEL * TRIAL OVER/DALLAS/USA', 3],
    ['ПОС 63.96 EUR авт.код:470548-KaffeK/Hasselager/DNK/PAN:5408*', 6],
    ['POS 164.95 EUR www.a1.bg Sofia BGR 762720', 11],
    ['ПОС 66.39 EUR авт.код:112244-office1.bg/Sofia/BGR/PAN:5408*', 9],
  ];

  for (const [desc, expected] of observed) {
    // Seed-only: no substring match → Miscellaneous (the production symptom).
    assert.equal(categorize(null, desc, [], seedOnly).categoryId, 15, `seed-only should miss: ${desc}`);
    // With the 128 delta: recovered to the correct category via keyword_rule.
    const r = categorize(null, desc, [], withDelta);
    assert.equal(r.categoryId, expected, `delta should recover: ${desc}`);
    assert.equal(r.categorySource, 'keyword_rule');
  }
});

test('categorize: business-owner mandated rules — the four acceptance cases (match description_original)', () => {
  // categorize() reads description_ORIGINAL, which in the UniCredit English-UI
  // export is still Cyrillic. The owner named English phrases; the effective
  // rules are the reference-backed Cyrillic anchors. Fee rules are anchored on
  // the "ТАКСА ЗА" (fee-for) prefix to avoid over-matching salary/tax transfers.
  const rules: KeywordRule[] = [
    { keyword: 'ТАКСА ЗА ИЗХ.ПРЕВОД SEPA', category_id: 4, priority: 20 }, // "TAKSA ZA OUTGOING SEPA TRANSFER"
    { keyword: 'ПЕРИОДИЧНА ТАКСА', category_id: 4, priority: 20 },          // "RECURRING FEE DUE"
    { keyword: 'DROPBOX', category_id: 3, priority: 10 },                    // owner: office software = Software
    { keyword: 'A1.BG', category_id: 11, priority: 15 },                     // A1 telecom, POS domain variant
  ];

  // 1. SEPA outgoing transfer fee → Bank & Transfer Fees (4)
  assert.equal(categorize(null, 'Такса за изх.превод SEPA в ЕИП', [], rules).categoryId, 4);
  // 2. Recurring/periodic fee due → Bank & Transfer Fees (4)
  assert.equal(categorize(null, 'Дължима периодична такса', [], rules).categoryId, 4);
  // 3. Dropbox → Software & AI Tools (3), NOT Office Supplies
  assert.equal(categorize(null, 'ПОС 9.99 EUR DROPBOX*123/DUBLIN/IRL', [], rules).categoryId, 3);
  // 4. A1 / www.a1.bg → Telecom & Internet (11)
  assert.equal(categorize(null, 'POS 164.95 EUR www.a1.bg Sofia BGR 762720', [], rules).categoryId, 11);
});

test('categorize: fee anchor must NOT over-match salary/tax SEPA transfers (bare marker shared)', () => {
  // The bare "Изх.превод SEPA" marker also rides on salary/tax/insurance
  // transfers (145 already-correct prod rows). The fee rule is anchored on the
  // "Такса за" prefix, so these must fall through and NOT become Bank Fees.
  const rules: KeywordRule[] = [{ keyword: 'ТАКСА ЗА ИЗХ.ПРЕВОД SEPA', category_id: 4, priority: 20 }];
  for (const desc of [
    'Health insurance 03 + 04 2026 Изх.превод SEPA в ЕИП',
    'social contributions Изх.превод SEPA в ЕИП 01+02 2026',
    'VAT 04 2026 Изх.превод SEPA в ЕИП',
    'Additional pension contributions Изх.превод SEPA в ЕИП',
  ]) {
    const r = categorize(null, desc, [], rules);
    assert.equal(r.categoryId, 15, `must not over-match: ${desc}`);
    assert.equal(r.categorySource, 'fallback');
  }
});

test('categorize: no-rule beneficiaries (new/reference-Misc vendors) correctly stay 15', () => {
  // These prod beneficiaries have NO vendor rule (truncated NAP tax authority,
  // or vendors the 2025 reference itself left Miscellaneous). Matcher hardening
  // (case/whitespace/punctuation) cannot and MUST NOT invent a category for them.
  const noRules: VendorRule[] = [];
  for (const ben of ['НАП - Данъци (приходи на централния', 'Тилтит ДС ООД', 'С И Р КЪМПАНИ ООД']) {
    const r = categorize(ben, 'превод', noRules, []);
    assert.equal(r.categoryId, 15);
    assert.equal(r.categorySource, 'fallback');
  }
});

test('hasCyrillic / translate: passthrough, dictionary, none', () => {
  assert.equal(hasCyrillic('CARD PAYMENT'), false);
  assert.equal(hasCyrillic('Плащане'), true);

  // Latin → passthrough
  const pass = translate('CARD PAYMENT LATIN', new Map());
  assert.equal(pass.translationSource, 'passthrough');
  assert.equal(pass.translated, 'CARD PAYMENT LATIN');
  assert.equal(pass.needsReview, false);

  // Cyrillic with a dictionary hit on the normalized key
  const key = normalizeDescription('Такса 12.50 лв');
  const dict = new Map([[key, 'Service fee']]);
  const hit = translate('Такса 12.50 лв', dict);
  assert.equal(hit.translationSource, 'dictionary');
  assert.equal(hit.translated, 'Service fee');

  // Cyrillic dictionary miss → none + needs_review
  const miss = translate('Непозната операция', new Map());
  assert.equal(miss.translationSource, 'none');
  assert.equal(miss.translated, null);
  assert.equal(miss.needsReview, true);
});

test('translate: passthrough returns the full description when provided (dict keys off основание+описание)', () => {
  // lookupText (основание+описание) is Latin → passthrough; the stored value is
  // the full 3-field description_original passed as passthroughText.
  const lookup = 'CLOUD SERVICES SUBSCRIPTION';
  const full = 'CLOUD SERVICES SUBSCRIPTION EXTRA NOTES';
  const r = translate(lookup, new Map(), full);
  assert.equal(r.translationSource, 'passthrough');
  assert.equal(r.translated, full);
});

test('rowHash: canonical string shape matches the contract', () => {
  const canonical = buildRowHashCanonical({
    account: 'AC1EUR',
    txnDatetime: '2025-12-30T15:10:53',
    valueDate: '2025-12-26',
    originalAmount: 35.25,
    reference: 'REF0001',
    descriptionOriginal: 'Операция с карта',
  });
  assert.equal(canonical, 'AC1EUR|2025-12-30T15:10:53|35.25|REF0001|Операция с карта');
});

test('rowHash: falls back to value_date when no txn datetime', () => {
  const canonical = buildRowHashCanonical({
    account: 'AC1EUR',
    txnDatetime: null,
    valueDate: '2025-12-26',
    originalAmount: 29,
    reference: null,
    descriptionOriginal: null,
  });
  assert.equal(canonical, 'AC1EUR|2025-12-26|29.00||');
});

test('rowHash: deterministic, unique, and idempotent under re-ingest', async () => {
  const base = {
    account: 'AC1EUR',
    txnDatetime: '2025-12-30T15:10:53',
    valueDate: '2025-12-26',
    originalAmount: 35.25,
    reference: 'REF0001',
    descriptionOriginal: 'Операция с карта',
  };
  const h1 = await rowHash(base);
  const h2 = await rowHash({ ...base });
  assert.equal(h1, h2); // deterministic
  assert.match(h1, /^[0-9a-f]{64}$/);

  const other = await rowHash({ ...base, originalAmount: 35.26 });
  assert.notEqual(h1, other); // sensitive to amount

  // Simulated re-ingest: same rows → all duplicates at the pure-logic level.
  const rows = [base, { ...base, reference: 'REF0002' }, { ...base, originalAmount: 10 }];
  const first = new Set(await Promise.all(rows.map(rowHash)));
  const second = await Promise.all(rows.map(rowHash));
  assert.equal(first.size, 3);
  assert.equal(second.every((h) => first.has(h)), true);
});

test('rowHash: false-negative defense — whitespace/formatting differences hash identically', async () => {
  const clean = {
    account: 'AC1EUR',
    txnDatetime: '2025-12-30T15:10:53',
    valueDate: '2025-12-26',
    originalAmount: 35.25,
    reference: 'REF0001',
    descriptionOriginal: 'Операция с карта Такса',
  };
  // Same transaction, different export: padded/whitespaced raw fields.
  const messy = {
    ...clean,
    account: '  AC1EUR ',
    reference: 'REF0001  ',
    descriptionOriginal: 'Операция  с   карта\tТакса ',
  };
  assert.equal(await rowHash(clean), await rowHash(messy));
});

test('rowHash: false-positive defense — same day/amount/description, different reference → distinct', async () => {
  const coffee = {
    account: 'AC1EUR',
    txnDatetime: '2025-12-30T09:00:00',
    valueDate: '2025-12-30',
    originalAmount: 3.5,
    reference: 'REF-A',
    descriptionOriginal: 'ПОС кафе',
  };
  const a = await rowHash(coffee);
  const b = await rowHash({ ...coffee, reference: 'REF-B' });
  assert.notEqual(a, b);
});

test('rowHash: cross-account safety — identical content on EUR vs BGN account → distinct, both insert', async () => {
  const row = {
    account: 'AC1EUR',
    txnDatetime: '2025-12-30T15:10:53',
    valueDate: '2025-12-26',
    originalAmount: 100,
    reference: 'REF9',
    descriptionOriginal: 'Плащане',
  };
  const eur = await rowHash(row);
  const bgn = await rowHash({ ...row, account: 'AC1BGN' });
  assert.notEqual(eur, bgn);
  // Both are new rows against an empty store → both would insert (no dedup).
  const store = new Set<string>();
  let inserted = 0;
  for (const h of [eur, bgn]) {
    if (!store.has(h)) {
      store.add(h);
      inserted++;
    }
  }
  assert.equal(inserted, 2);
});

test('rowHash: time-less export (value_date, no time) — distinct by reference, dedup on true dup', async () => {
  // report(2)-style card statements carry value_date but no txn time; the hash
  // falls back to value_date in the datetime slot.
  const base = {
    account: 'AC1EUR',
    txnDatetime: null, // no time component
    valueDate: '2025-03-15',
    originalAmount: 12.99,
    reference: 'CARD-A',
    descriptionOriginal: 'ПОС плащане',
  };
  // Same value_date/amount/description, different reference → distinct.
  const a = await rowHash(base);
  const b = await rowHash({ ...base, reference: 'CARD-B' });
  assert.notEqual(a, b);
  // Two truly identical time-less rows → same hash (dedup still works).
  const dup = await rowHash({ ...base });
  assert.equal(a, dup);
});
