export interface ExpenseCategoryRecord {
  id: number;
  name: string;
  overhead_type: 'Fixed' | 'Variable' | null;
  sort_order: number;
  is_fallback: boolean;
}

export interface ExpenseRecord {
  id: string;
  account_currency: 'EUR' | 'BGN';
  original_amount: number;
  operation_currency: string | null;
  operation_amount: number | null;
  eur_amount: number;
  conversion_rate: number;
  rate_source: string;
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
  assigned_month: string;
  needs_review: boolean;
}
