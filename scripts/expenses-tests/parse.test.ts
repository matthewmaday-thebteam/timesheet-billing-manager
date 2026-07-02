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
  const r2 = ['AC9BGN', '11.03.2026 08:00:00', '11.03.2026 08:01:00', 'RX2', '11.03.2026',
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
