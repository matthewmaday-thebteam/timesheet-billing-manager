// Run with: node --test scripts/expenses-tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseBankExport } from '../../src/lib/xls/parseBankExport.ts';
import { convertToEur, round2 } from '../../src/lib/expenses/convertToEur.ts';
import { assignMonth } from '../../src/lib/expenses/assignMonth.ts';
import { categorize } from '../../src/lib/expenses/categorize.ts';
import { rowHash } from '../../src/lib/expenses/rowHash.ts';
import type { AccountCurrency, KeywordRule, RawBankRow, VendorRule } from '../../src/lib/expenses/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const htmlXls = readFileSync(join(here, 'fixtures', 'sample-bank-html.xls'), 'utf8');

const vendorRules: VendorRule[] = [
  { match_type: 'contains', pattern: 'cloud vendor', category_id: 3, priority: 10 },
];
const keywordRules: KeywordRule[] = [
  { keyword: 'такса', category_id: 4, priority: 10 },
];

test('totals invariant: grand EUR == Σ per-row == Σ per-month == Σ per-category', () => {
  const { rows } = parseBankExport(htmlXls);

  const perRow = rows.map((r) => convertToEur(r.accountCurrency as AccountCurrency, r.originalAmount).eurAmount);
  const grand = round2(perRow.reduce((a, b) => a + b, 0));

  const byMonth = new Map<string, number>();
  const byCategory = new Map<number, number>();
  for (const r of rows) {
    const eur = convertToEur(r.accountCurrency as AccountCurrency, r.originalAmount).eurAmount;
    const month = assignMonth(r.valueDate);
    byMonth.set(month, round2((byMonth.get(month) ?? 0) + eur));
    const cat = categorize(r.beneficiary, r.descriptionOriginal, vendorRules, keywordRules).categoryId;
    byCategory.set(cat, round2((byCategory.get(cat) ?? 0) + eur));
  }

  const monthTotal = round2(Array.from(byMonth.values()).reduce((a, b) => a + b, 0));
  const catTotal = round2(Array.from(byCategory.values()).reduce((a, b) => a + b, 0));

  assert.equal(monthTotal, grand);
  assert.equal(catTotal, grand);

  // Concrete expected grand total for this fixture set, under corrected
  // (SECOND-token = account currency) semantics, to the cent:
  //   EUR 35.25 + EUR 273.00 + BGN 100→51.13 + BGN 29→14.83 + 0 + EUR 10 = 384.21
  assert.equal(grand, 384.21);
});

test('every parsed row is categorized (fallback 15 when nothing matches), never dropped', () => {
  const { rows } = parseBankExport(htmlXls);
  assert.equal(rows.length, 6);
  for (const r of rows) {
    const c = categorize(r.beneficiary, r.descriptionOriginal, vendorRules, keywordRules);
    assert.ok(c.categoryId >= 1 && c.categoryId <= 15);
    if (c.categorySource === 'fallback') {
      assert.equal(c.categoryId, 15);
      assert.equal(c.needsReview, true);
    }
  }
});

test('idempotent re-ingest: same rows hash to the same set (all duplicates)', async () => {
  const { rows } = parseBankExport(htmlXls);
  const hashOf = (r: RawBankRow) =>
    rowHash({
      account: r.account,
      txnDatetime: r.txnDatetime,
      valueDate: r.valueDate,
      originalAmount: r.originalAmount,
      reference: r.reference,
      descriptionOriginal: r.descriptionOriginal,
    });

  const first = new Set(await Promise.all(rows.map(hashOf)));
  const second = await Promise.all(rows.map(hashOf));
  assert.equal(first.size, rows.length); // all distinct within one file
  assert.equal(second.every((h) => first.has(h)), true); // re-ingest → all known
});

const hashOf = (r: {
  account: string;
  txnDatetime: string | null;
  valueDate: string;
  originalAmount: number;
  reference: string | null;
  descriptionOriginal: string;
}) => rowHash(r);

