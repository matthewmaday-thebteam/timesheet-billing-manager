-- ============================================================================
-- Migration 140: Schedule the daily billing reconcile; shift EOM generation
-- ============================================================================
-- Purpose (apply LAST, after 134–139 are live and verified):
--
--   1. `reconcile-billing-months` at 04:20 UTC daily:
--          SELECT public.run_scheduled_billing_reconcile();
--      A direct SQL call, not the net.http_post + vault pattern used for edge
--      functions, because the work is pure SQL: no service-role key leaves the
--      vault, no HTTP hop or edge cold start can silently drop the run, and the
--      outcome is visible in cron.job_run_details. Same pattern as
--      `materialize-billing-floor` (migration 114). Errors become a
--      `reconcile_failed` sync_alerts row (run_scheduled_billing_reconcile).
--      04:20 avoids the :00 / :30 sync runs and the 05:00 floor job.
--
--   2. `generate-eom-reports` moves from '0 6 1 * *' to '15 6 1 * *' (Phase 1
--      plan) so it no longer starts in the same minute as the 06:00 Clockify
--      sync and its queue drain. Only the schedule changes: cron.alter_job
--      leaves the existing command (net.http_post with the vault-held key)
--      byte-for-byte intact.
--
-- Depends on: 139.
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Idempotent (cron.schedule upserts by job name;
-- alter_job sets an absolute schedule).
-- Rollback: supabase/rollbacks/140_schedule_billing_reconcile_cron_rollback.sql
-- ============================================================================

BEGIN;

SELECT cron.schedule(
    'reconcile-billing-months',
    '20 4 * * *',
    $cron$SELECT public.run_scheduled_billing_reconcile();$cron$
);

DO $$
DECLARE
    v_jobid BIGINT;
    v_count INTEGER;
BEGIN
    SELECT COUNT(*), MIN(jobid) INTO v_count, v_jobid
      FROM cron.job WHERE jobname = 'generate-eom-reports';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'migration 140: expected exactly one generate-eom-reports cron job, found %', v_count;
    END IF;
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '15 6 1 * *');
END $$;

COMMIT;
