// Run with: node --test scripts/expenses-tests/
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
//
// Acceptance tests in the SECTION-LEVEL (Tab-Section) taxonomy (migration 132).
// Relevant compound ids:
//   43 Business Expenses-Owner Payments · 44 Marketing and Client ·
//   45 Taxes and Fees-Employees · 46 Taxes and Fees-Company ·
//   47 Taxes and Fees-Bank · 49 Employees-Employee Benefits ·
//   57 Office-Supplies · 65 Production Contractors · 15 Miscellaneous (fallback).
// These assert the classification produced by categorize.ts under the exact rule
// set migrations 130+132 leave in prod, doubling as the migrations' spec.
// categorize.ts is verified to need NO code change — fallback stays 15 by design.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { categorize } from '../../src/lib/expenses/categorize.ts';
import type { KeywordRule, VendorRule } from '../../src/lib/expenses/types.ts';

// ===========================================================================
// SINGLE SOURCE OF TRUTH — the rule rows migrations 130+132 leave in the two
// rule tables (section-level compound ids), plus the pre-existing rows the new
// ones depend on for vendor-before-keyword / priority ordering.
// ===========================================================================

const VENDOR_RULES: VendorRule[] = [
  // owner entities, contains, priority 1 -> Business Expenses-Owner Payments (43)
  { match_type: 'contains', pattern: 'МЕЙН АСЕМБЛИ', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'КАТАЛИСТ', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'МАТЮ ДЖИ МАДЕЙ', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'MAIN ASSEMBLY', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'CATALYST', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'KATALIST', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'KATALYST', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'MADEY', category_id: 43, priority: 1 },
  { match_type: 'contains', pattern: 'MADEJ', category_id: 43, priority: 1 },
  // pre-existing EXACT owner rules retargeted to 43
  { match_type: 'exact', pattern: 'МЕЙН АСЕМБЛИ ЕООД', category_id: 43, priority: 100 },
  { match_type: 'exact', pattern: 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', category_id: 43, priority: 100 },
  { match_type: 'exact', pattern: 'МАТЮ ДЖИ МАДЕЙ', category_id: 43, priority: 100 },
  { match_type: 'exact', pattern: 'КАТАЛИСТ ЕООД', category_id: 43, priority: 100 },
  { match_type: 'exact', pattern: 'КАТАЛИСТ ИНТЕРАКТИВ ЕООД', category_id: 43, priority: 100 },
  { match_type: 'exact', pattern: 'MEYN ASEMBLI EOOD', category_id: 43, priority: 200 },
  { match_type: 'exact', pattern: 'KAMEN BORISLAVOV KAMENOV', category_id: 43, priority: 200 },
  { match_type: 'exact', pattern: 'MATYu DZhI MADEY', category_id: 43, priority: 200 },
  { match_type: 'exact', pattern: 'KATALIST EOOD', category_id: 43, priority: 200 },
  { match_type: 'exact', pattern: 'KATALIST INTERAKTIV EOOD', category_id: 43, priority: 200 },
  // НАП statutory (social/health/pension/income withholding) -> Taxes and Fees-Employees (45)
  { match_type: 'exact', pattern: 'Национална Агенция за Приходите', category_id: 45, priority: 100 },
  { match_type: 'exact', pattern: 'Natsionalna Agentsiya za Prihodite', category_id: 45, priority: 200 },
  // НАП short-form split (beneficiary-keyed; more-specific lower priority wins):
  { match_type: 'contains', pattern: 'НАП - Данъци', category_id: 46, priority: 90 },  // central budget / VAT -> Company
  { match_type: 'contains', pattern: 'НАП -', category_id: 45, priority: 100 },         // social contributions -> Employees
  // private employee benefit/health policies -> Employees-Employee Benefits (49)
  { match_type: 'exact', pattern: 'ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД', category_id: 49, priority: 100 },
  { match_type: 'exact', pattern: 'БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД', category_id: 49, priority: 100 },
  // ТД на НОИ (National Social Security Institute) — statutory, with НАП, not Office (auditor fix)
  { match_type: 'exact', pattern: 'ТД на НОИ София-окръг', category_id: 45, priority: 100 },
];

const KEYWORD_RULES: KeywordRule[] = [
  { keyword: 'AZV-MAIN ASSEMBLY', category_id: 43, priority: 1 },     // Business Expenses-Owner Payments
  { keyword: 'FACEBK', category_id: 44, priority: 20 },              // Marketing and Client
  { keyword: 'ТАКСА ЗА МЕЖДУБАНКОВ ПРЕВОД', category_id: 47, priority: 20 }, // Taxes and Fees-Bank
  { keyword: 'TAKSA ZA MEZHDUBANKOV PREVOD', category_id: 47, priority: 20 },
  { keyword: 'ДАНЪК ПЕЧАЛБА', category_id: 46, priority: 10 },        // Taxes and Fees-Company
  { keyword: 'OFFICE COFFEE', category_id: 57, priority: 20 },        // Office-Supplies
  { keyword: 'COFFEE OFFICE', category_id: 57, priority: 20 },
  { keyword: 'AZV-COMMISSION', category_id: 47, priority: 20 },       // Taxes and Fees-Bank
  { keyword: 'ТАКСИ ПОЛУЧЕНИ ВАЛУТНИ', category_id: 47, priority: 20 },
  { keyword: 'MAIN ASSEMBLY', category_id: 65, priority: 20 },        // Production Contractors (legacy cat7 default)
  { keyword: 'AGENT SERVIC', category_id: 65, priority: 20 },
  { keyword: 'KAFFEK', category_id: 57, priority: 15 },               // Office-Supplies
];

const cat = (vendor: string | null, desc: string | null): number =>
  categorize(vendor, desc, VENDOR_RULES, KEYWORD_RULES).categoryId;

// ===========================================================================
// Owner entities -> Business Expenses-Owner Payments (43). Tab-independent.
// ===========================================================================
test('owner entities: every mandated beneficiary variant -> 43 (Business Expenses-Owner Payments)', () => {
  const owners: string[] = [
    'МАТЮ ДЖИ МАДЕЙ', 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', 'КАТАЛИСТ ЕООД', 'КАТАЛИСТ ИНТЕРАКТИВ ЕООД',
    'МЕЙН АСЕМБЛИ ЕООД',
    'MATTHEW G MADEY', 'MATTHEW G. MADEY', 'MATTHEW G. MADEJ', 'CATALYST INTERACTIVE LTD', 'MAIN ASSEMBLY LTD.',
    'MEYN ASEMBLI EOOD', 'KAMEN BORISLAVOV KAMENOV', 'MATYu DZhI MADEY', 'KATALIST EOOD', 'KATALIST INTERAKTIV EOOD',
  ];
  for (const ben of owners) {
    assert.equal(cat(ben, 'заплата 02 2026 / invoice payment'), 43, `owner beneficiary must be 43: ${ben}`);
  }
});

test('owner rule is tab-independent: a Catalyst project-work payment still -> 43', () => {
  assert.equal(cat('KATALIST INTERAKTIV EOOD', 'payment on invoice Invoice payment'), 43);
});

test('AZV-MAIN ASSEMBLY blank-beneficiary principal -> 43 (beats MAIN ASSEMBLY/AGENT SERVIC ->65)', () => {
  const principal = 'AZV-MAIN ASSEMBLY CYPRUS LTD, payment on invoice for agent servic es , GPP Ref.: 6058100878';
  assert.equal(cat('', principal), 43);
  assert.equal(cat(null, principal), 43);
});

// ===========================================================================
// AZV commission -> Taxes and Fees-Bank (47).
// ===========================================================================
test('AZV commission lines -> 47 (Taxes and Fees-Bank), received & issued FX-fee forms', () => {
  assert.equal(cat('', 'AZV-Commission 4162.50 USD for GPP transaction Ref.: 6064200025/Такси получени валутни преводи'), 47);
  assert.equal(cat('', 'AZV-Commission for GPP transaction Ref.: 6058100878/Такси издадени валутни преводи'), 47);
});

// ===========================================================================
// НАП split. Statutory -> Taxes and Fees-Employees (45). Central-budget/VAT
// ("НАП - Данъци") and corporate profit tax -> Taxes and Fees-Company (46).
// ===========================================================================
test('НАП statutory remittances -> Taxes and Fees-Employees (45)', () => {
  const NAP = 'Национална Агенция за Приходите';
  const forms = [
    'Вноски за ДОО Платежно нареждане извън банката',
    'Вноски за ЗО Платежно нареждане извън банката',
    'Вноски за ДЗПО Платежно нареждане извън банката',
    'ДОД Платежно нареждане извън банката',
    'ЗДДФЛ Платежно нареждане извън банката',
    'Ав данък граждански договори Платежно нареждане извън банката',
  ];
  for (const d of forms) assert.equal(cat(NAP, d), 45, `НАП statutory must be 45: ${d}`);
});

test('НАП romanized beneficiary also -> 45', () => {
  assert.equal(cat('Natsionalna Agentsiya za Prihodite', 'Вноски за ДОО Платежно нареждане извън банката'), 45);
});

test('НАП SHORT-FORM split: contributions -> 45 (Employees), central-budget/VAT -> 46 (Company)', () => {
  // Social/health/pension short forms -> Taxes and Fees-Employees:
  for (const ben of [
    'НАП - Вноски за държавно обществено осигуряване',
    'НАП - Вноски за здравно осигуряване',
    'НАП - Вноски за допълнително задължително пенсионно осигуряване',
  ]) {
    assert.equal(cat(ben, 'Изх.превод SEPA в ЕИП'), 45, `НАП contributions must be 45: ${ben}`);
  }
  // Central-budget taxes / VAT -> Taxes and Fees-Company (more-specific rule wins):
  assert.equal(cat('НАП - Данъци (приходи на централния бюджет)', 'Изх.превод SEPA в ЕИП VAT 04 2026'), 46);
});

test('corporate profit tax: blank/non-НАП counterparty -> 46 (Company); НАП-beneficiary advance -> 45', () => {
  assert.equal(cat('', 'Данък печалба авансов Платежно нареждане извън банката'), 46);
  assert.equal(cat(null, 'Данък печалба авансов'), 46);
  // With the statutory НАП beneficiary the vendor rule (45) wins first — documented:
  assert.equal(cat('Национална Агенция за Приходите', 'Данък печалба авансов Платежно нареждане извън банката'), 45);
});

test('ТД на НОИ (National Social Security Institute) -> Taxes and Fees-Employees (45), not Office', () => {
  assert.equal(cat('ТД на НОИ София-окръг', 'РЕВИЗИОНЕН АКТ ЗА НАЧЕТ Изх.превод SEPA в ЕИП'), 45);
});

test('private employee health/benefit policies -> Employees-Employee Benefits (49)', () => {
  assert.equal(cat('ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД', 'Health Insurance employees'), 49);
  assert.equal(cat('БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД', 'ф-рa 2000318300 Multisport'), 49);
});

// ===========================================================================
// FACEBK -> Marketing and Client (44).
// ===========================================================================
test('FACEBK card lines -> Marketing and Client (44)', () => {
  assert.equal(cat('', 'POS 50.00 USD FACEBK *ADS 12345/fb.me/ads'), 44);
  assert.equal(cat(null, 'ПОС 120.00 USD авт.код:112233-FACEBK *ADVERT/MENLO PARK/USA'), 44);
});

// ===========================================================================
// BLINK interbank transfer fee -> Taxes and Fees-Bank (47).
// ===========================================================================
test('BLINK interbank fee -> Taxes and Fees-Bank (47)', () => {
  assert.equal(cat('', 'BLINK Такса за междубанков превод'), 47);
  assert.equal(cat('', 'Такса за междубанков превод'), 47);
  assert.equal(cat(null, ' BLINK Такса за междубанков превод'), 47);
});

// ===========================================================================
// Office coffee -> Office-Supplies (57). Coffee capsules still hit KAFFEK.
// ===========================================================================
test('office coffee vending -> Office-Supplies (57)', () => {
  assert.equal(cat('СТРЕЗОВ ВЕНДИНГ ЕООД', 'поръчка ESH0048112 office coffee Издаден вътр.банков превод'), 57);
  assert.equal(cat('', 'ф-ра 0000002341 BLINK Платежно нареждане извън банката coffee office'), 57);
  assert.equal(cat(null, 'ПОС 63.96 EUR авт.код:772659-KaffeKapslen/Hasselager/DNK/PAN:5408****8235'), 57);
});
