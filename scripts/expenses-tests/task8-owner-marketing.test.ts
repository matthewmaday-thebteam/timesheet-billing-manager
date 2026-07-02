// Run with: node --test scripts/expenses-tests/
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
//
// Owner Payments + Marketing + fee/НАП/coffee acceptance tests, expressed in the
// WORKBOOK-NATIVE taxonomy (migration 131). Category ids:
//   20 Business Expenses · 21 Marketing and Client · 22 Taxes and Fees ·
//   23 Employees · 24 Office · 25 Taggable · 26 Project Expenses ·
//   27 Production Contractors · 28 Auxmedica · 29 Office Purchase and Buildout ·
//   30 BAKr · 31 Owner Payments · 15 Miscellaneous (fallback, kept).
// These assert the classification produced by categorize.ts under the exact rule
// set migrations 130+131 leave in prod, so they double as the migrations' spec.
// Nothing writes data; prod expenses is empty and ingest must classify from
// these rules alone. categorize.ts is verified to need NO code change — the
// fallback id stays 15 by design, so every case here is pure rule-driven.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { categorize } from '../../src/lib/expenses/categorize.ts';
import type { KeywordRule, VendorRule } from '../../src/lib/expenses/types.ts';

// ===========================================================================
// SINGLE SOURCE OF TRUTH — the rule rows migrations 130+131 leave in the two
// rule tables (new workbook-native category ids), including the pre-existing
// rows the new ones depend on for vendor-before-keyword / priority ordering.
// ===========================================================================

