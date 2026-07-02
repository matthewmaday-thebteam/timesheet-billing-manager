// Run with: node --test scripts/expenses-tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';

import { parseBankExport, parseAmount } from '../../src/lib/xls/parseBankExport.ts';
import { sniffFormat } from '../../src/lib/xls/sniffFormat.ts';
import { convertToEur } from '../../src/lib/expenses/convertToEur.ts';
import { assignMonth } from '../../src/lib/expenses/assignMonth.ts';
import type { RawBankRow } from '../../src/lib/expenses/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const htmlXls = readFileSync(join(here, 'fixtures', 'sample-bank-html.xls'), 'utf8');

function byRef(rows: RawBankRow[], ref: string): RawBankRow {
  const row = rows.find((r) => r.reference === ref);
  assert.ok(row, `row ${ref} not found`);
  return row!;
}

test('parseAmount handles space thousands + comma/dot decimals', () => {
  assert.equal(parseAmount('35.25'), 35.25);
  assert.equal(parseAmount('1 300.00'), 1300);
  assert.equal(parseAmount('24 491,10'), 24491.1);
  assert.equal(parseAmount('2.030,00'), 2030);
  assert.equal(parseAmount('17,40'), 17.4);
  assert.equal(parseAmount('0.00'), 0);
});

test('sniffFormat classifies containers by content, not extension', () => {
  assert.equal(sniffFormat(htmlXls), 'html_xls');
  assert.equal(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'xlsx');
  assert.equal(sniffFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), 'binary_xls');
});

test('parseBankExport: HTML-.xls fixture — structure, currency, entry type', () => {
  const { sourceFormat, rows } = parseBankExport(htmlXls);
  assert.equal(sourceFormat, 'html_xls');
  assert.equal(rows.length, 6);

  const a = byRef(rows, 'REF0001');
  assert.equal(a.account, 'AC00001EUR');
  assert.equal(a.accountCurrency, 'EUR');
  assert.equal(a.operationCurrency, 'EUR');
  assert.equal(a.originalAmount, 35.25);
  assert.equal(a.entryType, 'Debit');
  assert.equal(a.valueDate, '2025-12-26');
  assert.equal(a.txnDatetime, '2025-12-30T15:10:53');
  assert.equal(a.beneficiary, 'ТЕСТ ДОСТАВЧИК ЕООД');
  // Stored description = Основание + Описание + Още пояснения.
  assert.equal(a.paymentReason, 'Такса за обслужване');
  assert.equal(a.operationDescription, 'Операция с карта');
  assert.equal(a.descriptionOriginal, 'Такса за обслужване Операция с карта');
});

test('parseBankExport: rate account currency = SECOND token; EUR-acct/USD-op EUR = account amount', () => {
  const { rows } = parseBankExport(htmlXls);
  const b = byRef(rows, 'REF0002'); // rate "1.087900 USD / EUR"
  assert.equal(b.accountCurrency, 'EUR'); // second token
  assert.equal(b.operationCurrency, 'USD'); // first token
  assert.equal(b.originalAmount, 273);
  assert.equal(b.operationAmount, 297);
  assert.equal(convertToEur(b.accountCurrency!, b.originalAmount).eurAmount, 273);
});

test('parseBankExport: BGN account resolved from SECOND rate token, peg conversion', () => {
  const { rows } = parseBankExport(htmlXls);
  const c = byRef(rows, 'REF0003'); // rate "0.511300 EUR / BGN"
  assert.equal(c.accountCurrency, 'BGN'); // second token
  assert.equal(c.operationCurrency, 'EUR'); // first token
  assert.equal(convertToEur(c.accountCurrency!, c.originalAmount).eurAmount, 51.13);
});

