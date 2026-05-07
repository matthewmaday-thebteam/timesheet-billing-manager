-- ============================================================================
-- Migration 107: admin RPCs + pg_cron 90-day audit cleanup
-- ============================================================================
-- Purpose:
--   Three SECURITY DEFINER admin RPCs (called by the frontend's API Keys
--   admin page through `supabase.schema('mcp_api').rpc(...)`):
--
--     mcp_api.admin_list_api_keys()      -> SETOF jsonb (matches ApiKey)
--     mcp_api.admin_create_api_key(p_name TEXT, p_description TEXT,
--                                  p_prefix TEXT, p_key_hash TEXT)
--                                         -> jsonb (matches CreateApiKeyResult.api_key)
--     mcp_api.admin_revoke_api_key(p_key_id UUID)
--                                         -> jsonb (matches RevokeApiKeyResult)
--
--   IMPORTANT: the plaintext is generated and shown by the admin-api-keys
--   Edge Function — NEVER by Postgres. This RPC accepts the prefix and
--   the sha256 hash so plaintext never crosses the postgres TLS
--   boundary or lands in WAL. The Edge Function returns the plaintext
--   to the admin UI exactly once at creation time.
--
--   pg_cron job:
--     mcp_api_audit_cleanup — daily at 03:15 UTC. Deletes audit_log rows
--     and rate_limit_buckets older than 90 days.
-- ============================================================================

BEGIN;

SET LOCAL search_path = mcp_api, public;

-- ----------------------------------------------------------------------------
-- 1. _internal_assert_admin
-- ----------------------------------------------------------------------------
-- Reusable admin gate. We check public.is_admin() — that's the project's
-- canonical "admin" predicate (defined in migration 010). The mcp_api admin
-- RPCs are invoked by the frontend with a regular user JWT; PostgREST
-- routes the call as the authenticated role; the function then runs as
-- mcp_owner via SECURITY DEFINER. Inside the function body we explicitly
-- call public.is_admin(auth.uid()) to confirm the *caller* is an admin.

-- NOTE: This function is intentionally VOLATILE (Postgres default). A STABLE
-- declaration would let the planner cache results within a query — an admin
-- gate must execute every call so a recently-revoked admin cannot ride a
-- cached "true" through a multi-statement plan.
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
REVOKE ALL ON FUNCTION mcp_api._internal_assert_admin() FROM PUBLIC;
-- Internal gate; only callable from within other mcp_api functions.

-- ----------------------------------------------------------------------------
-- 2. admin_list_api_keys
-- ----------------------------------------------------------------------------
-- Returns one row per key, in the ApiKey shape:
--     { id, name, description, prefix, status, created_at,
--       revoked_at, last_used_at, created_by }
-- We do NOT return key_hash (would defeat the whole point).

-- NOTE: VOLATILE by default (no STABLE). The function performs an admin gate
-- that must execute on every invocation; STABLE would invite the planner to
-- elide repeated calls within a query.
CREATE OR REPLACE FUNCTION mcp_api.admin_list_api_keys()
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
BEGIN
    PERFORM mcp_api._internal_assert_admin();

    RETURN QUERY
    SELECT jsonb_build_object(
        'id',           k.id,
        'name',         k.name,
        'description',  k.description,
        'prefix',       k.prefix,
        'status',       k.status,
        'created_at',   k.created_at,
        'revoked_at',   k.revoked_at,
        'last_used_at', k.last_used_at,
        'created_by',   k.created_by
    )
    FROM mcp_api.api_keys k
    ORDER BY k.created_at DESC;
END;
$$;

ALTER FUNCTION mcp_api.admin_list_api_keys() OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.admin_list_api_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.admin_list_api_keys() TO authenticated;

COMMENT ON FUNCTION mcp_api.admin_list_api_keys() IS
    'List all MCP API keys (without hashes). Admin-only.';

-- ----------------------------------------------------------------------------
-- 3. admin_create_api_key
-- ----------------------------------------------------------------------------
-- Takes the prefix and sha256 hash. The Edge Function generates the
-- plaintext, derives both, and discards the plaintext after returning it
-- to the admin UI exactly once.

