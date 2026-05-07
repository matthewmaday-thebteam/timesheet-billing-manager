-- ============================================================================
-- Rollback for migration 103 — schema, roles, grants
-- ============================================================================
-- This is the LAST rollback to run (after 107, 106, 105, 104). Roles can
-- only be dropped when no objects are owned by them.
--
-- WARNING: dropping mcp_reader will sever any active PostgREST role-switch
-- pointing at it. Confirm the manifest-mcp Edge Function is offline before
-- running this rollback in production.
-- ============================================================================

BEGIN;

-- 1. Drop the schema (CASCADE catches any stragglers).
DROP SCHEMA IF EXISTS mcp_api CASCADE;

-- 1b. Revoke the membership granted in migration 103 so DROP ROLE mcp_owner
--     below cannot fail with a 'role has dependent privileges' error.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_owner') THEN
        EXECUTE format('REVOKE mcp_owner FROM %I', current_user);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- If the membership was never granted (e.g., manual rollout), ignore.
    NULL;
END $$;

-- 2. Reset role settings, then drop. Settings persist on the role
--    independently of the schema, and 'DROP ROLE' fails if any objects
--    in any schema are still owned by the role — by this point step 1 has
--    cleaned out everything we own.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_reader') THEN
        ALTER ROLE mcp_reader RESET ALL;
        DROP ROLE mcp_reader;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_owner') THEN
        ALTER ROLE mcp_owner RESET ALL;
        DROP ROLE mcp_owner;
    END IF;
END $$;

COMMIT;
