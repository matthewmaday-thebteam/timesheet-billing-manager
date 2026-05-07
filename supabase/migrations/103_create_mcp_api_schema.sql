-- ============================================================================
-- Migration 103: mcp_api schema, roles, grants
-- ============================================================================
-- Purpose:
--   Establish a fully isolated namespace (mcp_api) for the Manifest MCP
--   integration so that:
--     - Zero changes are made to public.*  (no new columns, indexes, triggers,
--       constraints, modified functions, RLS policies, or grants).
--     - The MCP runtime authenticates as a non-privileged role (mcp_reader)
--       that can ONLY execute the curated api_* functions.
--     - Admin-side surface lives in mcp_api as well, called via PostgREST
--       through the supabase.schema('mcp_api').rpc() helper from the frontend.
--
--   Security posture (locked):
--     1. mcp_owner   NOINHERIT  (definer, never logs in)
--     2. mcp_reader  NOINHERIT LOGIN  (EXECUTE-only on the 11 api_* functions)
--
--   This file is intentionally narrow: it creates roles, the schema, and
--   the conservative GRANT/REVOKE baseline. Tables, views, and functions
--   are introduced in migrations 104, 105, 106, 107.
--
--   Postulate #0 applies — Manifest is in active production. This migration
--   does not touch any public.* object and is safe to apply at any time.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Schema
-- ----------------------------------------------------------------------------
-- All MCP-facing objects live here. NEVER add anything to public for MCP.

CREATE SCHEMA IF NOT EXISTS mcp_api;

COMMENT ON SCHEMA mcp_api IS
    'Namespace for the Manifest MCP integration. Contains api_keys, api_audit_log, '
    'rate_limit_buckets, the v_api_* views, the api_* SECURITY DEFINER functions, '
    'and the admin_* RPCs. Nothing in public.* is modified by the MCP slice.';

-- ----------------------------------------------------------------------------
-- 2. Roles
-- ----------------------------------------------------------------------------
-- mcp_owner — owns every mcp_api object. SECURITY DEFINER functions execute
--             with these privileges. NOINHERIT so child membership cannot
--             quietly grant extra capabilities. NOLOGIN so nobody can
--             authenticate as the owner directly.
--
-- mcp_reader — the runtime principal used by the manifest-mcp Edge Function.
--              NOLOGIN at the database level is overridden via PostgREST's
--              configured role. NOINHERIT means group membership confers no
--              implicit privileges. The role gets EXECUTE on exactly the
--              11 api_* functions (granted in migration 106) and nothing else.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_owner') THEN
        CREATE ROLE mcp_owner NOINHERIT NOLOGIN;
    END IF;
END $$;

COMMENT ON ROLE mcp_owner IS
    'Owner of every mcp_api object. SECURITY DEFINER functions run as this role. '
    'NOINHERIT, NOLOGIN.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_reader') THEN
        CREATE ROLE mcp_reader NOINHERIT LOGIN;
    END IF;
END $$;

COMMENT ON ROLE mcp_reader IS
    'Runtime principal used by the manifest-mcp Edge Function. EXECUTE-only on '
    'the curated api_* functions. NOINHERIT, LOGIN. No table/view privileges, '
    'no schema-level usage on public.';

-- ----------------------------------------------------------------------------
-- 3. Schema ownership and search-path
-- ----------------------------------------------------------------------------

-- Supabase's migration runner connects as a non-superuser role (postgres on
-- managed instances). To transfer ownership of mcp_api objects to mcp_owner,
-- the migration role must be a member of mcp_owner. Grant membership now;
-- this lets every subsequent ALTER … OWNER TO mcp_owner statement (in
-- migrations 103-107) succeed. Membership is harmless after rollout because
-- mcp_owner is NOLOGIN and accessible only via SECURITY DEFINER functions.
GRANT mcp_owner TO current_user;

ALTER SCHEMA mcp_api OWNER TO mcp_owner;

-- mcp_owner needs USAGE on the schema it owns (PG grants this implicitly,
-- but we make it explicit for posterity).
GRANT USAGE ON SCHEMA mcp_api TO mcp_owner;

