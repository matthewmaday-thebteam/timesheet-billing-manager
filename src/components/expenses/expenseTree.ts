/**
 * expenseTree - Single computation path for the Expenses accordion.
 *
 * Builds the entire Year > Month > Category > Expense hierarchy from ONE
 * expenses array in a single pass. Every level's EUR total is accumulated in
 * integer CENTS (Math.round(eur_amount * 100)) so children always sum to their
 * parent to the cent by construction — there are no per-level independent
 * queries and no floating-point drift. Formatting to a euro string happens once
 * at display time.
 *
 * @category Expenses (page-local helper)
 */

import type { ExpenseCategoryRecord, ExpenseRecord } from './expenseTypes';

// ============================================================================
// CENTS + FORMATTING (the single money path)
// ============================================================================

/** Canonical rounding of a EUR amount to integer cents. Used everywhere. */
export function toCents(eurAmount: number): number {
  return Math.round(eurAmount * 100);
}

const eurFormatter = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
});

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const plainAmountFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format integer cents as a EUR currency string, e.g. 10000 → "€100.00". */
export function formatEurCents(cents: number): string {
  return eurFormatter.format(cents / 100);
}

/** Format integer USD cents as a USD currency string, e.g. 10000 → "$100.00". */
export function formatUsdCents(cents: number): string {
  return usdFormatter.format(cents / 100);
}

/** Format an account-currency amount with its code, e.g. "195.58 BGN". */
export function formatOriginalAmount(amount: number, currency: string): string {
  return `${plainAmountFormatter.format(amount)} ${currency}`;
}

// ============================================================================
// TREE NODE TYPES
// ============================================================================

export type OverheadType = 'Fixed' | 'Variable';

/**
 * USD REPORTING accumulators carried at every level, alongside the EUR totals.
 * `usdTotalCents` sums ONLY rows with a known USD value (same one pass, same cents
 * discipline as EUR). `usdPendingCount` counts included rows whose USD is pending
 * (rate not yet known) — those are EXCLUDED from usdTotalCents, so any level with
 * pending > 0 has a total that would be understated if shown alone. The UI marks
 * such totals; a total is only "complete" when usdPendingCount === 0.
 */
export interface UsdRollup {
  usdTotalCents: number;
  usdPendingCount: number;
}

/** Leaf grouping: a single category within a single month. */
export interface ExpenseCategoryNode extends UsdRollup {
  /** Stable key: `${monthKey}-${categoryId}`. */
  key: string;
  categoryId: number;
  name: string;
  overheadType: OverheadType | null;
  sortOrder: number;
  totalCents: number;
  needsReviewCount: number;
  /** Expenses in query order (value_date desc). */
  expenses: ExpenseRecord[];
}

/** A single month (YYYY-MM) containing its categories. */
export interface ExpenseMonthNode extends UsdRollup {
  /** Stable key: `YYYY-MM`. */
  key: string;
  label: string;
  totalCents: number;
  needsReviewCount: number;
  categories: ExpenseCategoryNode[];
}

/** A single year containing its months. */
export interface ExpenseYearNode extends UsdRollup {
  /** Stable key: the numeric year. */
  key: number;
  year: number;
  totalCents: number;
  needsReviewCount: number;
  months: ExpenseMonthNode[];
}

export interface ExpenseTree {
  years: ExpenseYearNode[];
  grandTotalCents: number;
  /** USD grand total (pending rows excluded — see grandUsdPendingCount). */
  grandUsdTotalCents: number;
  /** Included rows whose USD is pending across the whole tree. */
  grandUsdPendingCount: number;
  /**
   * Count of expenses actually included in the tree (i.e. after credits are
   * excluded). Summary tiles derive from this so they match the accordion.
   */
  expenseCount: number;
}

// ============================================================================
// BUILDER
// ============================================================================

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Internal mutable accumulators (Maps kept off the public node shapes). */
interface YearAcc extends Omit<ExpenseYearNode, 'months'> {
  monthMap: Map<string, MonthAcc>;
}
interface MonthAcc extends Omit<ExpenseMonthNode, 'categories'> {
  catMap: Map<number, ExpenseCategoryNode>;
}

/**
 * Derive the `YYYY-MM` bucket for an expense. `assigned_month` is the canonical
 * bucketing field; `value_date` is the fallback if it is ever missing. Both are
 * accepted whether they arrive as `YYYY-MM` or a full `YYYY-MM-DD` date.
 */
function monthKeyOf(expense: ExpenseRecord): string {
  const source = expense.assigned_month || expense.value_date || '';
  return source.slice(0, 7);
}

/**
 * Build the full Year > Month > Category > Expense tree in a single pass.
 * Sorting: years desc, months desc, categories by sort_order (then name),
 * expenses preserve the incoming (value_date desc) order.
 */
