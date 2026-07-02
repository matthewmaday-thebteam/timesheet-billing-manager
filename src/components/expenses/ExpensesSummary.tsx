/**
 * ExpensesSummary — thin metric row for the Expenses page.
 *
 * Composes the MetricCard atom (same layout conventions as StatsOverview) to
 * surface the three headline figures: total EUR, transaction count, and the
 * needs-review backlog. Tokens only; the needs-review card flips to the warning
 * treatment when there is a backlog to draw the operator's eye.
 */

import { MetricCard } from '../MetricCard';

interface ExpensesSummaryProps {
  totalEur: number;
  expenseCount: number;
  needsReviewCount: number;
}

const eurFormatter = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export function ExpensesSummary({ totalEur, expenseCount, needsReviewCount }: ExpensesSummaryProps) {
  const hasReviewBacklog = needsReviewCount > 0;

  return (
    <div className="flex gap-4">
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