test('parseBankExport: fee row with DROPPED cells maps correctly + suffix currency fallback', () => {
  const { rows } = parseBankExport(htmlXls);
  const d = byRef(rows, 'REF0004');
  // This row omits the operation-amount and exchange-rate cells entirely.
  assert.equal(d.originalAmount, 29);
  assert.equal(d.operationAmount, null);
  assert.equal(d.exchangeRateRaw, null);
  assert.equal(d.entryType, 'Debit');
  assert.equal(d.descriptionOriginal, 'Дължима периодична такса');
  // Rate-less row → currency from the account-number suffix (…BGN), NOT a
  // per-file map (which is unsound: the same account books both currencies).
  assert.equal(d.accountCurrency, 'BGN');
  assert.equal(convertToEur(d.accountCurrency!, d.originalAmount).eurAmount, 14.83);
});

test('parseBankExport: zero-amount anomaly row is retained', () => {
  const { rows } = parseBankExport(htmlXls);
  const e = byRef(rows, 'REF0005');
  assert.equal(e.originalAmount, 0);
  assert.equal(e.entryType, 'Credit');
  assert.equal(convertToEur(e.accountCurrency!, e.originalAmount).eurAmount, 0);
});

test('parseBankExport: month boundary — value_date month, not booking_date month', () => {
  const { rows } = parseBankExport(htmlXls);
  const f = byRef(rows, 'REF0006');
  assert.equal(f.valueDate, '2026-01-31');
  assert.equal(f.bookingDate, '2026-02-02');
  assert.equal(assignMonth(f.valueDate), '2026-01');
});

// Build an HTML-<table> "bank export" from a 2-D grid, mirroring the real
// UniCredit English-UI export (an HTML file misnamed .xls). Empty cells are
// emitted as empty <td> so the grid keeps fixed positions for this fixture.
function gridToHtmlXls(grid: string[][]): string {
  const rowsHtml = grid
    .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('');
  return `<html><head></head><body><table>${rowsHtml}</table></body></html>`;
}

test('parseBankExport: English-UI export — Latin DR/CR marks + English header parse', () => {
  // English header (Latin markers "Account" + "Value date"; Type column = "Type")
  // and Latin DR/CR entry-type marks, exactly as the English eBank UI exports.
  const header = [
    'Account', 'Date/Time', 'Process date', 'Reference', 'Value date',
    'Amount in currency of the account', 'Amount in currency of the transaction', 'Exchange rate',
    'Type', 'Beneficiary IBAN', 'Beneficiary', 'IBAN Sender', 'Sender',
    'Description of the operation', 'Details of Payment', 'Additional Details',
  ];
  const debitRow = ['1522532201EUR', '30.06.2026 15:48:52', '30.06.2026 15:48:52', 'ENG-DR-1', '30.06.2026',
    '164.95', '164.95', '1.000000 EUR / EUR', 'DR', 'BG00BENEF', 'ACME LTD', 'BG51SENDER', 'THE FIRM',
    'POS payment', 'Card operation', ''];
  const creditRow = ['Main Assembly BGN', '30.06.2026 12:51:19', '30.06.2026 12:51:20', 'ENG-CR-1', '30.06.2026',
    '3347.86', '3347.86', '1.000000 EUR / EUR', 'CR', 'BG75PAYER', 'MAIN ASSEMBLY', 'BG51SENDER', 'THE FIRM',
    'Incoming transfer', 'Reimbursement', ''];

  const { sourceFormat, rows } = parseBankExport(gridToHtmlXls([header, debitRow, creditRow]));
  assert.equal(sourceFormat, 'html_xls');
  assert.equal(rows.length, 2);

  const dr = byRef(rows, 'ENG-DR-1');
  assert.equal(dr.entryType, 'Debit'); // DR → Debit
  assert.equal(dr.account, '1522532201EUR');
  assert.equal(dr.accountCurrency, 'EUR');
  assert.equal(dr.originalAmount, 164.95);
  assert.equal(dr.beneficiary, 'ACME LTD');

  const cr = byRef(rows, 'ENG-CR-1');
  assert.equal(cr.entryType, 'Credit'); // CR → Credit
  assert.equal(cr.originalAmount, 3347.86);
});

