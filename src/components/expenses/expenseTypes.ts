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
