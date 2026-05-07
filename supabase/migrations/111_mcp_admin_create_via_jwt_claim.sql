-- ============================================================================
-- Migration 111: Rewrite admin_create_api_key to avoid auth.uid()
-- ============================================================================
-- Purpose:
--   Migration 107 declared `v_caller UUID := auth.uid();` in the variable
--   block of admin_create_api_key. As with 110/_internal_assert_admin, that
--   reference is evaluated under mcp_owner privileges (SECURITY DEFINER)
--   and fails with "permission denied for schema auth".
--
--   Fix: extract the user id from request.jwt.claims directly. We tolerate
--   NULL (unauthenticated) here because the explicit admin-gate call to
--   _internal_assert_admin() will reject the call with a clean error
--   before we get this far. Storing NULL in created_by would only happen
--   if somehow the gate is bypassed, which is impossible by design.
--
--   Postulate #0: this only modifies an mcp_api function body. No public.*
--   object is altered.
-- ============================================================================

BEGIN;

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
    v_id          UUID;
    v_claims_text TEXT;
    v_caller      UUID;
    v_row         mcp_api.api_keys%ROWTYPE;
BEGIN
    -- Admin gate first — also extracts the caller uid via JWT claim.
    PERFORM mcp_api._internal_assert_admin();

    -- Re-extract caller for created_by attribution. The gate already
    -- validated the claim, but we read it again here rather than thread
    -- it out of the gate to keep that helper's signature clean.
    v_claims_text := current_setting('request.jwt.claims', true);
    IF v_claims_text IS NOT NULL AND v_claims_text <> '' THEN
        BEGIN
            v_caller := ((v_claims_text)::jsonb ->> 'sub')::uuid;
        EXCEPTION WHEN OTHERS THEN
            v_caller := NULL;
        END;
    END IF;

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

COMMIT;
