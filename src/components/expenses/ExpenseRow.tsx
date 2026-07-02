/**
 * ExpenseRow - a single expense line inside a category group.
 *
 * A system-of-record row: it always keeps the numbers visible. Non-EUR rows
 * show the original account-currency amount alongside the converted EUR value
 * (e.g. "195.58 BGN → €100.00"); EUR-native rows show just the EUR amount. The
 * displayed EUR value is derived through the same `toCents` path used by the
 * accordion totals, so a row can never disagree with its parent to the cent.
 *
 * @category Expenses (page-local)
 */

import { Badge } from '../Badge';
import type { ExpenseRecord } from './expenseTypes';
import { formatEurCents, formatOriginalAmount, toCents } from './expenseTree';

interface ExpenseRowProps {
  expense: ExpenseRecord;
}

/** Best available human-readable label for a transaction. */
function describe(expense: ExpenseRecord): string {
  return (
    expense.description_translated ||
    expense.description_original ||
    expense.vendor ||
    expense.beneficiary ||
    expense.reference ||
    'Unlabeled transaction'
  );
}

export function ExpenseRow({ expense }: ExpenseRowProps) {
  const eur = formatEurCents(toCents(expense.eur_amount));
  const isEurNative = expense.account_currency === 'EUR';

  return (
    <div className="flex items-start justify-between gap-4 py-2.5 px-4 hover:bg-vercel-gray-50 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-vercel-gray-600 truncate">{describe(expense)}</span>
        {expense.needs_review && (
          <Badge variant="warning" size="sm">Needs review</Badge>
        )}
      </div>

      <div className="flex-shrink-0 text-right">
        <div className="text-sm font-mono text-vercel-gray-600">
          {isEurNative
            ? eur
            : `${formatOriginalAmount(expense.original_amount, expense.account_currency)} → ${eur}`}
        </div>
        <div className="text-xs font-mono text-vercel-gray-400 mt-0.5">
          {expense.value_date}
        </div>
      </div>
    </div>
  );
}

export default ExpenseRow;
