// Run with: node --test scripts/expenses-tests/
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
//
// Task 8 acceptance tests — Owner Payments (17) + Advertising & Marketing (16),
// the НАП split, the AZV commission/principal separation, the BLINK interbank
// fee, FACEBK, and office-coffee. These assert the classification produced by
// categorize.ts under the EXACT rule set migration 130 leaves in prod, so they
// double as the migration's executable spec. Nothing here writes data; prod
// expenses is empty and ingest must classify from these rules alone.
//
// categorize.ts is verified to need NO code change — every case below is driven
// purely by rules. If any case here required editing categorize.ts, that is a
// signal to STOP and escalate rather than change shared ingest logic silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { categorize } from '../../src/lib/expenses/categorize.ts';
import type { KeywordRule, VendorRule } from '../../src/lib/expenses/types.ts';

// ===========================================================================
// SINGLE SOURCE OF TRUTH — the rule rows migration 130 (plus the pre-existing
// rows it depends on for ordering) leaves in the two rule tables. Ordering
// interactions (vendor-before-keyword, priority asc) are real, so the relevant
// pre-existing rules are included, not just the new ones.
// ===========================================================================

const VENDOR_RULES: VendorRule[] = [
  // -- migration 130 §2: owner entities, contains, priority 1 --
  { match_type: 'contains', pattern: 'МЕЙН АСЕМБЛИ', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'КАТАЛИСТ', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'МАТЮ ДЖИ МАДЕЙ', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'MAIN ASSEMBLY', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'CATALYST', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'KATALIST', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'KATALYST', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'MADEY', category_id: 17, priority: 1 },
  { match_type: 'contains', pattern: 'MADEJ', category_id: 17, priority: 1 },
  // -- migration 130 §3: pre-existing EXACT owner rules retargeted to 17 --
  { match_type: 'exact', pattern: 'МЕЙН АСЕМБЛИ ЕООД', category_id: 17, priority: 100 },
  { match_type: 'exact', pattern: 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', category_id: 17, priority: 100 },
  { match_type: 'exact', pattern: 'МАТЮ ДЖИ МАДЕЙ', category_id: 17, priority: 100 },
  { match_type: 'exact', pattern: 'КАТАЛИСТ ЕООД', category_id: 17, priority: 100 },
  { match_type: 'exact', pattern: 'КАТАЛИСТ ИНТЕРАКТИВ ЕООД', category_id: 17, priority: 100 },
  { match_type: 'exact', pattern: 'MEYN ASEMBLI EOOD', category_id: 17, priority: 200 },
  { match_type: 'exact', pattern: 'KAMEN BORISLAVOV KAMENOV', category_id: 17, priority: 200 },
  { match_type: 'exact', pattern: 'MATYu DZhI MADEY', category_id: 17, priority: 200 },
  { match_type: 'exact', pattern: 'KATALIST EOOD', category_id: 17, priority: 200 },
  { match_type: 'exact', pattern: 'KATALIST INTERAKTIV EOOD', category_id: 17, priority: 200 },
  // -- pre-existing НАП vendor rules (KEPT ->2), needed for the НАП cases --
  { match_type: 'exact', pattern: 'Национална Агенция за Приходите', category_id: 2, priority: 100 },
  { match_type: 'exact', pattern: 'Natsionalna Agentsiya za Prihodite', category_id: 2, priority: 200 },
  // -- pre-existing private-benefit vendor rules (Employee Benefits 8) --
  { match_type: 'exact', pattern: 'ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД', category_id: 8, priority: 100 },
  { match_type: 'exact', pattern: 'БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД', category_id: 8, priority: 100 },
];

const KEYWORD_RULES: KeywordRule[] = [
  // -- migration 130 §4 (new) --
  { keyword: 'AZV-MAIN ASSEMBLY', category_id: 17, priority: 1 },
  { keyword: 'FACEBK', category_id: 16, priority: 20 },
  { keyword: 'ТАКСА ЗА МЕЖДУБАНКОВ ПРЕВОД', category_id: 4, priority: 20 },
  { keyword: 'TAKSA ZA MEZHDUBANKOV PREVOD', category_id: 4, priority: 20 },
  { keyword: 'ДАНЪК ПЕЧАЛБА', category_id: 13, priority: 10 },
  { keyword: 'OFFICE COFFEE', category_id: 6, priority: 20 },
  { keyword: 'COFFEE OFFICE', category_id: 6, priority: 20 },
  // -- pre-existing keyword rules that the new ones must out-rank / co-exist with --
  { keyword: 'AZV-COMMISSION', category_id: 4, priority: 20 },
  { keyword: 'ТАКСИ ПОЛУЧЕНИ ВАЛУТНИ', category_id: 4, priority: 20 },
  { keyword: 'MAIN ASSEMBLY', category_id: 7, priority: 20 },
  { keyword: 'AGENT SERVIC', category_id: 7, priority: 20 },
  { keyword: 'KAFFEK', category_id: 6, priority: 15 },
];

const cat = (vendor: string | null, desc: string | null): number =>
  categorize(vendor, desc, VENDOR_RULES, KEYWORD_RULES).categoryId;

// ===========================================================================
// Owner entities -> Owner Payments (17). Beneficiary-driven (vendor rules),
// tab-independent: categorize only sees counterparty + description, so a payment
// filed under any project tab in history still resolves to 17 at ingest.
// ===========================================================================
test('owner entities: every mandated beneficiary variant -> 17', () => {
  const owners: string[] = [
    // Cyrillic originals (contains rules)
    'МАТЮ ДЖИ МАДЕЙ',
    'КАМЕН БОРИСЛАВОВ КАМЕНОВ',
    'КАТАЛИСТ ЕООД',
    'КАТАЛИСТ ИНТЕРАКТИВ ЕООД',
    'МЕЙН АСЕМБЛИ ЕООД',
    // English legal-name forms (contains rules — future-proof)
    'MATTHEW G MADEY',
    'MATTHEW G. MADEY',
    'MATTHEW G. MADEJ',
    'CATALYST INTERACTIVE LTD',
    'MAIN ASSEMBLY LTD.',
    // Bulgarian transliterations (caught by the §3 exact-rule retarget)
    'MEYN ASEMBLI EOOD',
    'KAMEN BORISLAVOV KAMENOV',
    'MATYu DZhI MADEY',
    'KATALIST EOOD',
    'KATALIST INTERAKTIV EOOD',
  ];
  for (const ben of owners) {
    assert.equal(cat(ben, 'заплата 02 2026 / invoice payment'), 17, `owner beneficiary must be 17: ${ben}`);
  }
});

test('owner rule is tab-independent: a Catalyst project-work payment still -> 17', () => {
  // Even if history filed this under a project tab, the counterparty match wins.
  assert.equal(cat('KATALIST INTERAKTIV EOOD', 'payment on invoice Invoice payment'), 17);
});

test('AZV-MAIN ASSEMBLY blank-beneficiary principal -> 17 (beats MAIN ASSEMBLY/AGENT SERVIC ->7)', () => {
  const principal = 'AZV-MAIN ASSEMBLY CYPRUS LTD, payment on invoice for agent servic es , GPP Ref.: 6058100878';
  assert.equal(cat('', principal), 17);
  assert.equal(cat(null, principal), 17);
});

// ===========================================================================
// AZV commission stays Bank & Transfer Fees (4) — mutually exclusive with the
// principal substring (verified: 0 corpus rows contain both).
// ===========================================================================
test('AZV commission lines -> 4 (unchanged), both received & issued FX-fee forms', () => {
  assert.equal(
    cat('', 'AZV-Commission 4162.50 USD for GPP transaction Ref.: 6064200025/Такси получени валутни преводи'),
    4,
  );
  assert.equal(
    cat('', 'AZV-Commission for GPP transaction Ref.: 6058100878/Такси издадени валутни преводи'),
    4,
  );
});

// ===========================================================================
// НАП split. Statutory social/pension/health/income-tax -> Payroll Taxes (2)
// via the KEPT vendor rule. Corporate profit tax -> Accounting & Compliance (13)
// only where the counterparty is blank/non-НАП (keyword can't beat the vendor
// rule — documented). Cyrillic forms exactly as they appear in the raw exports.
// ===========================================================================
test('НАП statutory remittances -> Payroll Taxes (2)', () => {
  const NAP = 'Национална Агенция за Приходите';
  const forms = [
    'Вноски за ДОО Платежно нареждане извън банката',        // social security
    'Вноски за ЗО Платежно нареждане извън банката',         // statutory health (ЗО)
    'Вноски за ДЗПО Платежно нареждане извън банката',       // mandatory supplementary pension
    'ДОД Платежно нареждане извън банката',                  // income-tax withholding
    'ЗДДФЛ Платежно нареждане извън банката',                // income-tax withholding (alt)
    'Ав данък граждански договори Платежно нареждане извън банката', // civil-contract withholding
  ];
  for (const d of forms) assert.equal(cat(NAP, d), 2, `НАП statutory must be 2: ${d}`);
});

test('НАП romanized beneficiary also -> 2', () => {
  assert.equal(cat('Natsionalna Agentsiya za Prihodite', 'Вноски за ДОО Платежно нареждане извън банката'), 2);
});

test('corporate profit tax: blank/non-НАП counterparty -> 13; НАП-beneficiary advance -> 2 (documented caveat)', () => {
  // Keyword fires when no vendor rule catches the row:
  assert.equal(cat('', 'Данък печалба авансов Платежно нареждане извън банката'), 13);
  assert.equal(cat(null, 'Данък печалба авансов'), 13);
  // With the НАП beneficiary the vendor rule (->2) wins first — accepted, documented:
  assert.equal(cat('Национална Агенция за Приходите', 'Данък печалба авансов Платежно нареждане извън банката'), 2);
});

test('private employee health/benefit policies -> Employee Benefits (8), not payroll taxes', () => {
  assert.equal(cat('ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД', 'Health Insurance employees'), 8);
  assert.equal(cat('БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД', 'ф-рa 2000318300 Multisport'), 8);
});

// ===========================================================================
// FACEBK -> Advertising & Marketing (16).
// ===========================================================================
test('FACEBK card lines -> Advertising & Marketing (16)', () => {
  assert.equal(cat('', 'POS 50.00 USD FACEBK *ADS 12345/fb.me/ads'), 16);
  assert.equal(cat(null, 'ПОС 120.00 USD авт.код:112233-FACEBK *ADVERT/MENLO PARK/USA'), 16);
});

// ===========================================================================
// BLINK interbank transfer fee -> Bank & Transfer Fees (4). One Cyrillic anchor
// covers both the BLINK-prefixed and bare forms; overrides the Misc labeling.
// ===========================================================================
test('BLINK interbank fee -> Bank & Transfer Fees (4)', () => {
  assert.equal(cat('', 'BLINK Такса за междубанков превод'), 4);
  assert.equal(cat('', 'Такса за междубанков превод'), 4);
  assert.equal(cat(null, ' BLINK Такса за междубанков превод'), 4);
});

// ===========================================================================
// Office coffee -> Office Supplies & Food (6). Latin literal inside a Cyrillic
// description; both order-text and invoice-note forms. Coffee capsules still hit
// the pre-existing KAFFEK rule.
// ===========================================================================
test('office coffee vending -> Office Supplies & Food (6)', () => {
  assert.equal(cat('СТРЕЗОВ ВЕНДИНГ ЕООД', 'поръчка ESH0048112 office coffee Издаден вътр.банков превод'), 6);
  assert.equal(cat('', 'ф-ра 0000002341 BLINK Платежно нареждане извън банката coffee office'), 6);
  // Coffee capsules remain covered by the existing KAFFEK->6 rule (migration 128):
  assert.equal(cat(null, 'ПОС 63.96 EUR авт.код:772659-KaffeKapslen/Hasselager/DNK/PAN:5408****8235'), 6);
});
