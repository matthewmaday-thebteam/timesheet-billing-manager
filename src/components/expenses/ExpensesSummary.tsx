/**
 * ExpensesSummary — thin metric row for the Expenses page.
 *
 * Composes the MetricCard atom (same layout conventions as StatsOverview) to
 * surface the headline figures: total USD (the reporting currency), total EUR
 * (the bank-truth normalization), transaction count, and the needs-review
 * backlog. Tokens only; the needs-review card flips to the warning treatment when
 * there is a backlog. The USD total EXCLUDES rows whose rate is still pending — so
 * when any exist we surface the count as a secondary line, never a silent partial.
 */

import { MetricCard } from '../MetricCard';

interface ExpensesSummaryProps {
  totalUsd: number;
  totalEur: number;
  expenseCount: number;
  needsReviewCount: number;
  /** Included rows whose USD is pending (rate not yet known); excluded from totalUsd. */
  usdPendingCount: number;
}

const eurFormatter = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function ExpensesSummary({
  totalUsd,
  totalEur,
  expenseCount,
  needsReviewCount,
  usdPendingCount,
}: ExpensesSummaryProps) {
  const hasReviewBacklog = needsReviewCount > 0;
  const hasUsdPending = usdPendingCount > 0;

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <MetricCard
          title="Total Expenses (USD)"
          value={usdFormatter.format(totalUsd)}
          secondaryLabel={hasUsdPending ? 'Pending rate' : undefined}
          secondaryValue={
            hasUsdPending
              ? `${usdPendingCount.toLocaleString('en-US')} row${usdPendingCount === 1 ? '' : 's'}`
              : undefined
          }
        />
      </div>

      <div className="flex-1">
        <MetricCard title="Total Expenses (EUR)" value={eurFormatter.format(totalEur)} />
      </div>

      <div className="flex-1">
        <MetricCard title="Transactions" value={expenseCount.toLocaleString('en-US')} />
      </div>

      <div className="flex-1">
        <MetricCard
          title="Needs Review"
          value={needsReviewCount.toLocaleString('en-US')}
          isWarning={hasReviewBacklog}
        />
      </div>
    </div>
  );
}

export default ExpensesSummary;
