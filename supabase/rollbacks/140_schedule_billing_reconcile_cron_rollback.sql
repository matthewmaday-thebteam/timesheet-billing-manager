-- ============================================================================
-- Rollback for migration 140: schedule billing reconcile cron
-- ============================================================================
-- Run rollbacks in reverse order (140 -> 134). Function bodies restored here
-- are the LIVE prod definitions captured verbatim with pg_get_functiondef on
-- 2026-11-03 (md5-checked against the prod catalog), not repo migration files.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_jobid BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-billing-months') THEN
        PERFORM cron.unschedule('reconcile-billing-months');
    END IF;

    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'generate-eom-reports';
    IF v_jobid IS NULL THEN
        RAISE EXCEPTION 'rollback 140: generate-eom-reports cron job not found';
    END IF;
    -- Original schedule; the command was never modified.
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '0 6 1 * *');
END $$;

COMMIT;
