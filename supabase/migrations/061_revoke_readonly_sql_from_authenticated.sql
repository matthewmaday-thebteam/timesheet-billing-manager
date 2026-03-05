-- ============================================================================
-- Migration 061: Revoke execute_readonly_sql from authenticated role
-- ============================================================================
-- execute_readonly_sql (migration 029) is SECURITY DEFINER, meaning it runs
-- with the function owner's (postgres) privileges and bypasses all RLS.
-- Granting EXECUTE to authenticated allowed any logged-in user to read all
-- tables (including auth metadata, financial data, etc.) via arbitrary SELECT.
--
-- The only legitimate caller is the chat Edge Function, which uses service_role.
-- Revoking authenticated access closes the RLS bypass with zero impact.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION execute_readonly_sql(TEXT) FROM authenticated;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    v_has_grant BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
        WHERE routine_name = 'execute_readonly_sql'
          AND grantee = 'authenticated'
    ) INTO v_has_grant;

    RAISE NOTICE 'Migration 061 Complete:';
    RAISE NOTICE '  - Authenticated grant revoked: %', NOT v_has_grant;
    RAISE NOTICE '  - service_role access retained for Edge Function';
END $$;
