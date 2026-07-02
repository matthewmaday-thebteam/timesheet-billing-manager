// Run with: node --test scripts/expenses-tests/
// Node >= 22.6 strips TypeScript types natively (default on 23.6+).
//
// Task 11 — USD REPORTING layer. Proves, at the pure-logic level:
//   - month-dependent rate application (same EUR, different month → different USD)
//   - the partial-month ECB convention (monthly vs daily-average vs future)
//   - rate-missing graceful degradation (USD null, row still ingests + is counted)
//   - the self-healing pending-fill (fills once a rate appears; idempotent)
//   - the single-computation-path USD invariants over the tree (children sum to
//     parent; pending rows excluded from totals and counted consistently)
//   - the EUR normalization layer is UNTOUCHED by the added USD layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertToUsd } from '../../src/lib/expenses/convertToUsd.ts';
import { round2 } from '../../src/lib/expenses/convertToEur.ts';
import {
  planFxLookup,
  parseEcbObsValues,
  averageRate6,
} from '../../supabase/functions/ingest-expenses/_lib/fetchEcbRate.ts';
import { buildExpenseTree, toCents } from '../../src/components/expenses/expenseTree.ts';
import type {
  ExpenseCategoryRecord,
  ExpenseRecord,
} from '../../src/components/expenses/expenseTypes.ts';

// Authoritative mined rates (subset), used to prove month-dependency.
const RATE_JAN = 1.035373; // 2025-01 (workbook_seed)
const RATE_DEC = 1.170871; // 2025-12 (workbook_seed)

// ---------------------------------------------------------------------------
// convertToUsd — the single per-row USD arithmetic
// ---------------------------------------------------------------------------

test('convertToUsd: usd_amount = round2(eur × month rate); rate is passed through', () => {
  const r = convertToUsd(100, RATE_JAN);
  assert.equal(r.usdAmount, 103.54); // 103.5373 → 103.54
  assert.equal(r.usdRate, RATE_JAN);
});

test('convertToUsd: MONTH-DEPENDENT — identical EUR, different months, different USD', () => {
  const jan = convertToUsd(100, RATE_JAN);
  const dec = convertToUsd(100, RATE_DEC);
  assert.equal(jan.usdAmount, 103.54);
  assert.equal(dec.usdAmount, 117.09); // 117.0871 → 117.09
  assert.notEqual(jan.usdAmount, dec.usdAmount);
});

test('convertToUsd: rounds half away from zero, sign preserved (matches EUR round2)', () => {
  // 2.005 × 1 = 2.005 → 2.01 (away from zero), and the negative mirror.
  assert.equal(convertToUsd(2.005, 1).usdAmount, 2.01);
  assert.equal(convertToUsd(-2.005, 1).usdAmount, -2.01);
  // Equivalent to the shared round2 used by the EUR layer.
  assert.equal(convertToUsd(149439.91, RATE_JAN).usdAmount, round2(149439.91 * RATE_JAN));
});

// ---------------------------------------------------------------------------
// ECB convention — monthly vs partial-month daily average vs future
// ---------------------------------------------------------------------------

test('planFxLookup: a completed past month uses the ECB MONTHLY series', () => {
  const plan = planFxLookup('2026-03', '2026-07-02T09:00:00Z');
  assert.ok(plan);
  assert.equal(plan.source, 'ecb_monthly');
  assert.match(plan.url, /\/M\.USD\.EUR\.SP00\.A\?startPeriod=2026-03&endPeriod=2026-03/);
});

test('planFxLookup: the CURRENT (unpublished) month uses a partial-month DAILY average', () => {
  const plan = planFxLookup('2026-07', '2026-07-02T09:00:00Z');
  assert.ok(plan);
  assert.equal(plan.source, 'ecb_daily_avg');
  assert.match(plan.url, /\/D\.USD\.EUR\.SP00\.A\?startPeriod=2026-07-01&endPeriod=2026-07-02/);
});

test('planFxLookup: a future month has no data → null (row stays pending)', () => {
  assert.equal(planFxLookup('2026-08', '2026-07-02T09:00:00Z'), null);
});

test('parseEcbObsValues + averageRate6: parse OBS_VALUE, average daily rows to 6dp', () => {
  const csv = [
    'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS',
    'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-01,1.100000,A',
    'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-02,1.200000,A',
  ].join('\n');
  const values = parseEcbObsValues(csv);
  assert.deepEqual(values, [1.1, 1.2]);
  assert.equal(averageRate6(values), 1.15);
  // A single monthly OBS row averages to itself (rounded 6dp).
  assert.equal(averageRate6([1.0806809523810]), 1.080681);
  // Empty / malformed → null (fetch layer then leaves the month pending).
  assert.equal(averageRate6(parseEcbObsValues('no,data')), null);
});

