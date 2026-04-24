# billing-fix-101 — Operator Runbook

Repair task_monthly_totals amputation caused by migration 093's DELETE-vs-INSERT scope mismatch. See the diagnosis writeup for full context; this README covers only the operational sequence.

## Prerequisites (confirm BEFORE starting)

1. Both sync crons are unscheduled (they already are as of 2026-04-24).
2. Migration 101 (the `populate_task_monthly_totals` scope fix) has been written, reviewed, and applied via the standard migration runner.
3. You have a `psql` connection with write access to `public` and permission to create a `billing_snapshots` schema.
4. Archive directory exists for capturing report output (e.g. `reports/2026-04-24/`).

## Run order

Run each script with `psql -v ON_ERROR_STOP=1 -f <file>`. Do not proceed to the next step if the current step prints errors.

1. `01_snapshot.sql`
   - Creates `billing_snapshots.*_2026_04_24_pre_fix` tables. Atomic. The verification SELECTs at the end must show `delta = 0` for all three tables. If any delta is nonzero, stop.
2. `02_blast_radius_report.sql`
   - Read-only. Pipe to a file: `psql -f 02_blast_radius_report.sql > reports/2026-04-24/blast_radius.txt`. Archive it before proceeding. This is your forensic record of the pre-fix damage.
3. `03_rebuild_tmt.sql`
   - Calls the fixed `populate_task_monthly_totals` across all Layer 1 history. Watch the `NOTICE` output for the returned JSON summary and the row / minute delta vs snapshot. Negative deltas are unexpected and warrant investigation before step 4.
4. `04_restamp_summaries.sql`
   - Re-stamps `project_monthly_summary` only for `(project, month)` pairs whose tmt totals actually changed (> 1 minute) vs the snapshot. Protects Jan/Feb 2026 `v1.2` rows from needless regression. Review the final version-mix report: Jan/Feb 2026 should remain on `v1.2` if their tmt content was unchanged.
5. `05_validate.sql`
   - Runs the `validate_task_monthly_totals_vs_rollups` invariant (must be 0 rows), Neocurrency March 2026 `project_monthly_summary` spot-check, and the Layer 1 day-by-day spot-check. Look for `!!!! VALIDATION FAILED` lines; any hit means STOP.
6. Operator decision: if validation passes, edit the edge functions per the migration-101 companion change and re-enable the sync crons. If validation fails, go to rollback.

## Rollback

If `05_validate.sql` reports failure, run:

```
psql -v ON_ERROR_STOP=1 -f 99_rollback.sql
```

This restores `project_monthly_summary` and `task_monthly_totals` from the 2026-04-24 snapshots and drops the fixed populate function. You must then re-apply migration 093 via the migration runner to restore the prior (buggy) function body, and leave the sync crons unscheduled pending root-cause review.

## Snapshot retention

`billing_snapshots.*_2026_04_24_pre_fix` tables must be retained for at least 90 days (until 2026-07-23). Do not drop them before that date without explicit authorization.
