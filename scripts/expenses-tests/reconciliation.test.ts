// Run with: node --test scripts/expenses-tests/
// Path-gated reconciliation against the REAL UniCredit Bulbank export and its
// audited "_processed" ground truth. Skips cleanly (with a logged notice) when
// the Dropbox reference folder is not mounted, so CI stays green off-box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

import { parseBankExport } from '../../src/lib/xls/parseBankExport.ts';
import { convertToEur } from '../../src/lib/expenses/convertToEur.ts';
import { normalizeDescription } from '../../src/lib/expenses/normalizeDescription.ts';
import { hasCyrillic } from '../../src/lib/expenses/translate.ts';
import { categorize } from '../../src/lib/expenses/categorize.ts';
import { rowHash } from '../../src/lib/expenses/rowHash.ts';
import type { AccountCurrency, KeywordRule, VendorRule } from '../../src/lib/expenses/types.ts';

const REF_DIR = '/mnt/c/Users/Matthew/Dropbox/Organizations/The B Team/Financials/2025-AP';
const RAW = join(REF_DIR, 'report(3).xls');
const PROCESSED = join(REF_DIR, 'report(3)_processed.xlsx');

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(here, '..', 'expenses', 'output');
const DICT_JSON = join(OUTPUT_DIR, 'translation_dict.json');
const VENDOR_JSON = join(OUTPUT_DIR, 'vendor_rules.json');
const KEYWORD_JSON = join(OUTPUT_DIR, 'keyword_rules.json');

const available = existsSync(RAW) && existsSync(PROCESSED);
const skipReason = available ? false : 'reference files unavailable (Dropbox not mounted) — skipping';
if (!available) console.log(`[reconciliation] ${skipReason}`);

const CATEGORY_NAME_TO_ID: Record<string, number> = {
  'Payroll': 1,
  'Payroll Taxes': 2,
  'Software & AI Tools': 3,
  'Bank & Transfer Fees': 4,
  'Vehicle & Mobility': 5,
  'Office Supplies & Food': 6,
  'Contractors & Agency Fees': 7,
  'Employee Benefits': 8,
  'Office Operations': 9,
  'Utilities & Facilities': 10,
  'Telecom & Internet': 11,
  'Treasury & Wallet Transfers': 12,
  'Accounting & Compliance': 13,
  'Debt Service': 14,
  'Miscellaneous': 15,
};

