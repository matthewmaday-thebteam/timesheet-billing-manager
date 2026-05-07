-- ============================================================================
-- Rollback for migration 111 — restore auth.uid() in admin_create_api_key
-- ============================================================================
-- Restores the migration 107 body. After rollback the create flow fails
-- with "permission denied for schema auth" until either USAGE on auth is
-- granted to mcp_owner (not possible from migration runner) or 111 is
-- re-applied.
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

COMMIT;