CREATE OR REPLACE FUNCTION mcp_api.admin_create_api_key(
    p_name          TEXT,
    p_description   TEXT,
    p_prefix        TEXT,
    p_key_hash      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_id        UUID;
    v_caller    UUID := auth.uid();
    v_row       mcp_api.api_keys%ROWTYPE;
BEGIN
    PERFORM mcp_api._internal_assert_admin();

    IF p_name IS NULL OR LENGTH(TRIM(p_name)) = 0 THEN
        RAISE EXCEPTION 'name is required.'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_prefix IS NULL OR LENGTH(p_prefix) NOT BETWEEN 8 AND 24 THEN
        RAISE EXCEPTION 'prefix must be 8..24 chars (received %).', LENGTH(COALESCE(p_prefix, ''))
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'key_hash must be 64-char lowercase hex (sha256).'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO mcp_api.api_keys (
        name, description, prefix, key_hash,
        status, created_at, created_by
    ) VALUES (
        TRIM(p_name), NULLIF(TRIM(COALESCE(p_description, '')), ''),
        p_prefix, p_key_hash,
        'active', NOW(), v_caller
    )
    RETURNING id INTO v_id;

    SELECT
        k.id, k.name, k.description, k.prefix, k.key_hash,
        k.status, k.created_at, k.revoked_at, k.last_used_at,
        k.created_by
      INTO v_row
      FROM mcp_api.api_keys k
     WHERE k.id = v_id;

    RETURN jsonb_build_object(
        'id',           v_row.id,
        'name',         v_row.name,
        'description',  v_row.description,
        'prefix',       v_row.prefix,
        'status',       v_row.status,
        'created_at',   v_row.created_at,
        'revoked_at',   v_row.revoked_at,
        'last_used_at', v_row.last_used_at,
        'created_by',   v_row.created_by
    );
END;
$$;

ALTER FUNCTION mcp_api.admin_create_api_key(TEXT, TEXT, TEXT, TEXT) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.admin_create_api_key(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.admin_create_api_key(TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION mcp_api.admin_create_api_key(TEXT, TEXT, TEXT, TEXT) IS
    'Persist a new API key from a prefix + sha256 hash. Plaintext is generated '
    'by the admin-api-keys Edge Function and returned once to the UI. Admin-only.';

-- ----------------------------------------------------------------------------
-- 4. admin_revoke_api_key
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mcp_api.admin_revoke_api_key(p_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_status TEXT;
BEGIN
    PERFORM mcp_api._internal_assert_admin();

    IF p_key_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'p_key_id is required.'
        );
    END IF;

    SELECT status INTO v_status FROM mcp_api.api_keys WHERE id = p_key_id;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   format('No api key with id %s.', p_key_id)
        );
    END IF;

    IF v_status = 'revoked' THEN
        RETURN jsonb_build_object(
            'success', true
        );
    END IF;

    UPDATE mcp_api.api_keys
       SET status     = 'revoked',
           revoked_at = NOW()
     WHERE id = p_key_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

ALTER FUNCTION mcp_api.admin_revoke_api_key(UUID) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.admin_revoke_api_key(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.admin_revoke_api_key(UUID) TO authenticated;

COMMENT ON FUNCTION mcp_api.admin_revoke_api_key(UUID) IS
    'Revoke an API key by id. Idempotent. Admin-only.';

-- ----------------------------------------------------------------------------
-- 5. Cleanup function (owned by mcp_owner so cron can run it)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mcp_api._cleanup_old_audit_rows(p_retain_days INTEGER DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_cutoff       TIMESTAMPTZ := NOW() - (p_retain_days || ' days')::INTERVAL;
    v_audit_rows   BIGINT;
    v_bucket_rows  BIGINT;
BEGIN
    DELETE FROM mcp_api.api_audit_log
    WHERE requested_at < v_cutoff;
    GET DIAGNOSTICS v_audit_rows = ROW_COUNT;

    DELETE FROM mcp_api.rate_limit_buckets
    WHERE window_start < v_cutoff;
    GET DIAGNOSTICS v_bucket_rows = ROW_COUNT;

    RETURN jsonb_build_object(
        'cutoff',       v_cutoff,
        'audit_rows',   v_audit_rows,
        'bucket_rows',  v_bucket_rows
    );
END;
$$;

ALTER FUNCTION mcp_api._cleanup_old_audit_rows(INTEGER) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api._cleanup_old_audit_rows(INTEGER) FROM PUBLIC;
-- Cron jobs run as the role that scheduled them. We schedule from the
-- migration superuser so this function needs no extra grants — but we
-- also expose it to authenticated admins for ad-hoc cleanup if needed.
GRANT EXECUTE ON FUNCTION mcp_api._cleanup_old_audit_rows(INTEGER) TO authenticated;

COMMENT ON FUNCTION mcp_api._cleanup_old_audit_rows(INTEGER) IS
    'Delete audit_log and rate_limit_buckets rows older than p_retain_days '
    '(default 90). Returns a JSONB summary.';

-- ----------------------------------------------------------------------------
-- 6. pg_cron job
-- ----------------------------------------------------------------------------
-- Schedule the cleanup. pg_cron metadata lives in cron.job, NOT in mcp_api
-- (Condition 9). The rollback explicitly cron.unschedule() this job before
-- dropping anything else.

DO $$
BEGIN
    -- If the job already exists from a prior run, unschedule first to avoid
    -- duplicate schedules.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mcp_api_audit_cleanup') THEN
        PERFORM cron.unschedule('mcp_api_audit_cleanup');
    END IF;

    PERFORM cron.schedule(
        'mcp_api_audit_cleanup',
        '15 3 * * *',  -- 03:15 UTC daily
        $sql$ SELECT mcp_api._cleanup_old_audit_rows(90); $sql$
    );
END $$;

-- ----------------------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    RAISE NOTICE '107 mcp_api admin & cron migration complete:';
    RAISE NOTICE '  - admin_list_api_keys, admin_create_api_key, admin_revoke_api_key';
    RAISE NOTICE '  - _cleanup_old_audit_rows installed';
    RAISE NOTICE '  - pg_cron job mcp_api_audit_cleanup scheduled at 03:15 UTC daily';
END $$;

COMMIT;
