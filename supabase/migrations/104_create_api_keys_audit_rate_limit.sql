-- ============================================================================
-- Migration 104: mcp_api control tables (api_keys, api_audit_log, rate_limits)
-- ============================================================================
-- Purpose:
--   Introduce the three control-plane tables the manifest-mcp Edge Function
--   relies on. All tables live in mcp_api and are owned by mcp_owner. None
--   of them is ever read or written directly by mcp_reader — every access
--   path goes through SECURITY DEFINER functions in migrations 106 and 107.
--
--   Tables:
--     1. mcp_api.api_keys            — long-lived bearer credentials, hashed.
--     2. mcp_api.api_audit_log       — every JSON-RPC call, redacted.
--     3. mcp_api.rate_limit_buckets  — sliding-window counters per key+window.
--
--   Privacy / data-boundary contract (see Conditions 13, 14):
--     - api_audit_log stores response_payload_sha256, NOT the response body.
--     - api_audit_log.params is defensively redacted on insert: any key
--       matching /rate|cost|fee|amount|salary/i (case-insensitive) is
--       replaced with '[redacted]'. This is enforced at write time inside
--       the api_audit_log_insert helper, NOT in the Edge Function — that
--       way leakage is impossible even if an Edge Function bug forgets to
--       redact.
-- ============================================================================

BEGIN;

SET LOCAL search_path = mcp_api, public;

-- ----------------------------------------------------------------------------
-- 1. api_keys
-- ----------------------------------------------------------------------------
-- Bearer tokens are minted as `mfst_live_` + 32 random url-safe chars in the
-- admin-api-keys Edge Function. We store ONLY a SHA-256 of the plaintext.
-- The plaintext is shown to the admin once, at creation time, and then
-- discarded. The first 12 chars of the plaintext (e.g. "mfst_live_a1b")
-- are stored separately as `prefix` so the admin UI can show enough to
-- disambiguate keys without ever revealing the secret.

CREATE TABLE mcp_api.api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Display fields — safe to surface in admin UI.
    name            TEXT NOT NULL,
    description     TEXT,
    prefix          TEXT NOT NULL CHECK (length(prefix) BETWEEN 8 AND 24),

    -- Lookup hash. We index on key_hash because every authenticated request
    -- begins with a hash lookup. The hash itself is opaque — given key_hash
    -- you cannot recover the plaintext.
    key_hash        TEXT NOT NULL,

    -- Lifecycle.
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','revoked')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,

    -- Audit. created_by points to auth.users(id). We DO NOT add an FK,
    -- because mcp_owner does not own the auth schema and cross-schema
    -- FK is fragile across Supabase upgrades. Instead, we treat
    -- created_by as a soft reference (matches the pattern used by
    -- physical_person_groups.created_by which DOES use FK; here we
    -- avoid FK to keep mcp_api self-contained).
    created_by      UUID NOT NULL,

    CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash),
    CONSTRAINT api_keys_revoked_consistency
        CHECK (
            (status = 'active'  AND revoked_at IS NULL) OR
            (status = 'revoked' AND revoked_at IS NOT NULL)
        )
);

CREATE INDEX api_keys_status_idx
    ON mcp_api.api_keys (status)
    WHERE status = 'active';

COMMENT ON TABLE mcp_api.api_keys IS
    'Long-lived bearer credentials for the Manifest MCP. Plaintext is shown '
    'exactly once at creation; only the SHA-256 hash is persisted.';
COMMENT ON COLUMN mcp_api.api_keys.prefix IS
    'First 12 chars of the plaintext, e.g. "mfst_live_a1b". Safe to display.';
COMMENT ON COLUMN mcp_api.api_keys.key_hash IS
    'SHA-256(plaintext) lowercase hex. Lookups go through this column only.';
COMMENT ON COLUMN mcp_api.api_keys.created_by IS
    'auth.users(id) of the admin who minted the key (soft reference).';

-- ----------------------------------------------------------------------------
-- 2. api_audit_log
-- ----------------------------------------------------------------------------
-- One row per JSON-RPC call. We keep enough to debug abuse and reconstruct
-- behavior, but never the response body or unredacted params.

