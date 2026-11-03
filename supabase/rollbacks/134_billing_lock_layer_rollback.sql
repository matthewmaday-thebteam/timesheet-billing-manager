-- ============================================================================
-- Rollback for migration 134: billing lock layer
-- ============================================================================
-- Drops the lock tables INCLUDING any manual locks / accepted variances added
-- after deploy; export them first if they must be kept.
-- Run rollbacks in reverse order (140 -> 134). Function bodies restored here
-- are the LIVE prod definitions captured verbatim with pg_get_functiondef on
-- 2026-11-03 (md5-checked against the prod catalog), not repo migration files.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.raise_billing_alert(TEXT, TEXT, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.is_billing_month_locked(UUID, DATE);
DROP FUNCTION IF EXISTS public.billing_project_month_lock_reason(UUID, DATE);
DROP FUNCTION IF EXISTS public.is_company_month_locked(UUID, DATE);
DROP FUNCTION IF EXISTS public.billing_month_lock_reason(UUID, DATE);
DROP FUNCTION IF EXISTS public.billing_canonical_project(UUID);
DROP FUNCTION IF EXISTS public.billing_company_family(UUID);

DROP TABLE IF EXISTS public.billing_accepted_variances;
DROP TABLE IF EXISTS public.billing_month_locks;
DROP TABLE IF EXISTS public.billing_settings;

COMMIT;
