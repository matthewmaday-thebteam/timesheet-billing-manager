// Run with: node --test scripts/expenses-tests/expenseTree.test.ts
//
// Covers the UI-side single-computation-path tree builder, specifically the
// rule that Credits (money in) are excluded from expense display while Debits
// (and unmapped null-entry rows) count, and that the children-sum-to-parent
// cents invariant still holds over the included rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildExpenseTree, toCents } from '../../src/components/expenses/expenseTree.ts';
import type {
  ExpenseCategoryRecord,
  ExpenseRecord,
} from '../../src/components/expenses/expenseTypes.ts';

const categories: ExpenseCategoryRecord[] = [
  { id: 1, name: 'Cloud', overhead_type: 'Variable', sort_order: 1, is_fallback: false },
  { id: 2, name: 'Rent', overhead_type: 'Fixed', sort_order: 2, is_fallback: false },
];

let seq = 0;
function makeExpense(overrides: Partial<ExpenseRecord>): ExpenseRecord {
  seq += 1;
  return {
    id: `row-${seq}`,
    account_currency: 'EUR',
    original_amount: 0,
    operation_currency: null,
    operation_amount: null,
    eur_amount: 0,
    conversion_rate: 1,
    rate_source: 'identity',
    entry_type: 'Debit',
    description_original: null,
    description_translated: null,
    translation_source: null,
    vendor: null,
    beneficiary: null,
    reference: null,
    category_id: 1,
    category_source: null,
    value_date: '2025-03-15',
    assigned_month: '2025-03',
    needs_review: false,
    ...overrides,
  };
}

/** Flatten every expense row that survives into the tree listings. */
function listedRows(tree: ReturnType<typeof buildExpenseTree>): ExpenseRecord[] {
  return tree.years.flatMap((y) =>
    y.months.flatMap((m) => m.categories.flatMap((c) => c.expenses)),
  );
}

test('credits are excluded from every level total and from row listings; debits and null-entry rows count', () => {
  const expenses = [
    makeExpense({ id: 'debit', eur_amount: 100, entry_type: 'Debit', category_id: 1 }),
    makeExpense({ id: 'credit', eur_amount: 500, entry_type: 'Credit', category_id: 1 }),
    makeExpense({ id: 'unmapped', eur_amount: 25, entry_type: null, category_id: 2 }),
  ];

  const tree = buildExpenseTree(expenses, categories);

  // Grand total counts only the debit + null-entry rows (100 + 25), never the credit's 500.
  assert.equal(tree.grandTotalCents, 12500);
  assert.equal(tree.expenseCount, 2);

  const rows = listedRows(tree);
  const ids = rows.map((r) => r.id);
  assert.equal(ids.includes('credit'), false, 'credit row must not be listed');
  assert.equal(ids.includes('debit'), true, 'debit row must be listed');
  assert.equal(ids.includes('unmapped'), true, 'null entry_type (unmapped) must be treated as a debit');
});

test('single-computation-path invariant holds over included rows (children sum to parent, to the cent)', () => {
  const expenses = [
    makeExpense({ eur_amount: 12.34, category_id: 1, assigned_month: '2025-01', value_date: '2025-01-05' }),
    makeExpense({ eur_amount: 7.89, category_id: 2, assigned_month: '2025-01', value_date: '2025-01-06' }),
    makeExpense({ eur_amount: 100.01, category_id: 1, assigned_month: '2025-02', value_date: '2025-02-10' }),
    // A large credit in the middle must not perturb any total.
    makeExpense({ eur_amount: 9999.99, entry_type: 'Credit', category_id: 1, assigned_month: '2025-02', value_date: '2025-02-11' }),
    makeExpense({ eur_amount: 55.55, category_id: 1, assigned_month: '2024-12', value_date: '2024-12-31' }),
  ];

  const tree = buildExpenseTree(expenses, categories);

  // 12.34 + 7.89 + 100.01 + 55.55 = 175.79 (credit excluded).
  assert.equal(tree.grandTotalCents, 17579);
  assert.equal(tree.expenseCount, 4);

  // Years sum to the grand total.
  assert.equal(
    tree.years.reduce((sum, y) => sum + y.totalCents, 0),
    tree.grandTotalCents,
  );

  // Each parent equals the exact sum of its children, all the way down to rows.
  for (const year of tree.years) {
    assert.equal(
      year.months.reduce((sum, m) => sum + m.totalCents, 0),
      year.totalCents,
    );
    for (const month of year.months) {
      assert.equal(
        month.categories.reduce((sum, c) => sum + c.totalCents, 0),
        month.totalCents,
      );
      for (const category of month.categories) {
        assert.equal(
          category.expenses.reduce((sum, e) => sum + toCents(e.eur_amount), 0),
          category.totalCents,
        );
      }
    }
  }
});

test('Owner Payments (31) debits are ORDINARY expenses — fully included in every total, never category-excluded', () => {
  // CONTRACT (user, verbatim): "for ownerpayments, they are still an expense and
  // should be listed as such. We will just use that later when updating investor
  // reports." Owner Payments (workbook-native category id 31) is only a LABEL for
  // downstream investor-report separation — the ONLY exclusion in this domain is
  // entry_type='Credit'. This is an anti-drift guard so nobody ever special-cases
  // category-based exclusion the way credits are excluded.
  const cats: ExpenseCategoryRecord[] = [
    ...categories,
    { id: 31, name: 'Owner Payments', overhead_type: null, sort_order: 12, is_fallback: false },
  ];
  const expenses = [
    makeExpense({ id: 'owner', eur_amount: 250, entry_type: 'Debit', category_id: 31, assigned_month: '2025-04', value_date: '2025-04-10' }),
    makeExpense({ id: 'normal', eur_amount: 50, entry_type: 'Debit', category_id: 1, assigned_month: '2025-04', value_date: '2025-04-11' }),
    // A large credit that must still be the ONLY thing excluded.
    makeExpense({ id: 'credit', eur_amount: 9000, entry_type: 'Credit', category_id: 31, assigned_month: '2025-04', value_date: '2025-04-12' }),
  ];

  const tree = buildExpenseTree(expenses, cats);

  // The Owner Payments debit counts exactly like the normal debit: 250 + 50 = 300.
  assert.equal(tree.grandTotalCents, 30000);
  assert.equal(tree.expenseCount, 2);

  const year = tree.years.find((y) => y.year === 2025);
  assert.ok(year, '2025 year node must exist');
  assert.equal(year.totalCents, 30000, 'Owner Payments debit is in the year total');

  const month = year.months.find((m) => m.key === '2025-04');
  assert.ok(month, '2025-04 month node must exist');
  assert.equal(month.totalCents, 30000, 'Owner Payments debit is in the month total');

  const ownerCat = month.categories.find((c) => c.categoryId === 31);
  assert.ok(ownerCat, 'Owner Payments category node must exist');
  assert.equal(ownerCat.totalCents, 25000, 'Owner Payments category total reflects its debit');
  assert.equal(ownerCat.expenses.length, 1);

  // The Owner Payments debit is listed; only the credit is excluded.
  const ids = listedRows(tree).map((r) => r.id);
  assert.equal(ids.includes('owner'), true, 'Owner Payments debit must be listed like any expense');
  assert.equal(ids.includes('normal'), true);
  assert.equal(ids.includes('credit'), false, 'credit is still the ONLY exclusion');
});