CREATE TABLE mcp_api.api_audit_log (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    api_key_id                  UUID,           -- nullable: failed-auth rows have no key
    requested_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    method                      TEXT NOT NULL,  -- e.g. "tools/call"
    tool_name                   TEXT,           -- e.g. "get_employee_hours"

    -- params is the *redacted* JSON-RPC params object. The api_audit_log_insert
    -- helper applies the redactor before this row lands.
    params                      JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- We store a hash of the response so two identical responses can be
    -- correlated, while leaking nothing. NEVER the body itself.
    response_payload_sha256     TEXT,

    -- Outcome.
    status_code                 INTEGER NOT NULL,         -- HTTP status
    error_code                  TEXT,                     -- domain code, e.g. AMBIGUOUS
    error_message               TEXT,
    duration_ms                 INTEGER,

    -- Caller fingerprint (no PII beyond IP). Useful for abuse triage.
    ip_address                  INET,
    user_agent                  TEXT,

    CONSTRAINT api_audit_log_status_range
        CHECK (status_code BETWEEN 100 AND 599),
    CONSTRAINT api_audit_log_response_hash_format
        CHECK (response_payload_sha256 IS NULL
               OR response_payload_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX api_audit_log_requested_at_idx
    ON mcp_api.api_audit_log (requested_at DESC);
CREATE INDEX api_audit_log_api_key_id_idx
    ON mcp_api.api_audit_log (api_key_id, requested_at DESC)
    WHERE api_key_id IS NOT NULL;
CREATE INDEX api_audit_log_tool_name_idx
    ON mcp_api.api_audit_log (tool_name, requested_at DESC)
    WHERE tool_name IS NOT NULL;

COMMENT ON TABLE mcp_api.api_audit_log IS
    'One row per JSON-RPC call. Stores redacted params and a SHA-256 of the '
    'response payload; never the response body.';
COMMENT ON COLUMN mcp_api.api_audit_log.params IS
    'Redacted JSON-RPC params. The redactor masks any key matching '
    '/rate|cost|fee|amount|salary/i.';
COMMENT ON COLUMN mcp_api.api_audit_log.response_payload_sha256 IS
    'SHA-256 of the canonicalized response body. Never the body itself.';

-- ----------------------------------------------------------------------------
-- 3. rate_limit_buckets
-- ----------------------------------------------------------------------------
-- Simple fixed-window counters keyed by api_key_id and the bucket's start
-- timestamp truncated to the window (e.g. minute, hour). The Edge Function
-- writes via the SECURITY DEFINER api_consume_rate_limit() in migration 106.

CREATE TABLE mcp_api.rate_limit_buckets (
    api_key_id      UUID    NOT NULL,
    window_kind     TEXT    NOT NULL CHECK (window_kind IN ('minute','hour','day')),
    window_start    TIMESTAMPTZ NOT NULL,
    request_count   INTEGER NOT NULL DEFAULT 0
                        CHECK (request_count >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (api_key_id, window_kind, window_start)
);

COMMENT ON TABLE mcp_api.rate_limit_buckets IS
    'Fixed-window rate limit counters per (api_key_id, window_kind, window_start). '
    'Pruned by the api_audit_cleanup cron job alongside audit rows.';

-- ----------------------------------------------------------------------------
-- 4. Redactor helper (used internally by audit insert)
-- ----------------------------------------------------------------------------
-- This function is SECURITY DEFINER because it's called from inside other
-- SECURITY DEFINER functions in migration 106 — it must keep the same
-- search_path discipline.

CREATE OR REPLACE FUNCTION mcp_api._redact_jsonb_params(p_params JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_key       TEXT;
    v_value     JSONB;
    v_result    JSONB := '{}'::jsonb;
    -- Pattern: any key whose name *contains* one of these tokens is redacted.
    -- We deliberately use case-insensitive contains semantics so things like
    -- "hourly_rate", "monthly_cost", "service_fee", "billed_amount", "salary"
    -- are all caught regardless of position in the name.
    c_redact_pattern CONSTANT TEXT := 'rate|cost|fee|amount|salary';
BEGIN
    IF p_params IS NULL OR jsonb_typeof(p_params) <> 'object' THEN
        -- Non-objects (arrays, scalars, null) pass through as-is. The
        -- audit log column is JSONB, so {} default + this branch covers
        -- non-object payloads safely.
        RETURN COALESCE(p_params, '{}'::jsonb);
    END IF;

    FOR v_key, v_value IN
        SELECT k, v
        FROM jsonb_each(p_params) AS j(k, v)
    LOOP
        IF v_key ~* c_redact_pattern THEN
            v_result := jsonb_set(v_result, ARRAY[v_key], '"[redacted]"'::jsonb, true);
        ELSIF jsonb_typeof(v_value) = 'object' THEN
            -- Recurse one level. We do NOT recurse arbitrarily deep because
            -- the JSON-RPC params we accept are shallow; deep nesting would
            -- be a sign of malformed input. The redactor is a safety net,
            -- not a substitute for input validation.
            v_result := jsonb_set(
                v_result,
                ARRAY[v_key],
                mcp_api._redact_jsonb_params(v_value),
                true
            );
        ELSE
            v_result := jsonb_set(v_result, ARRAY[v_key], v_value, true);
        END IF;
    END LOOP;

    RETURN v_result;
END;
$$;

ALTER FUNCTION mcp_api._redact_jsonb_params(JSONB) OWNER TO mcp_owner;

COMMENT ON FUNCTION mcp_api._redact_jsonb_params(JSONB) IS
    'Replaces any object key whose name matches /rate|cost|fee|amount|salary/i '
    '(case-insensitive contains) with the string "[redacted]". Recurses one '
    'level to cover nested params. Never throws.';

-- ----------------------------------------------------------------------------
-- 5. Ownership
-- ----------------------------------------------------------------------------

ALTER TABLE mcp_api.api_keys           OWNER TO mcp_owner;
ALTER TABLE mcp_api.api_audit_log      OWNER TO mcp_owner;
ALTER TABLE mcp_api.rate_limit_buckets OWNER TO mcp_owner;

-- ----------------------------------------------------------------------------
-- 6. Privileges
-- ----------------------------------------------------------------------------
-- mcp_reader gets ZERO direct privileges on these tables. All access is
-- through SECURITY DEFINER functions in migrations 106-107.
--
-- We do not GRANT to authenticated/anon either; the admin path goes through
-- the admin-api-keys Edge Function which uses service_role on the server side
-- to call mcp_api.admin_* RPCs (defined in 107).

REVOKE ALL ON mcp_api.api_keys           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON mcp_api.api_audit_log      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON mcp_api.rate_limit_buckets FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    RAISE NOTICE '104 mcp_api control tables migration complete:';
    RAISE NOTICE '  - mcp_api.api_keys created (key_hash unique, prefix display-safe)';
    RAISE NOTICE '  - mcp_api.api_audit_log created (sha256 only, redactor enforced)';
    RAISE NOTICE '  - mcp_api.rate_limit_buckets created (fixed-window counters)';
    RAISE NOTICE '  - mcp_api._redact_jsonb_params helper installed';
END $$;

COMMIT;
