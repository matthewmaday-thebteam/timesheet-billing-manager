-- ============================================================================
-- Rollback for migration 139: billing drift view + reconcile
-- ============================================================================
-- Apply 140 rollback first (the cron job calls run_scheduled_billing_reconcile).
-- Run rollbacks in reverse order (140 -> 134). Function bodies restored here
-- are the LIVE prod definitions captured verbatim with pg_get_functiondef on
-- 2026-11-03 (md5-checked against the prod catalog), not repo migration files.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.run_scheduled_billing_reconcile();
DROP FUNCTION IF EXISTS public.reconcile_billing_months(DATE, DATE, BOOLEAN);
DROP VIEW IF EXISTS public.v_billing_month_drift;

COMMIT;
