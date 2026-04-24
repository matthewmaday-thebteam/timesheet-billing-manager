# Runbook: Migration 101 -- Billing Scope Fix

## Summary

`populate_task_monthly_totals(workspace, range_start, range_end)` in migration 093 had a scope mismatch: the `DELETE` wiped entire months covered by `range_start..range_end` but the `INSERT` only re-aggregated rows with `work_date BETWEEN range_start AND range_end`. The sync edge functions pass `range_start = firstOfMonth(today) - 14 days`, so after day 15 of any month the first sync call of the day would delete the current month's totals and re-populate only from day 18 onward, permanently amputating days 1-17. Verified against Neocurrency March 2026: 687.16 hours were missing from `task_monthly_totals` for March 1-17. Migration 101 fixes this by expanding `p_range_start`/`p_range_end` to full month boundaries at the top of the function body so the DELETE and INSERT scopes always match. It also introduces `validate_task_monthly_totals_vs_rollups(range_start, range_end)` and wires both sync edge functions to hard-abort the drain step if reconciliation finds discrepancies greater than 2 minutes.

## Rollout sequence

1. Confirm both sync crons are unscheduled (`SELECT * FROM cron.job WHERE jobname IN ('sync-clickup-timesheets', 'sync-clockify-timesheets');` returns zero rows).
2. Run `psql -f scripts/billing-fix-101/01_snapshot.sql` (or paste the script contents into the Supabase SQL editor). This snapshots `project_monthly_summary`, `task_monthly_totals`, and `qbo_invoice_log` into the `billing_snapshots` schema under the `_2026_04_24_pre_fix` suffix -- all three are required for rollback.
3. Apply migration `101_fix_task_monthly_totals_scope.sql`.
4. Run the rebuild script (owned by a separate agent) to repopulate `task_monthly_totals` from scratch across all historical months.
5. Validate: `SELECT * FROM validate_task_monthly_totals_vs_rollups();` must return zero rows. Spot-check Neocurrency March 2026 matches the rollup sum.
6. Deploy the updated edge functions: `supabase functions deploy sync-clickup-timesheets` and `supabase functions deploy sync-clockify-timesheets`.
7. Re-enable the crons using the SQL in the final section of this runbook.
8. Monitor the first two sync runs for each integration; check edge function logs for `RECONCILIATION FAILURE` messages and confirm `task_monthly_totals.updated_at` advances.

## Rollback sequence

1. Unschedule the crons: `SELECT cron.unschedule('sync-clickup-timesheets'); SELECT cron.unschedule('sync-clockify-timesheets');`
2. Drop the new function and restore the v2 body from migration 093: `DROP FUNCTION IF EXISTS validate_task_monthly_totals_vs_rollups(DATE, DATE);` then re-run the `CREATE OR REPLACE FUNCTION populate_task_monthly_totals(...)` block from migration 093 lines 434-557.
3. Restore totals from snapshot by running `scripts/billing-fix-101/99_rollback.sql`. That script is atomic (single `BEGIN`/`COMMIT`), pre-flights snapshot existence, uses explicit column lists to restore both `project_monthly_summary` and `task_monthly_totals` from the `billing_snapshots._2026_04_24_pre_fix` tables, drops `validate_task_monthly_totals_vs_rollups`, and restores the v2 body of `populate_task_monthly_totals` inline. Migration 093 does NOT need to be re-applied.
4. Redeploy the prior edge function revisions (roll back via the Supabase dashboard or re-deploy from the previous git SHA).
5. Re-enable the crons only after confirming the rollback state matches the pre-migration snapshot.

## Re-enable the sync crons

Copy the `cron.schedule` invocations verbatim from `supabase/migrations/082_clickup_sync_cron.sql` (ClickUp, `30 * * * *`) and `supabase/migrations/079_clockify_sync_cron.sql` (Clockify, `0 * * * *`). Both use the Supabase service-role key resolved from the project's vault, and the same `net.http_post` shape. TODO(operator): re-run those two `select cron.schedule(...)` blocks exactly as written in those migration files -- do not retype from memory and do not paste a secret name into this runbook. The function URLs, cron expressions, header construction, and vault lookup must match bit-for-bit or the scheduler will run against stale code paths.