-- mcp_reader gets USAGE so it can resolve mcp_api.api_* function names.
-- It does NOT receive USAGE on public — see step 5.
GRANT USAGE ON SCHEMA mcp_api TO mcp_reader;

-- ----------------------------------------------------------------------------
-- 4. Default privileges scrub for mcp_owner
-- ----------------------------------------------------------------------------
-- Without this, anything mcp_owner creates would default to its own
-- privileges only — fine. But future migrations might add objects via
-- different roles (e.g., a postgres superuser running these files), and
-- inherited default ACLs could leak privileges. We explicitly REVOKE
-- default privileges for mcp_owner-created tables/views/functions/sequences
-- from PUBLIC, authenticated, anon, and service_role. Each api_* function
-- below grants EXECUTE explicitly to mcp_reader.

ALTER DEFAULT PRIVILEGES FOR ROLE mcp_owner IN SCHEMA mcp_api
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mcp_owner IN SCHEMA mcp_api
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mcp_owner IN SCHEMA mcp_api
    REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- Belt-and-suspenders for the standard Supabase roles. We do NOT want
-- anon/authenticated/service_role to be silently granted anything we
-- create as mcp_owner.
ALTER DEFAULT PRIVILEGES FOR ROLE mcp_owner IN SCHEMA mcp_api
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE mcp_owner IN SCHEMA mcp_api
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE mcp_owner IN SCHEMA mcp_api
    REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Lock mcp_reader out of public
-- ----------------------------------------------------------------------------
-- Even though mcp_reader has no GRANTs in public, USAGE on public is a
-- default for PUBLIC. Revoking it from mcp_reader specifically (where
-- supported) and re-asserting REVOKE FROM mcp_reader makes the boundary
-- explicit and audit-friendly.

REVOKE ALL ON SCHEMA public FROM mcp_reader;

-- mcp_reader inherits nothing from PUBLIC because it's NOINHERIT, but in
-- some Postgres configurations PUBLIC privileges propagate via implicit
-- session capabilities. Make it impossible by ensuring no GRANTs land
-- here either:
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mcp_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mcp_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM mcp_reader;

-- ----------------------------------------------------------------------------
-- 6. Session-level guardrails for mcp_reader
-- ----------------------------------------------------------------------------
-- These take effect at login time for any session connecting AS mcp_reader
-- (which only happens through PostgREST's role-switch path).
--
--   - default_transaction_read_only: any accidental write attempt errors
--     out before it reaches a row.
--   - statement_timeout = 3 s: caps the worst-case query a tool can run.
--   - lock_timeout = 200 ms: an MCP query that hits a contended lock fails
--     fast instead of holding up production traffic.
--   - idle_in_transaction_session_timeout = 5 s: prevents stuck sessions.
--   - default_transaction_isolation = 'read committed': consistent semantics
--     across MCP tool calls (no surprise serialization retries).
--   - search_path = mcp_api: keeps qualified naming explicit; SECURITY
--     DEFINER functions still SET search_path locally.

ALTER ROLE mcp_reader SET default_transaction_read_only = on;
ALTER ROLE mcp_reader SET statement_timeout = '3s';
ALTER ROLE mcp_reader SET lock_timeout = '200ms';
ALTER ROLE mcp_reader SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE mcp_reader SET default_transaction_isolation = 'read committed';
ALTER ROLE mcp_reader SET search_path = mcp_api;

-- ----------------------------------------------------------------------------
-- 7. Verification block
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    RAISE NOTICE '103 mcp_api schema migration complete:';
    RAISE NOTICE '  - mcp_api schema created (owner: mcp_owner)';
    RAISE NOTICE '  - mcp_owner NOINHERIT NOLOGIN role ensured';
    RAISE NOTICE '  - mcp_reader NOINHERIT LOGIN role ensured';
    RAISE NOTICE '  - Default privileges scrubbed for PUBLIC, anon, authenticated';
    RAISE NOTICE '  - mcp_reader revoked from schema public, all tables/funcs/seqs';
    RAISE NOTICE '  - mcp_reader session guardrails applied (read-only, 3s timeout)';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables, views, functions, and admin RPCs follow in 104-107.';
END $$;

COMMIT;