test('parseBankExport: English-UI export — POS row with EMPTY reference + "0.000000 EUR / EUR" rate', () => {
  // Mirrors the real edge row: empty reference is allowed, and the SECOND rate
  // token (EUR) resolves the account currency even at a 0.000000 rate.
  const header = [
    'Account', 'Date/Time', 'Process date', 'Reference', 'Value date',
    'Amount in currency of the account', 'Amount in currency of the transaction', 'Exchange rate',
    'Type', 'Beneficiary IBAN', 'Beneficiary', 'IBAN Sender', 'Sender',
    'Description of the operation', 'Details of Payment', 'Additional Details',
  ];
  const posRow = ['1522532201EUR', '30.06.2026 15:48:52', '30.06.2026 15:48:52', '', '30.06.2026',
    '164.95', '164.95', '0.000000 EUR / EUR', 'DR', '', '', '', '',
    'POS 164.95 EUR www.a1.bg Sofia BGR 762720', '', ''];
  // A dropped-cell English fee row: operation-amount and rate cells omitted so
  // the DR mark lands at column 6 (exercises the same left-shift as the real file).
  const feeRow = ['1522532201EUR', '25.06.2026 21:38:30', '25.06.2026 21:38:34', 'ENG-FEE-1', '26.06.2026',
    '14.83', 'DR', '', '', '', '', 'Periodic fee'];

  const { rows } = parseBankExport(gridToHtmlXls([header, posRow, feeRow]));
  assert.equal(rows.length, 2);

  const pos = rows.find((r) => r.reference === null && r.originalAmount === 164.95);
  assert.ok(pos, 'POS row with empty reference should parse');
  assert.equal(pos!.reference, null); // empty reference allowed
  assert.equal(pos!.accountCurrency, 'EUR'); // second rate token resolves currency
  assert.equal(pos!.entryType, 'Debit');

  const fee = byRef(rows, 'ENG-FEE-1');
  assert.equal(fee.entryType, 'Debit'); // DR at the left-shifted column 6
  assert.equal(fee.originalAmount, 14.83);
  assert.equal(fee.operationAmount, null);
  assert.equal(fee.exchangeRateRaw, null);
});

