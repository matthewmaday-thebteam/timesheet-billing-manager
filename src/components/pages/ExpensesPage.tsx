/**
 * ExpensesPage - system of record for bank-export expenses.
 *
 * Loads every expense once (useExpenses) and derives the entire
 * Year > Month > Category drill-down from that single array through the
 * cents-based tree builder (expenseTree.ts). Summary metrics, the needs-review
 * queue, and the accordion all read from the same computed source, so no two
 * surfaces can disagree.
 *
 * Credits (entry_type === 'Credit') are receivables, not expenses. They are
 * already excluded from the accordion/totals; here we derive a SINGLE
 * non-credit array and feed it to BOTH the needs-review queue and the summary's
 * review count, so credits never surface as expense work anywhere on the page.
 *
 * Lazy-loaded from App (keeps the SheetJS upload path out of the main bundle).
 *
 * @category Page
 */

import { useCallback, useMemo, useState } from 'react';
import { useExpenses } from '../../hooks/useExpenses';
import { supabase } from '../../lib/supabase';
import { buildExpenseTree } from '../expenses/expenseTree';
import { ExpenseAccordion } from '../expenses/ExpenseAccordion';
import { ExpensesSummary } from '../expenses/ExpensesSummary';
import { ExpenseUploadModal } from '../expenses/ExpenseUploadModal';
import { ExpenseReviewQueue } from '../expenses/ExpenseReviewQueue';
import { Button } from '../Button';
import { Card } from '../Card';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';

/** Result shape of the translate-expense-descriptions backlog processor. */
interface TranslateBacklogResult {
  status: string;
  translated_keys: number;
  updated_rows: number;
  /** Unique untranslated keys still remaining after this invocation. */
  remaining: number;
}

/** Safety cap on backlog re-invocations, in case `remaining` never converges. */
const MAX_TRANSLATE_ITERATIONS = 30;

export function ExpensesPage() {
  const { expenses, categories, loading, error, refetch } = useExpenses();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateSummary, setTranslateSummary] = useState<string | null>(null);

  // Single computation path: the tree, the grand total, and the review subset
  // are all derived from the one `expenses` array.
  const tree = useMemo(() => buildExpenseTree(expenses, categories), [expenses, categories]);

  // Credits are receivables, not expenses — exclude them from every review
  // surface. This ONE filtered array is the single basis for both the review
  // queue and the summary's needs-review count.
  const nonCreditExpenses = useMemo(
    () => expenses.filter((expense) => expense.entry_type !== 'Credit'),
    [expenses],
  );
  const needsReviewExpenses = useMemo(
    () => nonCreditExpenses.filter((expense) => expense.needs_review),
    [nonCreditExpenses],
  );

  // Untranslated backlog = non-credit rows still at translation_source 'none'
  // (by construction only Cyrillic dictionary-misses land there). Same basis as
  // the review queue, so credits are never counted or AI-translated.
  const pendingTranslationCount = useMemo(
    () => nonCreditExpenses.filter((expense) => expense.translation_source === 'none').length,
    [nonCreditExpenses],
  );

  const totalEur = tree.grandTotalCents / 100;

  const handleTranslatePending = useCallback(async () => {
    setIsTranslating(true);
    setTranslateError(null);
    setTranslateSummary(null);

    let totalUpdated = 0;
    try {
      for (let iteration = 0; iteration < MAX_TRANSLATE_ITERATIONS; iteration++) {
        const { data, error: invokeError } = await supabase.functions.invoke<TranslateBacklogResult>(
          'translate-expense-descriptions',
          { body: {} },
        );

        if (invokeError) {
          const context = (invokeError as { context?: Response }).context;
          const status = context?.status;
          setTranslateError(
            status === 403
              ? 'You need admin access to translate expenses.'
              : status === 401
                ? 'Your session has expired. Please sign in again and retry.'
                : 'Translation could not be completed. Please try again.',
          );
          return;
        }
        if (!data) {
          setTranslateError('Translation returned no result. Please refresh and verify.');
          return;
        }

        totalUpdated += data.updated_rows;
        // Stop when the backlog is drained, or when a round makes no progress
        // (e.g. a persistent rate limit) — never loop forever.
        if (data.remaining <= 0 || data.translated_keys <= 0) break;
      }
      setTranslateSummary(
        `Translated ${totalUpdated.toLocaleString('en-US')} description${totalUpdated === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      console.error('ExpensesPage: translate backlog failed', err);
      setTranslateError('Translation could not be completed. Please try again.');
    } finally {
      setIsTranslating(false);
      refetch();
    }
  }, [refetch]);

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

          {(pendingTranslationCount > 0 || translateError || translateSummary) && (
            <section className="flex items-center gap-3">
              {pendingTranslationCount > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleTranslatePending}
                  disabled={isTranslating}
                >
                  Translate pending ({pendingTranslationCount.toLocaleString('en-US')})
                </Button>
              )}
              {isTranslating && (
                <span className="inline-flex items-center gap-2 text-xs text-vercel-gray-400">
                  <Spinner size="sm" />
                  Translating…
                </span>
              )}
              {translateError && (
                <Alert
                  message={translateError}
                  icon="error"
                  variant="error"
                  onClose={() => setTranslateError(null)}
                />
              )}
              {translateSummary && !isTranslating && (
                <Alert
                  message={translateSummary}
                  icon="info"
                  variant="default"
                  onClose={() => setTranslateSummary(null)}
                />
              )}
            </section>
          )}

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
