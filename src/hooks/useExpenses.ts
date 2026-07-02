/**
 * useExpenses - Expenses data hook
 *
 * Fetches all rows from `expenses` (ordered by value_date desc, paginated past
 * the 1000-row PostgREST cap via fetchAllRows) and the `expense_categories`
 * lookup. PostgREST returns numeric/decimal columns as strings, so the monetary
 * and id fields are coerced to numbers here — the UI math (integer-cents totals)
 * can then trust them.
 *
 * @category Expenses
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAllRows';
import type { ExpenseCategoryRecord, ExpenseRecord } from '../components/expenses/expenseTypes';

export interface UseExpensesResult {
  expenses: ExpenseRecord[];
  categories: ExpenseCategoryRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawRow = Record<string, any>;

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a raw expenses row into a typed record with numeric money fields. */
function normalizeExpense(raw: RawRow): ExpenseRecord {
  return {
    ...(raw as ExpenseRecord),
    original_amount: toNumber(raw.original_amount),
    operation_amount: toNumberOrNull(raw.operation_amount),
    eur_amount: toNumber(raw.eur_amount),
    conversion_rate: toNumber(raw.conversion_rate),
    // USD reporting layer: null preserved as null (pending), so the tree can
    // exclude pending rows from USD totals rather than treating them as $0.
    usd_amount: toNumberOrNull(raw.usd_amount),
    usd_rate: toNumberOrNull(raw.usd_rate),
    category_id: toNumber(raw.category_id),
    needs_review: Boolean(raw.needs_review),
  };
}

/** Coerce a raw expense_categories row into a typed record. */
function normalizeCategory(raw: RawRow): ExpenseCategoryRecord {
  return {
    id: toNumber(raw.id),
    name: raw.name,
    overhead_type: raw.overhead_type ?? null,
    sort_order: toNumber(raw.sort_order),
    is_fallback: Boolean(raw.is_fallback),
  };
}

export function useExpenses(): UseExpensesResult {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // initialLoad controls the full-page spinner. Silent refetches (after an
  // upload / review edit) update data without flashing the loading state.
  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);

    try {
      const [expensesResult, categoriesResult] = await Promise.all([
        fetchAllRows<RawRow>(
          supabase
            .from('expenses')
            .select('*')
            .order('value_date', { ascending: false }),
        ),
        supabase
          .from('expense_categories')
          .select('*')
          .order('sort_order', { ascending: true }),
      ]);

      if (expensesResult.error) throw new Error(expensesResult.error.message);
      if (categoriesResult.error) throw categoriesResult.error;

      setExpenses((expensesResult.data ?? []).map(normalizeExpense));
      setCategories(((categoriesResult.data as RawRow[]) ?? []).map(normalizeCategory));
    } catch (err) {
      console.error('Error fetching expenses:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch expenses');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  const refetch = useCallback(() => {
    void fetchData(false);
  }, [fetchData]);

  return { expenses, categories, loading, error, refetch };
}

export default useExpenses;