// ---------------------------------------------------------------------------
// Ingest per-row apply + rate-missing degradation (pure model of the edge step)
// ---------------------------------------------------------------------------

/** Pure model of the ingest per-row USD assignment (index.ts section d). */
function applyUsdAtIngest(eurAmount: number, fxMap: Map<string, number>, month: string) {
  const rate = fxMap.get(month);
  if (rate == null) return { usd_amount: null, usd_rate: null };
  const { usdAmount, usdRate } = convertToUsd(eurAmount, rate);
  return { usd_amount: usdAmount, usd_rate: usdRate };
}

test('rate-missing degradation: unknown month → USD null (ingest still succeeds) and is counted', () => {
  const fx = new Map<string, number>([['2025-01', RATE_JAN]]);
  const known = applyUsdAtIngest(100, fx, '2025-01');
  const missing = applyUsdAtIngest(100, fx, '2025-99'); // no rate for this month

  assert.equal(known.usd_amount, 103.54);
  assert.equal(missing.usd_amount, null); // pending, NOT zero, NOT a failure

  // The ingest summary counts pending rows exactly (usd_amount === null).
  const rows = [known, missing];
  const usdPending = rows.filter((r) => r.usd_amount === null).length;
  assert.equal(usdPending, 1);
});

// ---------------------------------------------------------------------------
// Self-healing pending-fill (pure model of fill_pending_usd, round(x,2) == round2)
// ---------------------------------------------------------------------------

interface FillRow {
  eur_amount: number;
  assigned_month: string;
  usd_amount: number | null;
}

/** Pure mirror of the SQL fill_pending_usd(): only touches usd_amount IS NULL. */
function fillPendingUsd(rows: FillRow[], fxMap: Map<string, number>): number {
  let filled = 0;
  for (const row of rows) {
    if (row.usd_amount != null) continue;
    const rate = fxMap.get(row.assigned_month);
    if (rate == null) continue;
    row.usd_amount = convertToUsd(row.eur_amount, rate).usdAmount;
    filled += 1;
  }
  return filled;
}

test('pending-fill: heals rows once the month rate appears; idempotent and value-correct', () => {
  const rows: FillRow[] = [
    { eur_amount: 100, assigned_month: '2025-01', usd_amount: null },
    { eur_amount: 50, assigned_month: '2025-12', usd_amount: null },
    { eur_amount: 10, assigned_month: '2099-01', usd_amount: null }, // never gets a rate
  ];

  // Run 1: only the Jan rate is known → exactly one row heals.
  const fx = new Map<string, number>([['2025-01', RATE_JAN]]);
  assert.equal(fillPendingUsd(rows, fx), 1);
  assert.equal(rows[0].usd_amount, 103.54);
  assert.equal(rows[1].usd_amount, null);

  // Re-run with the same map: idempotent (already-filled rows are not recomputed).
  assert.equal(fillPendingUsd(rows, fx), 0);

  // Run 2: the Dec rate now exists → the second row heals; the 2099 row stays pending.
  fx.set('2025-12', RATE_DEC);
  assert.equal(fillPendingUsd(rows, fx), 1);
  assert.equal(rows[1].usd_amount, round2(50 * RATE_DEC)); // 58.54
  assert.equal(rows[2].usd_amount, null);
});

// ---------------------------------------------------------------------------
// Single-computation-path invariants over the tree (USD cents)
// ---------------------------------------------------------------------------

const categories: ExpenseCategoryRecord[] = [
  { id: 1, name: 'Cloud', overhead_type: 'Variable', sort_order: 1, is_fallback: false },
  { id: 2, name: 'Rent', overhead_type: 'Fixed', sort_order: 2, is_fallback: false },
];

let seq = 0;
function makeExpense(overrides: Partial<ExpenseRecord>): ExpenseRecord {
  seq += 1;
  const eur = overrides.eur_amount ?? 0;
  return {
    id: `row-${seq}`,
    account_currency: 'EUR',
    original_amount: 0,
    operation_currency: null,
    operation_amount: null,
    eur_amount: eur,
    conversion_rate: 1,
    rate_source: 'identity',
    usd_amount: null,
    usd_rate: null,
    usd_rate_source: null,
    entry_type: 'Debit',
    description_original: null,
    description_translated: null,
    translation_source: null,
    vendor: null,
    beneficiary: null,
    reference: null,
    category_id: 1,
    category_source: null,
    value_date: '2025-01-15',
    assigned_month: '2025-01',
    needs_review: false,
    ...overrides,
  };
}

