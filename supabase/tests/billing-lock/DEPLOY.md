# Billing lock (migrations 134–140): deploy runbook

Production billing system. Apply by hand through the Supabase Management API / SQL editor as `postgres`
(this project does not use `supabase db push`). One migration at a time, each in its own request.

## 0. Before you start
- Pick a window away from the hourly syncs: Clockify `:00`, ClickUp `:30`. Start at about `:10` or `:40`. Avoid 03:15, 04:20, 05:00 and 06:00–06:15 UTC on the 1st.
- Have the matching rollback files open (`supabase/rollbacks/13x_*_rollback.sql`).
- Run the local suite first. It must be all green:
  `SCHEMA_TEMPLATE=bl_schema SNAPSHOT_TEMPLATE=bl_snapshot supabase/tests/billing-lock/run.sh`

## 1. Apply 134 → 139 (in order)
Prefix each file with a lock timeout, so a busy table fails fast instead of queueing behind a sync:

```sql
SET lock_timeout = '5s';
-- then the full contents of the migration file (it has its own BEGIN/COMMIT)
```

Order: `134_billing_lock_layer` → `135_billing_lock_gate_writers` → `136_rollup_change_triggers` →
`137_project_group_change_triggers` → `138_harden_drain_recalculation_queue` → `139_billing_drift_view_and_reconcile`.
If one fails with `lock_timeout`, retry it a few minutes later. If it fails for any other reason, stop and roll back what is applied (section 4).

## 2. Dry-run reconcile (before 140)
```sql
SELECT jsonb_pretty(public.reconcile_billing_months(NULL, NULL, TRUE));
```
Expected (snapshot of 2026-11-03; re-check anything new):
- `status = ok`, `tmt_stale_months = []`.
- `locked_alert`: 2026-05 ZoneCoach, 2026-06 The B Team / Management Automations (date-locked), 2026-09 ZoneCoach,
  2026-09 Fluffy Feather Farm, 2026-10 Fluffy Feather Farm.
- `accepted`: 2026-07 NeoCurrency, 2026-06 FoodCycler Hypercare. If either shows as `locked_alert`, its source has
  moved since 2026-11-03 and the seeded accepted values no longer match. Re-confirm with the owner before re-accepting with
  `SELECT accept_billing_variance('<project uuid>', '<month>', '<reason>', 'owner');`.
- `recalc`: 2026-10 luxus / Luxus Site Audit (→ $0), 2026-11 Fluffy Feather Farm.

Then the real run, once you're satisfied: `SELECT jsonb_pretty(public.reconcile_billing_months(NULL, NULL, FALSE) - 'items');`
It should return `status ok`, `persisting 0`, and raise `eom_report_stale` for luxus 2026-10.

## 3. Apply 140 (cron), then verify
```sql
SET lock_timeout = '5s';
-- contents of 140_schedule_billing_reconcile_cron.sql
```

Post-deploy verification:
```sql
-- cron: reconcile at 04:20 daily, EOM at 06:15 on the 1st, EOM command unchanged
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname IN ('reconcile-billing-months', 'generate-eom-reports');
-- locks: one qbo_invoice lock per sent invoice month, closed-through date
SELECT source, COUNT(*) FROM billing_month_locks GROUP BY 1;
SELECT * FROM billing_settings;
-- triggers present
SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_enqueue_recalc_on_rollup_update', 'trg_enqueue_recalc_on_rollup_delete',
  'trg_enqueue_on_pgm_insert', 'trg_enqueue_on_pgm_delete', 'trg_enqueue_on_pg_primary_change', 'trg_enqueue_on_pg_delete',
  'trg_qbo_invoice_log_billing_lock');
-- after the next :00 and :30 syncs: outcomes recorded, no failures
SELECT reason, outcome, COUNT(*) FROM recalculation_queue WHERE processed_at > NOW() - INTERVAL '2 hours' GROUP BY 1, 2;
SELECT alert_type, entity_id, severity, title FROM sync_alerts WHERE resolved_at IS NULL ORDER BY created_at DESC;
-- verification fixtures (expect ACE Oct $1,750.00; TP Oct $39,770.00; NeoCurrency Oct $61,480.00;
-- Taggable Oct $15,825.00; Third Party Pet Oct $11,677.50): see s01_snapshot_mass_recalc.sql t.check_fixtures()
```
Watch for `recalc_failed`, `tmt_rebuild_failed`, `reconcile_failed` or `rollup_project_unresolved`. Any of these means stop and investigate.

## 4. Rollback (strictly 140 → 134)
Run each rollback file as written: `140` → `139` → `138` → `137` → `136` → `135` → `134`.
Each restores the pre-deploy live function bodies and ACLs verbatim. The local suite proves the round trip with a
`pg_dump -s` diff.
- 138's rollback drops `recalculation_queue.outcome/error`. Export them first if you need the history.
- 134's rollback drops `billing_month_locks` / `billing_accepted_variances`, including any rows added after deploy.
- sync_alerts rows raised by the new code are left in place.
