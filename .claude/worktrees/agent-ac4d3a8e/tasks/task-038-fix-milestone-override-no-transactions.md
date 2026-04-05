# Task 038: Fix Milestone Override When No Transactions Exist

## Status: READY FOR MIGRATION

## Problem
FCS0001 (FoodCycle Science) has a `revenue_milestone` billing linked to it, but no `billing_transactions` for February 2026. The `recalculate_fixed_billing_month()` function uses `JOIN billing_transactions` in Part 1, so milestones with no transactions are skipped — leaving `milestone_override_cents = NULL`.

The DB view `v_combined_revenue_by_company_month` uses `COALESCE(milestone_override_cents, billed_revenue_cents)`, so NULL falls through to the full timesheet revenue ($4,200). The Revenue page frontend correctly computes the override as $0.

**Result**: DB view shows $62,807.50 for February, but Revenue page shows $58,607.50 — a $4,200 discrepancy.

## Root Cause
1. **Part 1** (`JOIN billing_transactions bt ... WHERE bt.transaction_month = v_month`): If no transactions exist for the month, the milestone isn't found. Override stays NULL.
2. **Part 2** (clear stale overrides): Also uses `JOIN billing_transactions` with month filter, so it would CLEAR any override that was somehow set, because it thinks the milestone doesn't exist for that month.

## Fix: Migration 051

### `supabase/migrations/051_fix_milestone_override_no_transactions.sql`
1. **Part 1**: Changed `JOIN billing_transactions` to `LEFT JOIN` with month filter on the JOIN condition. Uses `COALESCE(SUM(bt.amount_cents), 0)` so milestones with no transactions get override = 0.
2. **Part 2**: Changed to check for the billing's existence (`FROM billings b WHERE b.linked_project_id = pms.project_id AND b.type = 'revenue_milestone'`) — no longer checks for transactions in the month.
3. **Re-backfill**: Runs `recalculate_fixed_billing_month()` for all months with summary data (not just months with transactions).

## To Apply
Run migration 051 in Supabase SQL Editor, then deploy frontend:
```bash
npx vercel --prod
```

## Verification
- [ ] Migration 051 applied in Supabase
- [ ] FCS0001 Feb `milestone_override_cents` = 0 (not NULL)
- [ ] Feb total combined revenue = ~$58,607.50 (matches Revenue page)
- [ ] Dashboard chart Feb value matches Revenue page
- [ ] Revenue page unchanged (already correct)