test('parseBankExport: real .xlsx (OOXML) via SheetJS', () => {
  const header = [
    'Сметка', 'Дата/Час', 'Дата на плащане', 'Референция', 'Вальор',
    'Сума във валута на сметката', 'Сума във валута на операцията', 'Обменен курс',
    'Тип', 'IBAN Бенефициент', 'Бенефициент', 'IBAN Наредител', 'Наредител',
    'Описание на операцията', 'Основание за плащане', 'Още пояснения',
  ];
  const r1 = ['AC9EUR', '10.03.2026 08:00:00', '10.03.2026 08:01:00', 'RX1', '10.03.2026',
    '50.00', '50.00', '1.000000 EUR / EUR', 'ДТ', 'B', 'Вендор ЕООД', 'P', 'ФИРМА',
    'Операция с карта', 'Плащане', ''];
  // RX2 is a BGN-denominated row; BGN existed pre-2026, so it is dated 2025 to
  // exercise the pre-boundary 2nd-token BGN + peg path (post-2026 → EUR identity).
  const r2 = ['AC9BGN', '11.03.2025 08:00:00', '11.03.2025 08:01:00', 'RX2', '11.03.2025',
    '2030.00', '2030.00', '1.000000 BGN / BGN', 'КТ', 'B', 'Пейър', 'P', 'ФИРМА',
    'Депозит', '', ''];

  const ws = XLSX.utils.aoa_to_sheet([header, r1, r2]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;

  const { sourceFormat, rows } = parseBankExport(bytes);
  assert.equal(sourceFormat, 'xlsx');
  assert.equal(rows.length, 2);

  const eur = byRef(rows, 'RX1');
  assert.equal(eur.accountCurrency, 'EUR');
  assert.equal(eur.originalAmount, 50);
  assert.equal(eur.entryType, 'Debit');
  assert.equal(convertToEur(eur.accountCurrency!, eur.originalAmount).eurAmount, 50);

  const bgn = byRef(rows, 'RX2');
  assert.equal(bgn.accountCurrency, 'BGN');
  assert.equal(bgn.originalAmount, 2030);
  assert.equal(bgn.entryType, 'Credit');
  assert.equal(convertToEur(bgn.accountCurrency!, bgn.originalAmount).eurAmount, 1037.92);
});

// ---------------------------------------------------------------------------
// Euro-transition date-aware currency resolution (parseBankExport).
// Bulgaria adopted the euro 2026-01-01; BGN ceased to exist. Post-boundary rows
// never resolve BGN (EUR identity, no peg); pre-boundary rows keep BGN+peg.
// Boundary verified from data (last BGN row 2025-12-30; all 2026 rows EUR).
// ---------------------------------------------------------------------------
function boundaryHtml(): string {
  const H = ['Account','Date/Time','Process date','Reference','Value date','Amount','Op amount','Exchange rate','Type','Ben IBAN','Beneficiary','Payer IBAN','Payer','Op desc','Reason','More'];
  // rate-less rows: Type sits right after Amount (no op-amount/rate cells).
  const rateless = (acc: string, ref: string, vdate: string) =>
    `<tr><td>${acc}</td><td>${vdate} 10:00:00</td><td>${vdate}</td><td>${ref}</td><td>${vdate}</td><td>195.583</td><td>ДТ</td><td>BENIBAN</td><td>BEN</td><td>PAYIBAN</td><td>PAYER</td><td>op</td><td>reason</td><td>more</td></tr>`;
  const rated = (acc: string, ref: string, vdate: string, rate: string) =>
    `<tr><td>${acc}</td><td>${vdate} 10:00:00</td><td>${vdate}</td><td>${ref}</td><td>${vdate}</td><td>100.00</td><td>100.00</td><td>${rate}</td><td>ДТ</td><td>BENIBAN</td><td>BEN</td><td>PAYIBAN</td><td>PAYER</td><td>op</td><td>reason</td><td>more</td></tr>`;
  return '<html><body><table>' +
    `<tr>${H.map((h) => `<td>${h}</td>`).join('')}</tr>` +
    rateless('Main Assembly BGN', 'POST2026', '10.02.2026') +   // post-boundary, BGN suffix, rate-less
    rated('1522532201EUR', 'PRE2025', '15.06.2025', '1.000000 BGN / BGN') + // pre-boundary same-currency BGN
    rated('1522532201EUR', 'X2026', '10.03.2026', '0.5 BGN / EUR') +        // post-boundary cross-currency
    rateless('LegacyBGN', 'BOUNDARY', '01.01.2026') +           // exactly on the boundary
    '</table></body></html>';
}

test('currency date-aware: post-2026 BGN-suffix rate-less row -> EUR identity (not peg)', () => {
  const { rows } = parseBankExport(boundaryHtml());
  const r = byRef(rows, 'POST2026');
  assert.equal(r.accountCurrency, 'EUR');
  assert.equal(convertToEur(r.accountCurrency!, r.originalAmount).eurAmount, 195.58); // identity, NOT /1.95583
});

test('currency date-aware: pre-2026 same-currency BGN/BGN row -> BGN + peg (regression)', () => {
  const { rows } = parseBankExport(boundaryHtml());
  const r = byRef(rows, 'PRE2025');
  assert.equal(r.accountCurrency, 'BGN');
  assert.equal(convertToEur(r.accountCurrency!, r.originalAmount).eurAmount, 51.13); // 100 / 1.95583
});

test('currency date-aware: boundary date 2026-01-01 resolves EUR; post-boundary cross-currency stays EUR', () => {
  const { rows } = parseBankExport(boundaryHtml());
  assert.equal(byRef(rows, 'BOUNDARY').accountCurrency, 'EUR');
  assert.equal(byRef(rows, 'X2026').accountCurrency, 'EUR');
});
