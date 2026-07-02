// =============================================================================
// parseBankExport — File/ArrayBuffer -> { sourceFormat, rows: RawBankRow[] }.
// =============================================================================
// Pure: no network, no Supabase. Handles all three container formats:
//   - html_xls   : UniCredit Bulbank HTML <table> misnamed .xls (own parser)
//   - binary_xls : legacy BIFF .xls  (SheetJS)
//   - xlsx       : OOXML             (SheetJS)
//
// All formats are reduced to a 2-D array of string cells and mapped with a
// single ТИП-anchored column mapper, because the HTML export DROPS empty cells
// (a fee row can be missing the operation-amount and exchange-rate cells
// entirely), which makes fixed positional mapping unsafe. The mapper anchors on
// the ДТ/КТ ("Тип") cell — the leading columns are fixed, the two optional
// amount/rate cells sit between the account amount and Тип, and the trailing
// beneficiary/payer/description columns are at fixed offsets AFTER Тип.
//
// Account currency is resolved from the FIRST token of the exchange-rate string
// ("<rate> <accountCur> / <operationCur>") — the authoritative signal — with a
// per-file account→currency map for rate-less rows, and the account-number
// suffix (…EUR / …BGN) as a last-resort fallback. See REVIEWERS note below.
// =============================================================================

import * as XLSX from 'xlsx';
import { sniffFormat, type SourceFormat } from './sniffFormat.ts';
import type { AccountCurrency, EntryType, RawBankRow } from '../expenses/types.ts';

export interface ParseResult {
  sourceFormat: SourceFormat;
  rows: RawBankRow[];
}

// ---------------------------------------------------------------------------
// Cell value helpers
// ---------------------------------------------------------------------------

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${pad(value.getUTCDate())}.${pad(value.getUTCMonth() + 1)}.${value.getUTCFullYear()} ` +
      `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
    );
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Parse a bank amount handling space thousands separators and comma decimals. */
export function parseAmount(raw: unknown): number {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if (!s) return NaN;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Strip everything except digits, separators and a leading sign.
  s = s.replace(/[\s ]/g, '').replace(/[^0-9.,-]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/-/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decPos = Math.max(lastDot, lastComma);
    const intPart = s.slice(0, decPos).replace(/[.,]/g, '');
    const fracPart = s.slice(decPos + 1).replace(/[.,]/g, '');
    s = `${intPart}.${fracPart}`;
  } else if (lastComma >= 0) {
    s = s.replace(/,/g, '.');
  }

  const n = Number(s);
  if (Number.isNaN(n)) return NaN;
  return negative ? -n : n;
}

function parseDateParts(raw: unknown): { date: string | null; time: string | null } {
  const s = cellToString(raw);
  if (!s) return { date: null, time: null };

  // dd.mm.yyyy [hh:mm[:ss]]  (also tolerates / and - day-first separators)
  const dmy = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const [, dd, mm, yyyy, hh, mi, ss] = dmy;
    const date = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    const time =
      hh !== undefined ? `${hh.padStart(2, '0')}:${mi.padStart(2, '0')}:${(ss ?? '00').padStart(2, '0')}` : null;
    return { date, time };
  }

  // yyyy-mm-dd[Thh:mm[:ss]]
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, yyyy, mm, dd, hh, mi, ss] = iso;
    const date = `${yyyy}-${mm}-${dd}`;
    const time =
      hh !== undefined ? `${hh.padStart(2, '0')}:${mi.padStart(2, '0')}:${(ss ?? '00').padStart(2, '0')}` : null;
    return { date, time };
  }

  return { date: null, time: null };
}

function parseDateOnly(raw: unknown): string | null {
  return parseDateParts(raw).date;
}

function parseDatetimeIso(raw: unknown): string | null {
  const { date, time } = parseDateParts(raw);
  if (!date) return null;
  return time ? `${date}T${time}` : null;
}

/**
 * Parse "<rate> <OPERATION_CUR> / <ACCOUNT_CUR>" (e.g. "0.510638 BGN / EUR").
 * The bank prints the OPERATION currency first and the ACCOUNT currency second.
 * Ground-truthed against report(3)_processed.xlsx: ref 287BATM2536400U0
 * "0.510638 BGN / EUR" → account_currency EUR (identity); the same account
 * number books rows in both EUR and BGN, so the account is per-row, from the
 * SECOND token — never the first token and never the account-number suffix
 * (except as a rate-less-row fallback).
 */
