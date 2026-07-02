// =============================================================================
// Expenses domain — shared pure types
// =============================================================================
// Framework-free. Shared BY COPY with the ingest-expenses edge function
// (supabase/functions/ingest-expenses/_lib). Keep the two copies byte-identical.
// Nothing here imports React, Supabase, or any runtime — safe in browser, Deno,
// and Node.
// =============================================================================

/** Account currencies the bank books in. */
export type AccountCurrency = 'EUR' | 'BGN';

/** Debit (money out) / Credit (money in). Mapped from ДТ / КТ. */
export type EntryType = 'Debit' | 'Credit';

/** Where the EUR conversion rate came from (matches expenses.rate_source enum). */
export type RateSource = 'identity' | 'peg' | 'ecb_monthly' | 'ecb_daily' | 'manual';

/**
 * Where a monthly EUR→USD REPORTING rate came from (matches
 * expense_fx_rates.source, and expenses.usd_rate_source). 'workbook_seed' = mined
 * from the historical books (precedent-authority for its month); 'ecb_monthly' /
 * 'ecb_daily_avg' = fetched at ingest via the documented ECB convention.
 */
export type FxRateSource = 'workbook_seed' | 'ecb_monthly' | 'ecb_daily_avg' | 'manual';

/** How a description was translated (matches expenses.translation_source enum). */
export type TranslationSource = 'dictionary' | 'passthrough' | 'manual' | 'ai' | 'none';

/** How a category was assigned (matches expenses.category_source enum). */
export type CategorySource = 'vendor_rule' | 'keyword_rule' | 'manual' | 'fallback';

/**
 * Normalized raw-column extraction of a single bank-export transaction row.
 * Produced by parseBankExport; consumed as the POST body of ingest-expenses.
 * Dates are ISO strings; amounts are numbers (comma decimals already resolved).
 */
export interface RawBankRow {
  /** Raw account identifier (e.g. "1522532201EUR"). */
  account: string;
  /** Resolved account currency, or null when it could not be determined. */
  accountCurrency: AccountCurrency | null;
  /** Currency of the operation amount (informational; may be USD etc.). */
  operationCurrency: string | null;
  /** Amount in the ACCOUNT currency ("Сума във валута на сметката"). */
  originalAmount: number;
  /** Amount in the operation currency ("Сума във валута на операцията"). */
  operationAmount: number | null;
  /** Raw exchange-rate string as printed (e.g. "1.000000 BGN / BGN"). */
  exchangeRateRaw: string | null;
  /** Debit/Credit mapped from ДТ/КТ, or null if unmapped. */
  entryType: EntryType | null;
  /** Bank reference ("Референция"). */
  reference: string | null;
  /** Beneficiary ("Бенефициент"). */
  beneficiary: string | null;
  /** Payer / originator ("Наредител"). */
  payer: string | null;
  /** "Основание за плащане" (payment reason) — first half of the dictionary key. */
  paymentReason: string | null;
  /** "Описание на операцията" (operation description) — second half of the key. */
  operationDescription: string | null;
  /**
   * Full stored description: Основание + Описание + Още пояснения (audit
   * completeness). NOTE: dictionary/AI translation keys off `paymentReason` +
   * ' ' + `operationDescription` only (see the edge function), NOT this field.
   */
  descriptionOriginal: string;
  /** Value date ("Вальор") as 'YYYY-MM-DD'. Drives month bucketing. */
  valueDate: string;
  /** Booking / payment date ("Дата на плащане") as 'YYYY-MM-DD', or null. */
  bookingDate: string | null;
  /** Transaction datetime to seconds ISO-8601 (e.g. '2025-12-30T15:10:53'), or null. */
  txnDatetime: string | null;
}

/** Vendor categorization rule (from expense_vendor_rules). */
export interface VendorRule {
  match_type: 'exact' | 'contains';
  pattern: string;
  category_id: number;
  priority: number;
}

/** Keyword categorization rule (from expense_keyword_rules). */
export interface KeywordRule {
  keyword: string;
  category_id: number;
  priority: number;
  /**
   * When true, a match forces needs_review even though a category was assigned
   * (e.g. UNICREDIT BULBANK keyword rules that need a human eye). Optional so
   * older rule shapes default to false.
   */
  force_review?: boolean;
}

/** Result of the EUR conversion (locked business rules). */
export interface EurConversion {
  eurAmount: number;
  conversionRate: number;
  rateSource: RateSource;
  rateDate: string | null;
}

/**
 * Result of the USD REPORTING-layer conversion (see convertToUsd). Additive over
 * the EUR normalization layer — usdAmount is derived from the already-normalized
 * eur_amount and a MONTH-DEPENDENT EUR→USD rate; it never re-reads bank amounts.
 */
export interface UsdConversion {
  usdAmount: number;
  usdRate: number;
}

/**
 * A monthly EUR→USD reporting rate (one row of expense_fx_rates). `month` is the
 * 'YYYY-MM' bucket; `eurUsd` is USD per 1 EUR (ECB SP00 convention).
 */
export interface FxRate {
  month: string;
  eurUsd: number;
  source: FxRateSource;
}

/** Result of categorization. */
export interface CategorizeResult {
  categoryId: number;
  categorySource: CategorySource;
  needsReview: boolean;
}

/** Result of translation. */
export interface TranslateResult {
  translated: string | null;
  translationSource: TranslationSource;
  needsReview: boolean;
}

/** Fallback category id — "15 Miscellaneous". */
export const FALLBACK_CATEGORY_ID = 15;

/** Bulgarian lev fixed peg to the euro (1 EUR = 1.95583 BGN). */
export const BGN_EUR_PEG = 1.95583;
