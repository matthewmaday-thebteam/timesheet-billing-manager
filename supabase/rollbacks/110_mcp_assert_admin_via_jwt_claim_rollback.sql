-- ============================================================================
-- Rollback for migration 110 — restore auth.uid() form of assert_admin
-- ============================================================================
-- Restores the migration 107 body that calls `auth.uid()` directly. After
-- this rollback the admin RPCs will fail with "permission denied for schema
-- auth" until either USAGE on auth is granted to mcp_owner (not possible
-- from migration runner) or migration 110 is re-applied.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION mcp_api._internal_assert_admin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Access denied: admin privileges required.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END;
$$;

ALTER FUNCTION mcp_api._internal_assert_admin() OWNER TO mcp_owner;

COMMIT;
