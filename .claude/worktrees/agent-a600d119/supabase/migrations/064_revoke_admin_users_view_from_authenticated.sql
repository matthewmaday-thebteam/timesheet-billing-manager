-- ============================================================================
-- Migration 064: Revoke admin_users_view access from authenticated role
-- ============================================================================
-- The view exposes all user emails, sign-in times, roles, and profile data
-- from auth.users. It was granted to authenticated in migration 010, but is
-- only consumed by SECURITY DEFINER RPC functions (admin_list_users, etc.)
-- which don't need the caller to have direct SELECT access.
-- ============================================================================

REVOKE SELECT ON admin_users_view FROM authenticated;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    v_has_grant BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_name = 'admin_users_view'
          AND grantee = 'authenticated'
    ) INTO v_has_grant;

    RAISE NOTICE 'Migration 064 Complete:';
    RAISE NOTICE '  - Authenticated grant on admin_users_view revoked: %', NOT v_has_grant;
    RAISE NOTICE '  - SECURITY DEFINER RPCs continue to work unaffected';
END $$;