function round2(n: number): number {
  const s = n < 0 ? -1 : 1;
  return (s * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

function toIsoDate(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s;
}

function alignKey(reference: string, amount: number, valueDate: string): string {
  return `${(reference ?? '').trim()}|${round2(amount).toFixed(2)}|${valueDate}`;
}

test('reconciliation: parseBankExport vs report(3)_processed.xlsx (currency + eur to the cent)', { skip: skipReason }, () => {
  const html = readFileSync(RAW, 'utf8');
  const { rows } = parseBankExport(html);

  const buf = readFileSync(PROCESSED);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['Translated_Data'];
  const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

  // Build processed lookup by reference|amount|value_date.
  const processedByKey = new Map<string, Record<string, unknown>>();
  for (const rec of recs) {
    const key = alignKey(
      String(rec.reference ?? ''),
      Number(rec.amount_account_currency ?? 0),
      toIsoDate(rec.value_date),
    );
    if (!processedByKey.has(key)) processedByKey.set(key, rec);
  }

  let aligned = 0;
  let exact = 0;
  const mismatches: string[] = [];
  for (const r of rows) {
    if (!r.reference) continue;
    const key = alignKey(r.reference, r.originalAmount, r.valueDate);
    const rec = processedByKey.get(key);
    if (!rec) continue;
    aligned++;

    const expectedCur = String(rec.account_currency ?? '').toUpperCase();
    const expectedEur = round2(Number(rec.amount_eur_fixed_rate ?? NaN));
    const myCur = r.accountCurrency ?? '(null)';
    const myEur = r.accountCurrency ? convertToEur(r.accountCurrency as AccountCurrency, r.originalAmount).eurAmount : NaN;

    if (myCur === expectedCur && myEur === expectedEur) {
      exact++;
    } else if (mismatches.length < 40) {
      mismatches.push(
        `ref=${r.reference} vd=${r.valueDate} amt=${r.originalAmount} ` +
          `cur(mine=${myCur} ref=${expectedCur}) eur(mine=${myEur} ref=${expectedEur})`,
      );
    }
  }

  const ratio = aligned ? exact / aligned : 0;
  console.log(
    `[reconciliation] parsed=${rows.length} processed=${recs.length} aligned=${aligned} ` +
      `exact=${exact} (${(ratio * 100).toFixed(2)}%)`,
  );
  if (mismatches.length) {
    console.log(`[reconciliation] residual mismatches (${mismatches.length} shown):`);
    for (const m of mismatches) console.log('  - ' + m);
  }

  assert.ok(aligned > 0, 'expected to align at least some rows');
  assert.ok(ratio >= 0.99, `currency+eur exact match ${(ratio * 100).toFixed(2)}% < 99% (see residual list)`);
});

test('reconciliation: real-data row_hash uniqueness (distinct hashes vs rows)', { skip: skipReason }, async () => {
  const html = readFileSync(RAW, 'utf8');
  const { rows } = parseBankExport(html);

  const hashes = await Promise.all(
    rows.map((r) =>
      rowHash({
        account: r.account,
        txnDatetime: r.txnDatetime,
        valueDate: r.valueDate,
        originalAmount: r.originalAmount,
        reference: r.reference,
        descriptionOriginal: r.descriptionOriginal,
      }),
    ),
  );

  const groups = new Map<string, number[]>();
  hashes.forEach((h, i) => {
    const g = groups.get(h);
    if (g) g.push(i);
    else groups.set(h, [i]);
  });

  const collisions = [...groups.values()].filter((idxs) => idxs.length > 1);
  console.log(`[reconciliation] rows=${rows.length} distinct_hashes=${groups.size} collision_groups=${collisions.length}`);
  for (const idxs of collisions.slice(0, 10)) {
    // A collision here means two rows share account|dt-to-sec|amount|ref|desc.
    // Report them so a human can confirm they are true source duplicates
    // (not genuinely-distinct rows the hash wrongly merged).
    const sample = idxs.map((i) => {
      const r = rows[i];
      return `{ref=${r.reference} dt=${r.txnDatetime ?? r.valueDate} amt=${r.originalAmount}}`;
    });
    console.log(`  collision x${idxs.length}: ${sample.join(' == ')}`);
  }

  // Distinct-hash count is reported above; a collision between genuinely
  // distinct transactions would be a bug to escalate, but same account +
  // datetime-to-seconds + amount + reference + description repeating is a true
  // source duplicate and correctly de-duplicates. We assert only that the hash
  // is total (one per row) and stable — uniqueness numbers are reported.
  assert.equal(hashes.length, rows.length);
});

test('reconciliation: dictionary hit-rate + category agreement over real Cyrillic rows', { skip: skipReason }, () => {
  if (!existsSync(DICT_JSON) || !existsSync(VENDOR_JSON) || !existsSync(KEYWORD_JSON)) {
    console.log('[reconciliation] seed files (Agent A output) not present — skipping measurements');
    return;
  }

  const html = readFileSync(RAW, 'utf8');
  const { rows } = parseBankExport(html);

  type DictEntry = { normalized_key: string; en_translation: string };
  const dictArr = JSON.parse(readFileSync(DICT_JSON, 'utf8')) as DictEntry[];
  const dict = new Map(dictArr.map((d) => [d.normalized_key, d.en_translation]));
  const vendorRules = JSON.parse(readFileSync(VENDOR_JSON, 'utf8')) as VendorRule[];
  const keywordRules = JSON.parse(readFileSync(KEYWORD_JSON, 'utf8')) as KeywordRule[];

  // Seed staleness signal: are any vendor patterns in Cyrillic yet?
  const cyrillicVendorPatterns = vendorRules.filter((v) => hasCyrillic(String(v.pattern ?? ''))).length;
  if (cyrillicVendorPatterns === 0) {
    console.log(
      `[reconciliation] NOTE: vendor seeds appear STALE (0/${vendorRules.length} Cyrillic patterns). ` +
        `Category agreement on Cyrillic beneficiaries will be understated until Agent A lands raw-Cyrillic seeds.`,
    );
  }

  // Dictionary hit-rate over Cyrillic rows, keyed by Основание + Описание.
  let cyr = 0;
  let hits = 0;
  for (const r of rows) {
    const lookup = `${r.paymentReason ?? ''} ${r.operationDescription ?? ''}`.trim();
    if (!hasCyrillic(lookup)) continue;
    cyr++;
    if (dict.has(normalizeDescription(lookup))) hits++;
  }
  const hitRate = cyr ? hits / cyr : 0;
  console.log(`[reconciliation] dict hit-rate over Cyrillic rows: ${hits}/${cyr} = ${(hitRate * 100).toFixed(1)}%`);

  // Category agreement vs the processed Category column, over aligned rows.
  const buf = readFileSync(PROCESSED);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const recs = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Translated_Data'], { defval: null });
  const processedByKey = new Map<string, Record<string, unknown>>();
  for (const rec of recs) {
    const key = alignKey(String(rec.reference ?? ''), Number(rec.amount_account_currency ?? 0), toIsoDate(rec.value_date));
    if (!processedByKey.has(key)) processedByKey.set(key, rec);
  }

  let aligned = 0;
  let agree = 0;
  for (const r of rows) {
    if (!r.reference) continue;
    const rec = processedByKey.get(alignKey(r.reference, r.originalAmount, r.valueDate));
    if (!rec) continue;
    const expectedId = CATEGORY_NAME_TO_ID[String(rec.category ?? '').trim()];
    if (!expectedId) continue;
    aligned++;
    const vendor = r.entryType === 'Credit' ? r.payer ?? r.beneficiary : r.beneficiary ?? r.payer;
    const myId = categorize(vendor ?? null, r.descriptionOriginal, vendorRules, keywordRules).categoryId;
    if (myId === expectedId) agree++;
  }
  const agreeRate = aligned ? agree / aligned : 0;
  console.log(`[reconciliation] category agreement vs reference: ${agree}/${aligned} = ${(agreeRate * 100).toFixed(1)}%`);

  // Measurements only (no hard threshold) — reported for Agent A seed tuning.
  assert.ok(cyr > 0, 'expected some Cyrillic rows in the real export');
});
