-- ============================================================================
-- Migration 110: Rewrite _internal_assert_admin to avoid auth schema access
-- ============================================================================
-- Purpose:
--   Migration 107 defined `mcp_api._internal_assert_admin()` as SECURITY
--   DEFINER (owner = mcp_owner) and called `auth.uid()` directly inside
--   the body. Postgres evaluates that reference under the function's
--   definer privileges (mcp_owner), and mcp_owner does NOT have USAGE on
--   the `auth` schema — that schema is owned by `supabase_admin` and
--   cannot be granted to mcp_owner from the migration runner role.
--
--   Result: every admin RPC fails with "permission denied for schema auth"
--   even for valid admins.
--
--   Fix: extract the user id from the JWT claims session GUC directly via
--   `current_setting('request.jwt.claims', true)`. That GUC is set by
--   PostgREST per request and reading it requires no schema access. We
--   then pass the extracted uuid to `public.is_admin(uuid)` (which is
--   SECURITY DEFINER as its own owner with auth.users access).
--
--   Postulate #0: this only modifies an mcp_api function body. No public.*
--   object is altered.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION mcp_api._internal_assert_admin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_claims_text TEXT;
    v_uid UUID;
BEGIN
    -- Read the JWT claims GUC. The (..., true) form returns NULL if unset
    -- instead of erroring, so unauthenticated calls produce a clean denial.
    v_claims_text := current_setting('request.jwt.claims', true);

    IF v_claims_text IS NULL OR v_claims_text = '' THEN
        RAISE EXCEPTION 'Access denied: not authenticated.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    BEGIN
        v_uid := ((v_claims_text)::jsonb ->> 'sub')::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Access denied: malformed authentication claims.'
            USING ERRCODE = 'insufficient_privilege';
    END;

    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Access denied: missing user identity.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT public.is_admin(v_uid) THEN
        RAISE EXCEPTION 'Access denied: admin privileges required.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END;
$$;

ALTER FUNCTION mcp_api._internal_assert_admin() OWNER TO mcp_owner;

COMMIT;
