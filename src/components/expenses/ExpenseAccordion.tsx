/**
 * ExpenseAccordion - Year > Month > Category > Expense drill-down.
 *
 * Composes the official Accordion atom at every level (its `headerRight` slot
 * is purpose-built for a totals value, and it owns its own expand state). Every
 * level renders its EUR total; the numbers come straight from the pre-computed
 * cents tree (see expenseTree.ts), so no summing happens in the view.
 *
 * @category Expenses (page-local)
 */

import { Accordion } from '../Accordion';
import { Badge } from '../Badge';
import { ExpenseRow } from './ExpenseRow';
import {
  formatEurCents,
  formatUsdCents,
  type ExpenseCategoryNode,
  type ExpenseMonthNode,
  type ExpenseYearNode,
} from './expenseTree';

/**
 * Right-aligned header content shared by every accordion level: the EUR total,
 * the USD reporting total (muted), and honesty flags. When a level has rows whose
 * USD is pending (rate not yet known), those rows are EXCLUDED from usdTotalCents,
 * so the USD figure would be understated — we surface a "N pending USD" badge so a
 * partial total is never shown as if it were complete.
 */
function LevelTotal({
  totalCents,
  needsReviewCount,
  usdTotalCents,
  usdPendingCount,
}: {
  totalCents: number;
  needsReviewCount: number;
  usdTotalCents: number;
  usdPendingCount: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {needsReviewCount > 0 && (
        <Badge variant="warning" size="sm">
          {needsReviewCount} to review
        </Badge>
      )}
      {usdPendingCount > 0 && (
        <Badge variant="default" size="sm">
          {usdPendingCount} pending USD
        </Badge>
      )}
      <span className="text-sm font-mono text-vercel-gray-400">
        {formatUsdCents(usdTotalCents)}
      </span>
      <span className="text-sm font-mono text-vercel-gray-600">
        {formatEurCents(totalCents)}
      </span>
    </div>
  );
}

function CategoryAccordion({ category }: { category: ExpenseCategoryNode }) {
  return (
    <Accordion
      header={
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-vercel-gray-600">{category.name}</span>
          {category.overheadType && (
            <Badge variant={category.overheadType === 'Fixed' ? 'info' : 'default'} size="sm">
              {category.overheadType}
            </Badge>
          )}
        </div>
      }
      headerRight={
        <LevelTotal
          totalCents={category.totalCents}
          needsReviewCount={category.needsReviewCount}
          usdTotalCents={category.usdTotalCents}
          usdPendingCount={category.usdPendingCount}
        />
      }
    >
      <div className="divide-y divide-vercel-gray-100">
        {category.expenses.map((expense) => (
          <ExpenseRow key={expense.id} expense={expense} />
        ))}
      </div>
    </Accordion>
  );
}

function MonthAccordion({ month }: { month: ExpenseMonthNode }) {
  return (
    <Accordion
      header={<span className="text-sm font-medium text-vercel-gray-600">{month.label}</span>}
      headerRight={
        <LevelTotal
          totalCents={month.totalCents}
          needsReviewCount={month.needsReviewCount}
          usdTotalCents={month.usdTotalCents}
          usdPendingCount={month.usdPendingCount}
        />
      }
    >
      <div className="p-3 space-y-3">
        {month.categories.map((category) => (
          <CategoryAccordion key={category.key} category={category} />
        ))}
      </div>
    </Accordion>
  );
}

function YearAccordion({
  year,
  defaultExpanded,
}: {
  year: ExpenseYearNode;
  defaultExpanded: boolean;
}) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      header={<span className="text-lg font-semibold text-vercel-gray-600">{year.year}</span>}
      headerRight={
        <LevelTotal
          totalCents={year.totalCents}
          needsReviewCount={year.needsReviewCount}
          usdTotalCents={year.usdTotalCents}
          usdPendingCount={year.usdPendingCount}
        />
      }
    >
      <div className="p-3 space-y-3">
        {year.months.map((month) => (
          <MonthAccordion key={month.key} month={month} />
        ))}
      </div>
    </Accordion>
  );
}

interface ExpenseAccordionProps {
  years: ExpenseYearNode[];
}

export function ExpenseAccordion({ years }: ExpenseAccordionProps) {
  return (
    <div className="space-y-4">
      {years.map((year, index) => (
        <YearAccordion key={year.key} year={year} defaultExpanded={index === 0} />
      ))}
    </div>
  );
}

export default ExpenseAccordion;