function parseExchangeRate(raw: string): { accountCur: string | null; operationCur: string | null } {
  const m = raw.match(/[\d.,]+\s+([A-Za-zА-Яа-я]{3})\s*\/\s*([A-Za-zА-Яа-я]{3})/);
  if (!m) return { accountCur: null, operationCur: null };
  return { operationCur: m[1].toUpperCase(), accountCur: m[2].toUpperCase() };
}

function suffixCurrency(account: string): AccountCurrency | null {
  const m = account.trim().match(/(EUR|BGN)\s*$/i);
  if (!m) return null;
  return m[1].toUpperCase() as AccountCurrency;
}

// ---------------------------------------------------------------------------
// HTML <table> extraction
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, '&');
}

function htmlToRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cell = cellRe.exec(tr[1])) !== null) {
      const text = decodeEntities(cell[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function workbookToRows(input: ArrayBuffer | Uint8Array): string[][] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  return aoa.map((row) => row.map(cellToString));
}

// ---------------------------------------------------------------------------
// Header detection + ТИП-anchored row mapping
// ---------------------------------------------------------------------------

// Header marker PAIRS, one per UI language. A row is a header only when BOTH
// markers of the SAME pair are present, so a mixed row (e.g. a description
// containing "account") cannot false-match across languages.
//   - Cyrillic UI: "Сметка" (account) + "Вальор" (value date)
//   - English  UI: "Account"          + "Value date"
const HEADER_MARKER_SETS: readonly (readonly [string, string])[] = [
  ['сметка', 'вальор'],
  ['account', 'value date'],
];

// Entry-type ("Тип"/"Type") anchor marks, keyed by direction. UniCredit prints
// Cyrillic ДТ/КТ from the Bulgarian UI and Latin DR/CR from the English UI.
// Matching is EXACT equality on the trimmed cell, so these bare tokens cannot be
// confused with descriptions (verified: the real export never carries a bare
// 'DR'/'CR'/'ДТ'/'КТ' cell outside the Type column).
const DEBIT_MARKS = new Set(['ДТ', 'DR']);
const CREDIT_MARKS = new Set(['КТ', 'CR']);

function findHeaderIndex(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const lowered = rows[i].map((c) => c.toLowerCase());
    for (const markers of HEADER_MARKER_SETS) {
      if (markers.every((marker) => lowered.some((c) => c.includes(marker)))) {
        return i;
      }
    }
  }
  return -1;
}

interface MappedRow {
  account: string;
  txnDatetime: string | null;
  bookingDate: string | null;
  reference: string;
  valueDate: string | null;
  originalAmount: number;
  operationAmount: number | null;
  exchangeRateRaw: string | null;
  entryType: EntryType | null;
  beneficiary: string;
  payer: string;
  paymentReason: string;
  operationDescription: string;
  descriptionOriginal: string;
  rateAccountCur: AccountCurrency | null;
  operationCurrency: string | null;
}

function mapRow(cells: string[]): MappedRow | null {
  // Anchor on the ДТ/КТ cell. Scan from index 5 (after the fixed leading
  // columns: account, datetime, booking, reference, value date, account amount)
  // so a description containing "ДТ" cannot be mistaken for the Тип column.
  let t = -1;
  for (let k = 5; k < cells.length; k++) {
    const v = cells[k].trim();
    if (DEBIT_MARKS.has(v) || CREDIT_MARKS.has(v)) {
      t = k;
      break;
    }
  }
  if (t < 6) return null; // no recognizable Тип anchor → not a transaction row

  const account = cells[0]?.trim() ?? '';
  const txnDatetime = parseDatetimeIso(cells[1]);
  const bookingDate = parseDateOnly(cells[2]);
  const reference = (cells[3] ?? '').trim();
  const valueDate = parseDateOnly(cells[4]);
  const originalAmount = parseAmount(cells[5]);

  // Between the account amount (index 5) and Тип sit 0, 1, or 2 optional cells:
  // operation amount and exchange rate. Disambiguate a lone cell by "/" content.
  let operationAmount: number | null = null;
  let exchangeRateRaw: string | null = null;
  const gap = t - 6;
  if (gap === 1) {
    const only = (cells[6] ?? '').trim();
    if (only.includes('/')) exchangeRateRaw = only;
    else operationAmount = parseAmount(only);
  } else if (gap >= 2) {
    operationAmount = parseAmount(cells[6]);
    exchangeRateRaw = (cells[7] ?? '').trim() || null;
  }

  const entryType: EntryType = DEBIT_MARKS.has(cells[t].trim()) ? 'Debit' : 'Credit';

  // After Тип: [IBAN benef][benef][IBAN payer][payer]
  //            [Описание на операцията][Основание за плащане][Още пояснения]
  const beneficiary = (cells[t + 2] ?? '').trim();
  const payer = (cells[t + 4] ?? '').trim();
  const operationDescription = (cells[t + 5] ?? '').trim(); // Описание на операцията
  const paymentReason = (cells[t + 6] ?? '').trim(); // Основание за плащане
  const moreNotes = (cells[t + 7] ?? '').trim(); // Още пояснения
  // Stored description: Основание + Описание + Още пояснения (matches the
  // reference file's description_original convention; the translation key uses
  // only Основание + Описание — see the edge function).
  const descriptionOriginal = [paymentReason, operationDescription, moreNotes]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  let rateAccountCur: AccountCurrency | null = null;
  let operationCurrency: string | null = null;
  if (exchangeRateRaw) {
    const { accountCur, operationCur } = parseExchangeRate(exchangeRateRaw);
    if (accountCur === 'EUR' || accountCur === 'BGN') rateAccountCur = accountCur;
    operationCurrency = operationCur;
  }

  return {
    account,
    txnDatetime,
    bookingDate,
    reference,
    valueDate,
    originalAmount,
    operationAmount: operationAmount != null && Number.isNaN(operationAmount) ? null : operationAmount,
    exchangeRateRaw,
    entryType,
    beneficiary,
    payer,
    paymentReason,
    operationDescription,
    descriptionOriginal,
    rateAccountCur,
    operationCurrency,
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Parse an already-loaded bank export.
 * @param input Raw bytes (ArrayBuffer/Uint8Array) or a decoded HTML string.
 */
export function parseBankExport(input: ArrayBuffer | Uint8Array | string): ParseResult {
  const sourceFormat = sniffFormat(input);

  let grid: string[][];
  if (sourceFormat === 'html_xls') {
    const html = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
    grid = htmlToRows(html);
  } else {
    // string can only be html_xls; narrow to bytes here.
    grid = workbookToRows(input as ArrayBuffer | Uint8Array);
  }

  const headerIdx = findHeaderIndex(grid);
  const dataRows = headerIdx >= 0 ? grid.slice(headerIdx + 1) : grid;

  const mapped: MappedRow[] = [];
  for (const cells of dataRows) {
    const row = mapRow(cells);
    if (row && row.valueDate) mapped.push(row);
  }

  // Account currency is resolved PER ROW: the exchange-rate second token when a
  // rate is present, else the account-number suffix (…EUR / …BGN) for rate-less
  // same-currency rows. There is deliberately NO per-file account→currency map:
  // the same account number is proven to book in BOTH currencies, so any such
  // map propagates wrong currencies onto rate-less rows.
  const rows: RawBankRow[] = mapped.map((row) => {
    const accountCurrency: AccountCurrency | null = row.rateAccountCur ?? suffixCurrency(row.account);
    return {
      account: row.account,
      accountCurrency,
      operationCurrency: row.operationCurrency,
      originalAmount: Number.isNaN(row.originalAmount) ? 0 : row.originalAmount,
      operationAmount: row.operationAmount,
      exchangeRateRaw: row.exchangeRateRaw,
      entryType: row.entryType,
      reference: row.reference || null,
      beneficiary: row.beneficiary || null,
      payer: row.payer || null,
      paymentReason: row.paymentReason || null,
      operationDescription: row.operationDescription || null,
      descriptionOriginal: row.descriptionOriginal,
      valueDate: row.valueDate as string,
      bookingDate: row.bookingDate,
      txnDatetime: row.txnDatetime,
    };
  });

  return { sourceFormat, rows };
}

/**
 * Convenience wrapper for a browser File (structurally typed to avoid a DOM lib
 * dependency). Reads the file into an ArrayBuffer then delegates.
 */
export async function parseBankExportFromFile(file: {
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  return parseBankExport(buffer);
}
