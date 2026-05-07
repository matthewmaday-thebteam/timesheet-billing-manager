-- ============================================================================
-- Rollback for migration 107
-- ============================================================================
-- Order matters:
--   1. Unschedule the pg_cron job FIRST (Condition 9: cron.job lives outside
--      mcp_api; if we drop the function before unscheduling, the next
--      cron tick will error.)
--   2. Drop the cleanup function.
--   3. Drop the admin RPCs.
--   4. Drop the internal admin gate.
-- ============================================================================

BEGIN;

-- 1. Unschedule pg_cron job (idempotent)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mcp_api_audit_cleanup') THEN
        PERFORM cron.unschedule('mcp_api_audit_cleanup');
    END IF;
END $$;

-- 2. Cleanup function
DROP FUNCTION IF EXISTS mcp_api._cleanup_old_audit_rows(INTEGER);

-- 3. Admin RPCs
DROP FUNCTION IF EXISTS mcp_api.admin_revoke_api_key(UUID);
DROP FUNCTION IF EXISTS mcp_api.admin_create_api_key(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS mcp_api.admin_list_api_keys();

-- 4. Internal admin gate
DROP FUNCTION IF EXISTS mcp_api._internal_assert_admin();

COMMIT;