export function buildExpenseTree(
  expenses: ExpenseRecord[],
  categories: ExpenseCategoryRecord[],
): ExpenseTree {
  const categoryById = new Map<number, ExpenseCategoryRecord>();
  for (const category of categories) {
    categoryById.set(category.id, category);
  }

  const yearMap = new Map<number, YearAcc>();
  let grandTotalCents = 0;
  let grandUsdTotalCents = 0;
  let grandUsdPendingCount = 0;
  let expenseCount = 0;

  for (const expense of expenses) {
    // Single exclusion point (preserves the single-computation-path property):
    // Credits are money IN, never spending, so they are dropped here — once —
    // which keeps them out of every level total AND the row listings. Rows with
    // entry_type null are unmapped and treated as debits (kept visible).
    if (expense.entry_type === 'Credit') continue;
    expenseCount += 1;

    const cents = toCents(expense.eur_amount);
    const flagged = expense.needs_review ? 1 : 0;
    // USD reporting: pending rows (usd_amount null) contribute 0 to the total and
    // 1 to the pending count at every level — the same one pass as EUR, so USD
    // totals and pending counts always reconcile with the tree by construction.
    const usdCents = expense.usd_amount != null ? toCents(expense.usd_amount) : 0;
    const usdPending = expense.usd_amount == null ? 1 : 0;
    grandTotalCents += cents;
    grandUsdTotalCents += usdCents;
    grandUsdPendingCount += usdPending;

    const monthKey = monthKeyOf(expense);
    const year = Number(monthKey.slice(0, 4));
    const monthIndex = Number(monthKey.slice(5, 7)) - 1;

    // ---- Year ----
    let yearAcc = yearMap.get(year);
    if (!yearAcc) {
      yearAcc = {
        key: year,
        year,
        totalCents: 0,
        needsReviewCount: 0,
        usdTotalCents: 0,
        usdPendingCount: 0,
        monthMap: new Map(),
      };
      yearMap.set(year, yearAcc);
    }
    yearAcc.totalCents += cents;
    yearAcc.needsReviewCount += flagged;
    yearAcc.usdTotalCents += usdCents;
    yearAcc.usdPendingCount += usdPending;

    // ---- Month ----
    let monthAcc = yearAcc.monthMap.get(monthKey);
    if (!monthAcc) {
      const label = monthIndex >= 0 && monthIndex < 12
        ? `${MONTH_NAMES[monthIndex]} ${year}`
        : monthKey;
      monthAcc = {
        key: monthKey,
        label,
        totalCents: 0,
        needsReviewCount: 0,
        usdTotalCents: 0,
        usdPendingCount: 0,
        catMap: new Map(),
      };
      yearAcc.monthMap.set(monthKey, monthAcc);
    }
    monthAcc.totalCents += cents;
    monthAcc.needsReviewCount += flagged;
    monthAcc.usdTotalCents += usdCents;
    monthAcc.usdPendingCount += usdPending;

    // ---- Category (within this month) ----
    let categoryNode = monthAcc.catMap.get(expense.category_id);
    if (!categoryNode) {
      const record = categoryById.get(expense.category_id);
      categoryNode = {
        key: `${monthKey}-${expense.category_id}`,
        categoryId: expense.category_id,
        name: record?.name ?? `Category ${expense.category_id}`,
        overheadType: (record?.overhead_type ?? null) as OverheadType | null,
        sortOrder: record?.sort_order ?? Number.MAX_SAFE_INTEGER,
        totalCents: 0,
        needsReviewCount: 0,
        usdTotalCents: 0,
        usdPendingCount: 0,
        expenses: [],
      };
      monthAcc.catMap.set(expense.category_id, categoryNode);
    }
    categoryNode.totalCents += cents;
    categoryNode.needsReviewCount += flagged;
    categoryNode.usdTotalCents += usdCents;
    categoryNode.usdPendingCount += usdPending;
    categoryNode.expenses.push(expense);
  }

  // ---- Freeze into sorted, immutable node arrays ----
  const years: ExpenseYearNode[] = [...yearMap.values()]
    .sort((a, b) => b.year - a.year)
    .map((yearAcc) => {
      const months: ExpenseMonthNode[] = [...yearAcc.monthMap.values()]
        .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
        .map((monthAcc) => {
          const categories: ExpenseCategoryNode[] = [...monthAcc.catMap.values()].sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
          );
          return {
            key: monthAcc.key,
            label: monthAcc.label,
            totalCents: monthAcc.totalCents,
            needsReviewCount: monthAcc.needsReviewCount,
            usdTotalCents: monthAcc.usdTotalCents,
            usdPendingCount: monthAcc.usdPendingCount,
            categories,
          };
        });
      return {
        key: yearAcc.year,
        year: yearAcc.year,
        totalCents: yearAcc.totalCents,
        needsReviewCount: yearAcc.needsReviewCount,
        usdTotalCents: yearAcc.usdTotalCents,
        usdPendingCount: yearAcc.usdPendingCount,
        months,
      };
    });

  return {
    years,
    grandTotalCents,
    grandUsdTotalCents,
    grandUsdPendingCount,
    expenseCount,
  };
}