// A synthetic month row: account currency + amount + a per-month reference.
function monthRow(account: string, month: string, ref: string, amount: number) {
  return {
    account,
    txnDatetime: `${month}-15T10:00:00`,
    valueDate: `${month}-15`,
    originalAmount: amount,
    reference: ref,
    descriptionOriginal: `Плащане ${ref}`,
  };
}

test('cross-file overlap: file2 re-covering shared months inserts ONLY the new rows', async () => {
  // File 1 covers Jan–Jun; File 2 covers Apr–Sep with Apr–Jun byte-identical.
  const jan = monthRow('AC1EUR', '2025-01', 'R-JAN', 10);
  const feb = monthRow('AC1EUR', '2025-02', 'R-FEB', 20);
  const mar = monthRow('AC1EUR', '2025-03', 'R-MAR', 30);
  const apr = monthRow('AC1EUR', '2025-04', 'R-APR', 40);
  const may = monthRow('AC1EUR', '2025-05', 'R-MAY', 50);
  const jun = monthRow('AC1EUR', '2025-06', 'R-JUN', 60);
  const jul = monthRow('AC1EUR', '2025-07', 'R-JUL', 70);
  const aug = monthRow('AC1EUR', '2025-08', 'R-AUG', 80);
  const sep = monthRow('AC1EUR', '2025-09', 'R-SEP', 90);

  const file1 = [jan, feb, mar, apr, may, jun];
  const file2 = [{ ...apr }, { ...may }, { ...jun }, jul, aug, sep]; // Apr–Jun identical content

  // Ingest file 1 → the "database" is the set of known row hashes.
  const known = new Set(await Promise.all(file1.map(hashOf)));
  const janJunTotal = round2(file1.reduce((a, r) => a + r.originalAmount, 0));

  // Ingest file 2 against the same store (row-level ON CONFLICT DO NOTHING).
  const file2Hashes = await Promise.all(file2.map(hashOf));
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < file2.length; i++) {
    if (known.has(file2Hashes[i])) {
      skipped += 1;
    } else {
      known.add(file2Hashes[i]);
      inserted += 1;
    }
  }

  // Exactly the Jul–Sep rows are new; Apr–Jun were duplicates.
  assert.equal(inserted, 3);
  assert.equal(skipped, 3);
  // Summary would report new vs skipped correctly; total accounted for.
  assert.equal(inserted + skipped, file2.length);

  // Jan–Jun totals unchanged to the cent (no double counting).
  const janJunAfter = round2([jan, feb, mar, apr, may, jun].reduce((a, r) => a + r.originalAmount, 0));
  assert.equal(janJunAfter, janJunTotal);
  // Final store holds Jan–Sep = 9 unique rows.
  assert.equal(known.size, 9);
});

test('accounting invariant: total = inserted + skipped_duplicates + rejected', async () => {
  // Simulate the edge-function accounting over a mixed batch.
  const good1 = monthRow('AC1EUR', '2025-01', 'G1', 10);
  const good2 = monthRow('AC1EUR', '2025-02', 'G2', 20);
  const dupOfGood1 = { ...good1 }; // identical → duplicate
  const unresolved = monthRow('AC1XYZ', '2025-03', 'U1', 30); // currency cannot resolve

  const total = 4; // rows in "file"
  const store = new Set<string>();
  let inserted = 0;
  let skipped = 0;
  const rejected: string[] = [];

  for (const r of [good1, good2, dupOfGood1, unresolved]) {
    // Pre-insert currency gate (…XYZ is neither EUR nor BGN).
    if (!/(EUR|BGN)$/.test(r.account)) {
      rejected.push('unresolved_currency');
      continue;
    }
    const h = await hashOf(r);
    if (store.has(h)) skipped += 1;
    else {
      store.add(h);
      inserted += 1;
    }
  }

  assert.equal(inserted, 2);
  assert.equal(skipped, 1);
  assert.equal(rejected.length, 1);
  assert.equal(total, inserted + skipped + rejected.length); // the invariant
});
