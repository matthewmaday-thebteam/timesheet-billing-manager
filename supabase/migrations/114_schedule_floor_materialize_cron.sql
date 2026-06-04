-- ============================================================================
-- Migration 114: Schedule monthly materialization of minimum-hours floor revenue
-- ============================================================================
--
-- PURPOSE
--   Schedule a pg_cron job ('materialize-billing-floor') that runs once a month
--   and materializes the minimum-hours floor revenue rows by invoking the
--   in-database function materialize_billing_floor_projects(p_month date,
--   p_enqueue_only boolean). This guarantees the prior-month floor row exists
--   before end-of-month (EOM) reporting and QuickBooks (QBO) eligibility are
--   computed.
--
-- ORDERING RATIONALE (05:00 < 06:00)
--   The existing 'generate-eom-reports' cron (migration 072) runs at
--   '0 6 1 * *' (06:00 UTC on the 1st). EOM / QBO eligibility is derived from
--   v_eom_report_availability (migration 073), which requires the prior-month
--   floor row to already be materialized. This job is therefore scheduled at
--   '0 5 1 * *' (05:00 UTC on the 1st) — STRICTLY one hour before the EOM cron —
--   so the floor row is guaranteed to exist when eligibility is computed at 06:00.
--   Do NOT move this schedule to or past 06:00.
--
-- DIRECT-MODE RATIONALE
--   This calls a plain in-database SQL function and runs synchronously as the
--   postgres role (p_enqueue_only = false). It does NOT use the
--   net.http_post / vault service-role-key pattern — that pattern is reserved
--   for crons that invoke edge functions over HTTP. Because the work is a single
--   in-DB call, no separate queue/drain step is needed; the materialization is
--   complete when the cron command returns.
--
--   Both the prior month AND the current month are materialized, with the period
--   boundaries computed in Europe/Sofia (EOM eligibility uses Sofia local time):
--     - prior month  : covers the month whose EOM is being reported on the 1st
--     - current month : keeps the in-progress month's floor row current
--
-- BLAST RADIUS
--   - Invokes only already-vetted, additive/idempotent function
--     materialize_billing_floor_projects(...); introduces NO new billing logic.
--   - Creates/replaces ONLY a pg_cron schedule row (cron.job). Changes NO
--     tables and NO existing functions.
--   - Fully reversible: SELECT cron.unschedule('materialize-billing-floor');
--   - Idempotent / re-runnable: an existing job of the same name is unscheduled
--     before (re)scheduling, so applying this migration twice is safe.
-- ============================================================================

BEGIN;

DO $$
BEGIN
    -- If the job already exists from a prior run, unschedule first to avoid
    -- duplicate schedules (idempotent / re-runnable migration).
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'materialize-billing-floor') THEN
        PERFORM cron.unschedule('materialize-billing-floor');
    END IF;

    PERFORM cron.schedule(
        'materialize-billing-floor',
        '0 5 1 * *',  -- 05:00 UTC on the 1st of each month; MUST precede generate-eom-reports (0 6 1 * *, migration 072)
        $cmd$
        SELECT materialize_billing_floor_projects((date_trunc('month', (now() AT TIME ZONE 'Europe/Sofia')) - interval '1 month')::date, false);
        SELECT materialize_billing_floor_projects((date_trunc('month', (now() AT TIME ZONE 'Europe/Sofia')))::date, false);
        $cmd$
    );
END $$;

DO $$
BEGIN
    RAISE NOTICE '114 schedule floor materialize cron complete:';
    RAISE NOTICE '  - pg_cron job materialize-billing-floor scheduled at 05:00 UTC on the 1st (0 5 1 * *)';
    RAISE NOTICE '  - direct mode (in-DB call, synchronous, p_enqueue_only=false)';
    RAISE NOTICE '  - materializes prior + current month (Europe/Sofia period boundaries)';
    RAISE NOTICE '  - runs strictly before generate-eom-reports (0 6 1 * *, migration 072)';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK
-- ----------------------------------------------------------------------------
-- To remove this cron job, run:
--
--   SELECT cron.unschedule('materialize-billing-floor');
--
-- This affects only the pg_cron schedule (cron.job). It touches no tables and
-- no functions; materialize_billing_floor_projects(...) remains intact.
-- ============================================================================