const VENDOR_RULES: VendorRule[] = [
  // owner entities, contains, priority 1 -> Owner Payments (31)
  { match_type: 'contains', pattern: 'МЕЙН АСЕМБЛИ', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'КАТАЛИСТ', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'МАТЮ ДЖИ МАДЕЙ', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'MAIN ASSEMBLY', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'CATALYST', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'KATALIST', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'KATALYST', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'MADEY', category_id: 31, priority: 1 },
  { match_type: 'contains', pattern: 'MADEJ', category_id: 31, priority: 1 },
  // pre-existing EXACT owner rules retargeted to Owner Payments (31)
  { match_type: 'exact', pattern: 'МЕЙН АСЕМБЛИ ЕООД', category_id: 31, priority: 100 },
  { match_type: 'exact', pattern: 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', category_id: 31, priority: 100 },
  { match_type: 'exact', pattern: 'МАТЮ ДЖИ МАДЕЙ', category_id: 31, priority: 100 },
  { match_type: 'exact', pattern: 'КАТАЛИСТ ЕООД', category_id: 31, priority: 100 },
  { match_type: 'exact', pattern: 'КАТАЛИСТ ИНТЕРАКТИВ ЕООД', category_id: 31, priority: 100 },
  { match_type: 'exact', pattern: 'MEYN ASEMBLI EOOD', category_id: 31, priority: 200 },
  { match_type: 'exact', pattern: 'KAMEN BORISLAVOV KAMENOV', category_id: 31, priority: 200 },
  { match_type: 'exact', pattern: 'MATYu DZhI MADEY', category_id: 31, priority: 200 },
  { match_type: 'exact', pattern: 'KATALIST EOOD', category_id: 31, priority: 200 },
  { match_type: 'exact', pattern: 'KATALIST INTERAKTIV EOOD', category_id: 31, priority: 200 },
  // НАП statutory -> Taxes and Fees (22)
  { match_type: 'exact', pattern: 'Национална Агенция за Приходите', category_id: 22, priority: 100 },
  { match_type: 'exact', pattern: 'Natsionalna Agentsiya za Prihodite', category_id: 22, priority: 200 },
  // НАП SHORT-FORM (migration 131 §2c) — the real bank export beneficiary form.
  { match_type: 'contains', pattern: 'НАП -', category_id: 22, priority: 100 },
  // private employee benefit/health policies -> Employees (23)
  { match_type: 'exact', pattern: 'ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД', category_id: 23, priority: 100 },
  { match_type: 'exact', pattern: 'БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД', category_id: 23, priority: 100 },
];

const KEYWORD_RULES: KeywordRule[] = [
  // new (migration 130), re-homed to workbook tabs (migration 131)
  { keyword: 'AZV-MAIN ASSEMBLY', category_id: 31, priority: 1 },   // Owner Payments
  { keyword: 'FACEBK', category_id: 21, priority: 20 },             // Marketing and Client
  { keyword: 'ТАКСА ЗА МЕЖДУБАНКОВ ПРЕВОД', category_id: 22, priority: 20 }, // Taxes and Fees
  { keyword: 'TAKSA ZA MEZHDUBANKOV PREVOD', category_id: 22, priority: 20 },
  { keyword: 'ДАНЪК ПЕЧАЛБА', category_id: 22, priority: 10 },       // Taxes and Fees
  { keyword: 'OFFICE COFFEE', category_id: 24, priority: 20 },       // Office
  { keyword: 'COFFEE OFFICE', category_id: 24, priority: 20 },
  // pre-existing, re-homed
  { keyword: 'AZV-COMMISSION', category_id: 22, priority: 20 },      // Taxes and Fees (bank fee)
  { keyword: 'ТАКСИ ПОЛУЧЕНИ ВАЛУТНИ', category_id: 22, priority: 20 },
  { keyword: 'MAIN ASSEMBLY', category_id: 20, priority: 20 },       // Business Expenses (legacy cat7 default)
  { keyword: 'AGENT SERVIC', category_id: 20, priority: 20 },
  { keyword: 'KAFFEK', category_id: 24, priority: 15 },              // Office
];

const cat = (vendor: string | null, desc: string | null): number =>
  categorize(vendor, desc, VENDOR_RULES, KEYWORD_RULES).categoryId;

// ===========================================================================
// Owner entities -> Owner Payments (31). Beneficiary-driven, tab-independent.
// ===========================================================================
test('owner entities: every mandated beneficiary variant -> 31 (Owner Payments)', () => {
  const owners: string[] = [
    'МАТЮ ДЖИ МАДЕЙ', 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', 'КАТАЛИСТ ЕООД', 'КАТАЛИСТ ИНТЕРАКТИВ ЕООД',
    'МЕЙН АСЕМБЛИ ЕООД',
    'MATTHEW G MADEY', 'MATTHEW G. MADEY', 'MATTHEW G. MADEJ', 'CATALYST INTERACTIVE LTD', 'MAIN ASSEMBLY LTD.',
    'MEYN ASEMBLI EOOD', 'KAMEN BORISLAVOV KAMENOV', 'MATYu DZhI MADEY', 'KATALIST EOOD', 'KATALIST INTERAKTIV EOOD',
  ];
  for (const ben of owners) {
    assert.equal(cat(ben, 'заплата 02 2026 / invoice payment'), 31, `owner beneficiary must be 31: ${ben}`);
  }
});

test('owner rule is tab-independent: a Catalyst project-work payment still -> 31', () => {
  assert.equal(cat('KATALIST INTERAKTIV EOOD', 'payment on invoice Invoice payment'), 31);
});

test('AZV-MAIN ASSEMBLY blank-beneficiary principal -> 31 (beats MAIN ASSEMBLY/AGENT SERVIC ->20)', () => {
  const principal = 'AZV-MAIN ASSEMBLY CYPRUS LTD, payment on invoice for agent servic es , GPP Ref.: 6058100878';
  assert.equal(cat('', principal), 31);
  assert.equal(cat(null, principal), 31);
});

// ===========================================================================
// AZV commission stays a bank fee -> Taxes and Fees (22).
// ===========================================================================
test('AZV commission lines -> 22 (Taxes and Fees), received & issued FX-fee forms', () => {
  assert.equal(cat('', 'AZV-Commission 4162.50 USD for GPP transaction Ref.: 6064200025/Такси получени валутни преводи'), 22);
  assert.equal(cat('', 'AZV-Commission for GPP transaction Ref.: 6058100878/Такси издадени валутни преводи'), 22);
});

// ===========================================================================
// НАП split -> Taxes and Fees (22). Corporate profit tax also -> 22 under the
// workbook taxonomy (the old Accounting & Compliance folds into Taxes and Fees).
// ===========================================================================
test('НАП statutory remittances -> Taxes and Fees (22)', () => {
  const NAP = 'Национална Агенция за Приходите';
  const forms = [
    'Вноски за ДОО Платежно нареждане извън банката',
    'Вноски за ЗО Платежно нареждане извън банката',
    'Вноски за ДЗПО Платежно нареждане извън банката',
    'ДОД Платежно нареждане извън банката',
    'ЗДДФЛ Платежно нареждане извън банката',
    'Ав данък граждански договори Платежно нареждане извън банката',
  ];
  for (const d of forms) assert.equal(cat(NAP, d), 22, `НАП statutory must be 22: ${d}`);
});

test('НАП romanized beneficiary also -> 22', () => {
  assert.equal(cat('Natsionalna Agentsiya za Prihodite', 'Вноски за ДОО Платежно нареждане извън банката'), 22);
});

test('НАП SHORT-FORM beneficiaries (real bank-export spelling) -> Taxes and Fees (22)', () => {
  // These are the exact short beneficiary forms in the real 812-row upload that
  // the full-name/exact rules miss (15 rows). The 'НАП -' contains rule catches
  // them without over-matching bare НАП elsewhere (verified on the real file).
  const shortForms = [
    'НАП - Данъци (приходи на централния бюджет)',
    'НАП - Вноски за държавно обществено осигуряване',
    'НАП - Вноски за здравно осигуряване',
    'НАП - Вноски за допълнително задължително пенсионно осигуряване',
  ];
  for (const ben of shortForms) {
    assert.equal(cat(ben, 'Изх.превод SEPA в ЕИП'), 22, `НАП short-form must be 22: ${ben}`);
  }
});

test('corporate profit tax: blank/non-НАП counterparty -> 22; НАП-beneficiary advance -> 22', () => {
  // Both resolve to Taxes and Fees now (Accounting folded into Taxes and Fees):
  assert.equal(cat('', 'Данък печалба авансов Платежно нареждане извън банката'), 22);
  assert.equal(cat(null, 'Данък печалба авансов'), 22);
  assert.equal(cat('Национална Агенция за Приходите', 'Данък печалба авансов Платежно нареждане извън банката'), 22);
});

test('private employee health/benefit policies -> Employees (23), not tax', () => {
  assert.equal(cat('ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД', 'Health Insurance employees'), 23);
  assert.equal(cat('БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД', 'ф-рa 2000318300 Multisport'), 23);
});

// ===========================================================================
// FACEBK -> Marketing and Client (21).
// ===========================================================================
test('FACEBK card lines -> Marketing and Client (21)', () => {
  assert.equal(cat('', 'POS 50.00 USD FACEBK *ADS 12345/fb.me/ads'), 21);
  assert.equal(cat(null, 'ПОС 120.00 USD авт.код:112233-FACEBK *ADVERT/MENLO PARK/USA'), 21);
});

// ===========================================================================
// BLINK interbank transfer fee -> Taxes and Fees (22).
// ===========================================================================
test('BLINK interbank fee -> Taxes and Fees (22)', () => {
  assert.equal(cat('', 'BLINK Такса за междубанков превод'), 22);
  assert.equal(cat('', 'Такса за междубанков превод'), 22);
  assert.equal(cat(null, ' BLINK Такса за междубанков превод'), 22);
});

// ===========================================================================
// Office coffee -> Office (24). Coffee capsules still hit the KAFFEK rule.
// ===========================================================================
test('office coffee vending -> Office (24)', () => {
  assert.equal(cat('СТРЕЗОВ ВЕНДИНГ ЕООД', 'поръчка ESH0048112 office coffee Издаден вътр.банков превод'), 24);
  assert.equal(cat('', 'ф-ра 0000002341 BLINK Платежно нареждане извън банката coffee office'), 24);
  assert.equal(cat(null, 'ПОС 63.96 EUR авт.код:772659-KaffeKapslen/Hasselager/DNK/PAN:5408****8235'), 24);
});