/** Attach a stored USD value for `month` using the mined rate (as ingest would). */
function withUsd(month: string, rate: number, o: Partial<ExpenseRecord>): ExpenseRecord {
  const base = makeExpense({ assigned_month: month, value_date: `${month}-10`, ...o });
  const { usdAmount, usdRate } = convertToUsd(base.eur_amount, rate);
  return { ...base, usd_amount: usdAmount, usd_rate: usdRate, usd_rate_source: 'workbook_seed' };
}

test('tree USD invariants: children sum to parent, grand = Σ leaves, pending excluded + counted', () => {
  const rows: ExpenseRecord[] = [
    withUsd('2025-01', RATE_JAN, { eur_amount: 100, category_id: 1 }), // $103.54
    withUsd('2025-01', RATE_JAN, { eur_amount: 40.5, category_id: 2 }), // $41.93
    withUsd('2025-12', RATE_DEC, { eur_amount: 200, category_id: 1 }), // $234.17
    // A pending row (rate unknown at ingest): included in EUR, excluded from USD.
    makeExpense({ eur_amount: 999.99, category_id: 1, assigned_month: '2025-12', value_date: '2025-12-20' }),
    // A credit: excluded from BOTH EUR and USD everywhere.
    { ...withUsd('2025-01', RATE_JAN, { eur_amount: 5000, category_id: 1 }), entry_type: 'Credit' },
  ];

  const tree = buildExpenseTree(rows, categories);

  // Grand USD = Σ of the three non-credit, non-pending rows' usd cents.
  const expectedUsdCents = toCents(103.54) + toCents(41.93) + toCents(234.17);
  assert.equal(tree.grandUsdTotalCents, expectedUsdCents);

  // Exactly one included row is pending (the credit is excluded entirely).
  assert.equal(tree.grandUsdPendingCount, 1);

  // Children sum to parent at every level, for BOTH totals and pending counts.
  let sumYearUsd = 0;
  let sumYearPending = 0;
  for (const year of tree.years) {
    let sumMonthUsd = 0;
    let sumMonthPending = 0;
    for (const month of year.months) {
      const catUsd = month.categories.reduce((a, c) => a + c.usdTotalCents, 0);
      const catPending = month.categories.reduce((a, c) => a + c.usdPendingCount, 0);
      assert.equal(catUsd, month.usdTotalCents);
      assert.equal(catPending, month.usdPendingCount);
      sumMonthUsd += month.usdTotalCents;
      sumMonthPending += month.usdPendingCount;
    }
    assert.equal(sumMonthUsd, year.usdTotalCents);
    assert.equal(sumMonthPending, year.usdPendingCount);
    sumYearUsd += year.usdTotalCents;
    sumYearPending += year.usdPendingCount;
  }
  assert.equal(sumYearUsd, tree.grandUsdTotalCents);
  assert.equal(sumYearPending, tree.grandUsdPendingCount);

  // Pending count reconciles with the raw rows (included, non-credit, usd null).
  const rawPending = rows.filter((r) => r.entry_type !== 'Credit' && r.usd_amount == null).length;
  assert.equal(tree.grandUsdPendingCount, rawPending);
});

// ---------------------------------------------------------------------------
// EUR layer regression — the added USD layer must not perturb any EUR total
// ---------------------------------------------------------------------------

test('EUR layer UNTOUCHED: EUR totals identical whether or not USD is populated', () => {
  const shape: Partial<ExpenseRecord>[] = [
    { eur_amount: 100, category_id: 1, assigned_month: '2025-01', value_date: '2025-01-05' },
    { eur_amount: 40.5, category_id: 2, assigned_month: '2025-01', value_date: '2025-01-06' },
    { eur_amount: 200, category_id: 1, assigned_month: '2025-12', value_date: '2025-12-10' },
  ];

  // Same rows, one build with USD populated, one with USD left pending (null).
  const withUsdRows = shape.map((o) => withUsd(o.assigned_month!, RATE_JAN, o));
  const withoutUsdRows = shape.map((o) => makeExpense(o));

  const a = buildExpenseTree(withUsdRows, categories);
  const b = buildExpenseTree(withoutUsdRows, categories);

  // EUR grand + per-year totals are byte-for-byte independent of the USD layer.
  assert.equal(a.grandTotalCents, toCents(100) + toCents(40.5) + toCents(200));
  assert.equal(a.grandTotalCents, b.grandTotalCents);
  assert.equal(a.expenseCount, b.expenseCount);
  for (let i = 0; i < a.years.length; i++) {
    assert.equal(a.years[i].totalCents, b.years[i].totalCents);
  }
  // And populating USD did not leak into the EUR figure.
  assert.notEqual(a.grandUsdTotalCents, 0);
  assert.equal(b.grandUsdTotalCents, 0);
});
