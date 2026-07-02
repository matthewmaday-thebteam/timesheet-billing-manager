export interface ExpenseCategoryRecord {
  id: number;
  name: string;
  overhead_type: 'Fixed' | 'Variable' | null;
  sort_order: number;
  is_fallback: boolean;
}

export interface ExpenseRecord {
  id: string;
  /** Bank account label the transaction posted to (nullable in source data). */
  account: string | null;
  /** Idempotency fingerprint of the source bank row (unique, disambiguating). */
  row_hash: string;
  account_currency: 'EUR' | 'BGN';
  original_amount: number;
  operation_currency: string | null;
  operation_amount: number | null;
  eur_amount: number;
  conversion_rate: number;
  rate_source: string;
  /** Date the EUR conversion rate was taken from (null for identity/peg). */
  rate_date: string | null;
  /**
   * USD REPORTING layer (additive over EUR). usd_amount is null when the row's
   * month rate was not yet known at ingest (pending); it is completed later by
   * the self-healing fill. usd_rate is USD per 1 EUR; usd_rate_source records its
   * provenance (workbook_seed | ecb_monthly | ecb_daily_avg | manual).
   */
  usd_amount: number | null;
  usd_rate: number | null;
  usd_rate_source: string | null;
  entry_type: 'Debit' | 'Credit' | null;
  description_original: string | null;
  description_translated: string | null;
  translation_source: string | null;
  vendor: string | null;
  beneficiary: string | null;
  reference: string | null;
  category_id: number;
  category_source: string | null;
  value_date: string;
  /** Bank booking date, distinct from value_date (nullable in source data). */
  booking_date: string | null;
  /** Full transaction timestamp when the bank provided one (nullable). */
  txn_datetime: string | null;
  assigned_month: string;
  needs_review: boolean;
  /**
   * Human-readable name of the source export file. Derived (flattened) from the
   * embedded `expense_source_files` row in useExpenses — not a column on the
   * `expenses` table itself — so the details view can show a file name instead
   * of the opaque source_file_id UUID.
   */
  source_file_name: string | null;
}
