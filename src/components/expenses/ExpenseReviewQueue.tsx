/**
 * ExpenseReviewQueue — admin review table for expenses flagged needs_review.
 *
 * Each row lets an admin correct the category and/or the English translation and
 * clear the review flag. Writes go straight to the `expenses` table; RLS makes
 * them admin-only, so permission failures are surfaced as a friendly Alert.
 *
 * Provenance rules (per contract):
 *   - category_source becomes 'manual' ONLY when the category actually changed.
 *   - translation_source becomes 'manual' ONLY when the text was actually edited.
 *   - needs_review is always cleared on save (the operator has reviewed the row).
 *
 * Design-system compliant: existing table markup (label-form headers, body-sm
 * cells), Select / Input / Button / Badge / Alert / Spinner atoms, tokens only.
 */

import { useCallback, useMemo, useState } from 'react';
import { Button } from '../Button';
import { Select, type SelectOption } from '../Select';
import { Input } from '../Input';
import { Badge } from '../Badge';
import { Alert } from '../Alert';
import { ExpenseDetailsModal } from './ExpenseDetailsModal';
import { supabase } from '../../lib/supabase';
import type { ExpenseCategoryRecord, ExpenseRecord } from './expenseTypes';

interface ExpenseReviewQueueProps {
  expenses: ExpenseRecord[];
  categories: ExpenseCategoryRecord[];
  /** Fired after a successful per-row save so the page can refetch. */
  onUpdated: () => void;
}

const LABEL_FORM = 'px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider';

/** Currency formatter cache — one Intl instance per currency code. */
const currencyFormatters = new Map<string, Intl.NumberFormat>();
function formatCurrency(amount: number, currency: string): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

export function ExpenseReviewQueue({ expenses, categories, onUpdated }: ExpenseReviewQueueProps) {
  // Self-contained: only ever render rows that still need review, regardless of
  // whether the parent pre-filtered.
  const reviewRows = useMemo(() => expenses.filter((row) => row.needs_review), [expenses]);

  const categoryOptions = useMemo<SelectOption[]>(
    () =>
      [...categories]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((category) => ({ value: String(category.id), label: category.name })),
    [categories],
  );

  if (reviewRows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <svg
            className="mx-auto h-12 w-12 text-vercel-gray-100"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
          </svg>
          <p className="mt-4 text-sm text-vercel-gray-400">Nothing needs review</p>
          <p className="mt-1 text-xs text-vercel-gray-400">
            Every expense has a confirmed category and translation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-vercel-gray-50 border-b border-vercel-gray-100">
              <th className={LABEL_FORM}>Date</th>
              <th className={LABEL_FORM}>Description</th>
              <th className={`${LABEL_FORM} text-right`}>Original</th>
              <th className={`${LABEL_FORM} text-right`}>EUR</th>
              <th className={LABEL_FORM}>Category</th>
              <th className={LABEL_FORM}>Translation</th>
              <th className={`${LABEL_FORM} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {reviewRows.map((row) => (
              <ExpenseReviewRow
                key={row.id}
                row={row}
                categoryOptions={categoryOptions}
                onUpdated={onUpdated}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ExpenseReviewRowProps {
  row: ExpenseRecord;
  categoryOptions: SelectOption[];
  onUpdated: () => void;
}

function ExpenseReviewRow({ row, categoryOptions, onUpdated }: ExpenseReviewRowProps) {
  const originalTranslation = row.description_translated ?? '';
  const [categoryValue, setCategoryValue] = useState(String(row.category_id));
  const [translation, setTranslation] = useState(originalTranslation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isUntranslated = originalTranslation.trim().length === 0;
  const categoryChanged = categoryValue !== String(row.category_id);
  const translationChanged = translation.trim() !== originalTranslation.trim();

  // Read-only details view shows the STORED category (row.category_id), never the
  // possibly-unsaved Select draft.
  const storedCategoryName =
    categoryOptions.find((option) => option.value === String(row.category_id))?.label ??
    `Category ${row.category_id}`;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    // Build the patch from only what changed; needs_review always clears.
    const patch: Record<string, unknown> = { needs_review: false };
    if (categoryChanged) {
      patch.category_id = Number(categoryValue);
      patch.category_source = 'manual';
    }
    if (translationChanged) {
      patch.description_translated = translation.trim();
      patch.translation_source = 'manual';
    }

    const { data, error: updateError } = await supabase
      .from('expenses')
      .update(patch)
      .eq('id', row.id)
      .select('id');

    setSaving(false);

    if (updateError) {
      const denied = updateError.code === '42501';
      setError(
        denied
          ? 'You need admin access to edit expenses.'
          : 'Could not save this row. Please try again.',
      );
      return;
    }
    if (!data || data.length === 0) {
      // RLS blocked the write silently (no matching updatable row).
      setError('You need admin access to edit expenses.');
      return;
    }

    onUpdated();
  }, [categoryChanged, translationChanged, categoryValue, translation, row.id, onUpdated]);

  return (
    <>
      <tr className="hover:bg-vercel-gray-50 transition-colors duration-200 ease-out align-top">
        <td className="px-4 py-3">
          <span className="text-sm text-vercel-gray-400 whitespace-nowrap">{row.value_date}</span>
        </td>

        <td className="px-4 py-3">
          <div className="flex items-start gap-2 max-w-sm">
            <span className="text-sm text-vercel-gray-600 whitespace-normal break-words min-w-0">
              {isUntranslated ? row.description_original || '—' : originalTranslation}
            </span>
            {isUntranslated && (
              <Badge variant="warning" size="sm" className="whitespace-nowrap">
                untranslated
              </Badge>
            )}
          </div>
        </td>

        <td className="px-4 py-3 text-right">
          <span className="text-sm font-mono text-vercel-gray-600 whitespace-nowrap">
            {formatCurrency(row.original_amount, row.account_currency)}
          </span>
        </td>

        <td className="px-4 py-3 text-right">
          <span className="text-sm font-mono text-vercel-gray-600 whitespace-nowrap">
            {formatCurrency(row.eur_amount, 'EUR')}
          </span>
        </td>

        <td className="px-4 py-3">
          <Select
            value={categoryValue}
            onChange={setCategoryValue}
            options={categoryOptions}
            disabled={saving}
            className="min-w-40"
          />
        </td>

        <td className="px-4 py-3 max-w-xs">
          <Input
            value={translation}
            onChange={(event) => setTranslation(event.target.value)}
            placeholder="English translation"
            size="sm"
            disabled={saving}
          />
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDetailsOpen(true)}
              disabled={saving}
            >
              Details
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </td>
      </tr>

      {detailsOpen && (
        <tr>
          {/* The Modal is a fixed-position overlay, so its DOM location is
              irrelevant; wrapping it in a row (like the error row) keeps the
              table markup valid. */}
          <td colSpan={7}>
            <ExpenseDetailsModal
              expense={row}
              categoryName={storedCategoryName}
              isOpen={detailsOpen}
              onClose={() => setDetailsOpen(false)}
            />
          </td>
        </tr>
      )}

      {error && (
        <tr>
          <td colSpan={7} className="px-4 pb-3">
            <Alert message={error} icon="error" variant="error" onClose={() => setError(null)} />
          </td>
        </tr>
      )}
    </>
  );
}

export default ExpenseReviewQueue;
