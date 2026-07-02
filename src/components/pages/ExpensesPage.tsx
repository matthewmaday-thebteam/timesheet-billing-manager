/**
 * ExpensesPage - system of record for bank-export expenses.
 *
 * Loads every expense once (useExpenses) and derives the entire
 * Year > Month > Category drill-down from that single array through the
 * cents-based tree builder (expenseTree.ts). Summary metrics, the needs-review
 * queue, and the accordion all read from the same computed source, so no two
 * surfaces can disagree.
 *
 * Lazy-loaded from App (keeps the SheetJS upload path out of the main bundle).
 *
 * @category Page
 */

import { useMemo, useState } from 'react';
import { useExpenses } from '../../hooks/useExpenses';
import { buildExpenseTree } from '../expenses/expenseTree';
import { ExpenseAccordion } from '../expenses/ExpenseAccordion';
import { ExpensesSummary } from '../expenses/ExpensesSummary';
import { ExpenseUploadModal } from '../expenses/ExpenseUploadModal';
import { ExpenseReviewQueue } from '../expenses/ExpenseReviewQueue';
import { Button } from '../Button';
import { Card } from '../Card';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';

export function ExpensesPage() {
  const { expenses, categories, loading, error, refetch } = useExpenses();
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Single computation path: the tree, the grand total, and the review subset
  // are all derived from the one `expenses` array.
  const tree = useMemo(() => buildExpenseTree(expenses, categories), [expenses, categories]);
  const needsReviewExpenses = useMemo(
    () => expenses.filter((expense) => expense.needs_review),
    [expenses],
  );

  const totalEur = tree.grandTotalCents / 100;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page header */}
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Expenses</h1>
          <p className="text-xs text-vercel-gray-400 mt-1">
            Bank-export expenses converted to EUR, categorized and bucketed by month.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setIsUploadOpen(true)}>
          Upload
        </Button>
      </section>

      {error && <Alert message={error} icon="error" variant="error" />}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-xs text-vercel-gray-400">Loading expenses...</span>
        </div>
      ) : (
        <>
          <ExpensesSummary
            totalEur={totalEur}
            expenseCount={tree.expenseCount}
            needsReviewCount={needsReviewExpenses.length}
          />

          {needsReviewExpenses.length > 0 && (
            <ExpenseReviewQueue
              expenses={needsReviewExpenses}
              categories={categories}
              onUpdated={refetch}
            />
          )}

          {tree.years.length === 0 ? (
            <Card padding="lg">
              <div className="text-center py-8">
                <p className="text-sm text-vercel-gray-400">
                  No expenses yet. Upload a bank export to get started.
                </p>
              </div>
            </Card>
          ) : (
            <ExpenseAccordion years={tree.years} />
          )}
        </>
      )}

      <ExpenseUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onIngested={() => {
          setIsUploadOpen(false);
          refetch();
        }}
      />
    </div>
  );
}

export default ExpensesPage;
