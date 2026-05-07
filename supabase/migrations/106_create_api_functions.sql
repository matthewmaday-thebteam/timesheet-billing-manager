-- ============================================================================
-- Migration 106: 11 mcp_api.api_* tools + auth helpers + rate-limit helper
-- ============================================================================
-- Purpose:
--   Define the 11 SECURITY DEFINER functions that back the MCP tool
--   contract, plus three SECURITY DEFINER helpers that the manifest-mcp
--   Edge Function calls during request handling:
--
--     mcp_api.api_authenticate_key(p_token_hash TEXT)
--     mcp_api.api_consume_rate_limit(p_api_key_id UUID,
--                                    p_window_kind TEXT,
--                                    p_max_requests INTEGER)
--     mcp_api.api_log_request(...)
--
--     -- 11 tools:
--     mcp_api.api_list_employees()
--     mcp_api.api_list_projects()
--     mcp_api.api_list_companies()
--     mcp_api.api_resolve_employee(p_query TEXT)
--     mcp_api.api_resolve_project(p_query TEXT, p_client_hint TEXT)
--     mcp_api.api_resolve_date_range(p_phrase TEXT, p_reference_date DATE)
--     mcp_api.api_get_employee_hours(p_canonical_employee_id UUID,
--                                    p_start_date DATE, p_end_date DATE,
--                                    p_granularity TEXT)
--     mcp_api.api_get_employee_week_summary(p_canonical_employee_id UUID,
--                                           p_week_start_date DATE)
--     mcp_api.api_get_employee_projects(p_canonical_employee_id UUID,
--                                       p_start_date DATE, p_end_date DATE)
--     mcp_api.api_get_employee_time_off(p_canonical_employee_id UUID,
--                                       p_start_date DATE, p_end_date DATE)
--     mcp_api.api_verify_employee_week(p_canonical_employee_id UUID,
--                                      p_week_start_date DATE,
--                                      p_expected_hours NUMERIC)
--
--   Locked invariants enforced by every api_* function:
--     - SECURITY DEFINER + SET search_path = mcp_api, pg_temp (Condition 3, 15)
--     - Owned by mcp_owner; EXECUTE granted to mcp_reader only.
--     - Returns a single JSONB envelope:
--           { ok: true,  data: <object|array>, provenance: {...} }
--         | { ok: false, error: { code, message, candidates? } }
--     - Provenance contains ONLY the keys allowed by Condition 11/12:
--           source, computed_at, row_count, truncated,
--           canonical_employee_id?, period_start?, period_end?
--     - api_verify_employee_week receives expected_hours from the caller
--       and contains ZERO references to public.resources or its
--       expected_hours column (Condition 12).
-- ============================================================================

BEGIN;

SET LOCAL search_path = mcp_api, public;

-- ============================================================================
-- HELPER 1: api_authenticate_key
-- ============================================================================
-- Looks up an api_keys row by its sha256 hash. Returns the row's id, status,
-- prefix, and last_used_at, AND updates last_used_at as a side effect when
-- the key is active. Returns NULL row when there's no match.
--
-- Why a SECURITY DEFINER function instead of a direct SELECT? Because
-- mcp_reader has no privileges on api_keys (Condition 1). Auth must go
-- through this single funnel.

CREATE OR REPLACE FUNCTION mcp_api.api_authenticate_key(p_token_hash TEXT)
RETURNS TABLE (
    api_key_id  UUID,
    status      TEXT,
    prefix      TEXT,
    name        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
BEGIN
    -- Defensive: token hash is 64-char lowercase hex (sha256). Short-circuit
    -- malformed lookups before touching the index.
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE mcp_api.api_keys k
       SET last_used_at = NOW()
     WHERE k.key_hash = p_token_hash
       AND k.status = 'active'
    RETURNING k.id, k.status, k.prefix, k.name;

    -- If the key existed but is revoked, the UPDATE above returned 0 rows.
    -- Return the revoked row so the caller can distinguish "no such key"
    -- from "key revoked".
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT k.id, k.status, k.prefix, k.name
          FROM mcp_api.api_keys k
         WHERE k.key_hash = p_token_hash;
    END IF;
END;
$$;

ALTER FUNCTION mcp_api.api_authenticate_key(TEXT) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_authenticate_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_authenticate_key(TEXT) TO mcp_reader;

COMMENT ON FUNCTION mcp_api.api_authenticate_key(TEXT) IS
    'Authenticate a bearer token by its sha256 hash. Side effect: bumps '
    'last_used_at when active. Returns up to one row.';

-- ============================================================================
-- HELPER 2: api_consume_rate_limit
-- ============================================================================
-- Atomically increments the (api_key_id, window_kind, window_start) bucket
-- and returns whether the request is allowed. Window start is computed
-- inside the function so callers cannot drift it.
--
-- Returns:
--   { allowed: bool, count: int, limit: int, window_kind: text, window_start: timestamptz, retry_after_ms: int|null }

CREATE OR REPLACE FUNCTION mcp_api.api_consume_rate_limit(
    p_api_key_id    UUID,
    p_window_kind   TEXT,
    p_max_requests  INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_window_start  TIMESTAMPTZ;
    v_count         INTEGER;
    v_allowed       BOOLEAN;
    v_retry_ms      INTEGER;
BEGIN
    IF p_api_key_id IS NULL OR p_max_requests IS NULL OR p_max_requests <= 0 THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'count', 0,
            'limit', COALESCE(p_max_requests, 0),
            'window_kind', p_window_kind,
            'window_start', NULL,
            'retry_after_ms', NULL
        );
    END IF;

    v_window_start := CASE p_window_kind
        WHEN 'minute' THEN date_trunc('minute', NOW())
        WHEN 'hour'   THEN date_trunc('hour',   NOW())
        WHEN 'day'    THEN date_trunc('day',    NOW())
        ELSE NULL
    END;

    IF v_window_start IS NULL THEN
        RAISE EXCEPTION 'Invalid window_kind: %. Must be minute|hour|day.', p_window_kind
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO mcp_api.rate_limit_buckets (
        api_key_id, window_kind, window_start, request_count, updated_at
    )
    VALUES (
        p_api_key_id, p_window_kind, v_window_start, 1, NOW()
    )
    ON CONFLICT (api_key_id, window_kind, window_start) DO UPDATE
        SET request_count = mcp_api.rate_limit_buckets.request_count + 1,
            updated_at = NOW()
    RETURNING request_count INTO v_count;

    v_allowed := v_count <= p_max_requests;

    -- Time until the window rolls over, in ms. Useful for Retry-After.
    v_retry_ms := CASE WHEN v_allowed THEN NULL
        ELSE GREATEST(
            0,
            EXTRACT(EPOCH FROM (
                v_window_start + CASE p_window_kind
                    WHEN 'minute' THEN INTERVAL '1 minute'
                    WHEN 'hour'   THEN INTERVAL '1 hour'
                    WHEN 'day'    THEN INTERVAL '1 day'
                END
                - NOW()
            ))::INTEGER * 1000
        )
    END;

    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'count', v_count,
        'limit', p_max_requests,
        'window_kind', p_window_kind,
        'window_start', v_window_start,
        'retry_after_ms', v_retry_ms
    );
END;
$$;

ALTER FUNCTION mcp_api.api_consume_rate_limit(UUID, TEXT, INTEGER) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_consume_rate_limit(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_consume_rate_limit(UUID, TEXT, INTEGER) TO mcp_reader;

COMMENT ON FUNCTION mcp_api.api_consume_rate_limit(UUID, TEXT, INTEGER) IS
    'Atomically increments a (key, window) counter and returns whether the '
    'request is allowed.';

-- ============================================================================
-- HELPER 3: api_log_request
-- ============================================================================
-- Inserts an api_audit_log row. Always redacts params via _redact_jsonb_params.

CREATE OR REPLACE FUNCTION mcp_api.api_log_request(
    p_api_key_id                UUID,
    p_method                    TEXT,
    p_tool_name                 TEXT,
    p_params                    JSONB,
    p_response_payload_sha256   TEXT,
    p_status_code               INTEGER,
    p_error_code                TEXT,
    p_error_message             TEXT,
    p_duration_ms               INTEGER,
    p_ip_address                TEXT,
    p_user_agent                TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_id        BIGINT;
    v_inet      INET;
BEGIN
    BEGIN
        v_inet := p_ip_address::INET;
    EXCEPTION WHEN OTHERS THEN
        v_inet := NULL;
    END;

    INSERT INTO mcp_api.api_audit_log (
        api_key_id, method, tool_name, params,
        response_payload_sha256, status_code, error_code, error_message,
        duration_ms, ip_address, user_agent
    ) VALUES (
        p_api_key_id, p_method, p_tool_name,
        mcp_api._redact_jsonb_params(COALESCE(p_params, '{}'::jsonb)),
        p_response_payload_sha256, p_status_code, p_error_code, p_error_message,
        p_duration_ms, v_inet, p_user_agent
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

ALTER FUNCTION mcp_api.api_log_request(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT)
    OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_log_request(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_log_request(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT)
    TO mcp_reader;

COMMENT ON FUNCTION mcp_api.api_log_request(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT) IS
    'Insert one row into api_audit_log. Params are redacted at write time.';

-- ============================================================================
-- INTERNAL HELPER: _internal_aggregate_employee_hours
-- ============================================================================
-- Shared aggregation kernel used by api_get_employee_hours and friends. The
-- granularity controls grouping:
--   'day'   -> rows per work_date
--   'week'  -> rows per week_start (ISO Monday)
--   'month' -> rows per month_start
--   'total' -> single-row total
--
-- Returns a JSONB array of buckets: [{period_start, period_end, hours, ...}]

CREATE OR REPLACE FUNCTION mcp_api._internal_aggregate_employee_hours(
    p_canonical_employee_id UUID,
    p_start_date            DATE,
    p_end_date              DATE,
    p_granularity           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_buckets JSONB;
BEGIN
    IF p_granularity NOT IN ('day','week','month','total') THEN
        RAISE EXCEPTION 'Invalid granularity %', p_granularity
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_granularity = 'day' THEN
        SELECT COALESCE(jsonb_agg(b ORDER BY b->>'period_start'), '[]'::jsonb)
          INTO v_buckets
          FROM (
            SELECT jsonb_build_object(
                'period_start', d.work_date,
                'period_end',   d.work_date,
                'hours',        ROUND(SUM(d.rounded_hours)::numeric, 2)
            ) AS b
              FROM mcp_api.v_api_employee_daily d
             WHERE d.canonical_employee_id = p_canonical_employee_id
               AND d.work_date BETWEEN p_start_date AND p_end_date
             GROUP BY d.work_date
          ) s;
    ELSIF p_granularity = 'week' THEN
        SELECT COALESCE(jsonb_agg(b ORDER BY b->>'period_start'), '[]'::jsonb)
          INTO v_buckets
          FROM (
            SELECT jsonb_build_object(
                'period_start', date_trunc('week', d.work_date)::date,
                'period_end',   (date_trunc('week', d.work_date)::date + 6),
                'hours',        ROUND(SUM(d.rounded_hours)::numeric, 2)
            ) AS b
              FROM mcp_api.v_api_employee_daily d
             WHERE d.canonical_employee_id = p_canonical_employee_id
               AND d.work_date BETWEEN p_start_date AND p_end_date
             GROUP BY date_trunc('week', d.work_date)
          ) s;
    ELSIF p_granularity = 'month' THEN
        SELECT COALESCE(jsonb_agg(b ORDER BY b->>'period_start'), '[]'::jsonb)
          INTO v_buckets
          FROM (
            SELECT jsonb_build_object(
                'period_start', date_trunc('month', d.work_date)::date,
                'period_end',
                    (date_trunc('month', d.work_date) + INTERVAL '1 month - 1 day')::date,
                'hours', ROUND(SUM(d.rounded_hours)::numeric, 2)
            ) AS b
              FROM mcp_api.v_api_employee_daily d
             WHERE d.canonical_employee_id = p_canonical_employee_id
               AND d.work_date BETWEEN p_start_date AND p_end_date
             GROUP BY date_trunc('month', d.work_date)
          ) s;
    ELSE -- 'total'
        SELECT jsonb_build_array(jsonb_build_object(
            'period_start', p_start_date,
            'period_end',   p_end_date,
            'hours',        ROUND(COALESCE(SUM(d.rounded_hours), 0)::numeric, 2)
        ))
          INTO v_buckets
          FROM mcp_api.v_api_employee_daily d
         WHERE d.canonical_employee_id = p_canonical_employee_id
           AND d.work_date BETWEEN p_start_date AND p_end_date;
    END IF;

    RETURN COALESCE(v_buckets, '[]'::jsonb);
END;
$$;

ALTER FUNCTION mcp_api._internal_aggregate_employee_hours(UUID, DATE, DATE, TEXT)
    OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api._internal_aggregate_employee_hours(UUID, DATE, DATE, TEXT)
    FROM PUBLIC;
-- Internal: not granted to mcp_reader. Only api_* functions call it.

COMMENT ON FUNCTION mcp_api._internal_aggregate_employee_hours(UUID, DATE, DATE, TEXT) IS
    'Internal aggregation kernel for employee hours. Caller-only; not exposed.';

-- ============================================================================
-- TOOL 1: api_list_employees
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_api.api_list_employees()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_data      JSONB;
    v_count     INTEGER;
BEGIN
    SELECT
        COALESCE(jsonb_agg(e ORDER BY e->>'display_name'), '[]'::jsonb),
        COUNT(*)::INTEGER
      INTO v_data, v_count
      FROM (
        SELECT jsonb_build_object(
            'canonical_employee_id', ve.canonical_employee_id,
            'display_name',          ve.display_name,
            'employment_type',       ve.employment_type
        ) AS e
          FROM mcp_api.v_api_employees ve
      ) s;

    RETURN jsonb_build_object(
        'ok', true,
        'data', v_data,
        'provenance', jsonb_build_object(
            'source',      'v_api_employees',
            'computed_at', NOW(),
            'row_count',   v_count,
            'truncated',   false
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_list_employees() OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_list_employees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_list_employees() TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_list_employees() IS
    'List all canonical employees. No params. Hours/financial/PII excluded.';

-- ============================================================================
-- TOOL 2: api_list_projects
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_api.api_list_projects()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_data      JSONB;
    v_count     INTEGER;
BEGIN
    SELECT
        COALESCE(jsonb_agg(p ORDER BY p->>'project_name'), '[]'::jsonb),
        COUNT(*)::INTEGER
      INTO v_data, v_count
      FROM (
        SELECT jsonb_build_object(
            'canonical_project_id',  vp.canonical_project_id,
            'project_name',          vp.project_name,
            'canonical_company_id',  vp.canonical_company_id,
            'company_display_name',  vp.company_display_name
        ) AS p
          FROM mcp_api.v_api_projects vp
      ) s;

    RETURN jsonb_build_object(
        'ok', true,
        'data', v_data,
        'provenance', jsonb_build_object(
            'source',      'v_api_projects',
            'computed_at', NOW(),
            'row_count',   v_count,
            'truncated',   false
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_list_projects() OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_list_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_list_projects() TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_list_projects() IS
    'List all canonical projects with their canonical company.';

-- ============================================================================
-- TOOL 3: api_list_companies
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_api.api_list_companies()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_data      JSONB;
    v_count     INTEGER;
BEGIN
    SELECT
        COALESCE(jsonb_agg(c ORDER BY c->>'display_name'), '[]'::jsonb),
        COUNT(*)::INTEGER
      INTO v_data, v_count
      FROM (
        SELECT jsonb_build_object(
            'canonical_company_id', vc.canonical_company_id,
            'display_name',         vc.display_name
        ) AS c
          FROM mcp_api.v_api_companies vc
      ) s;

    RETURN jsonb_build_object(
        'ok', true,
        'data', v_data,
        'provenance', jsonb_build_object(
            'source',      'v_api_companies',
            'computed_at', NOW(),
            'row_count',   v_count,
            'truncated',   false
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_list_companies() OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_list_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_list_companies() TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_list_companies() IS
    'List all canonical companies.';

-- ============================================================================
-- TOOL 4: api_resolve_employee
-- ============================================================================
-- Free-text resolver. Strategy:
--   1. Exact case-insensitive match on display_name.
--   2. Otherwise, fuzzy match (ILIKE %query%) on display_name OR external_label.
--   3. If exactly one match: return data with the canonical id.
--   4. If multiple matches: return error code AMBIGUOUS with up to 5 candidates.
--   5. If no match: return error code NOT_FOUND.

CREATE OR REPLACE FUNCTION mcp_api.api_resolve_employee(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_query     TEXT := TRIM(COALESCE(p_query, ''));
    v_candidates JSONB;
    v_count     INTEGER;
    v_first     JSONB;
BEGIN
    IF v_query = '' THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'NOT_FOUND',
                'message', 'Empty query.'
            )
        );
    END IF;

    -- Pass 1: exact (case-insensitive) on display_name.
    SELECT
        COALESCE(jsonb_agg(c ORDER BY c->>'display_name'), '[]'::jsonb),
        COUNT(*)::INTEGER
      INTO v_candidates, v_count
      FROM (
        SELECT jsonb_build_object(
            'canonical_employee_id', ve.canonical_employee_id,
            'display_name',          ve.display_name
        ) AS c
          FROM mcp_api.v_api_employees ve
         WHERE LOWER(ve.display_name) = LOWER(v_query)
         LIMIT 6
      ) s;

    IF v_count = 0 THEN
        -- Pass 2: substring on display_name OR external_label.
        SELECT
            COALESCE(jsonb_agg(c ORDER BY c->>'display_name'), '[]'::jsonb),
            COUNT(*)::INTEGER
          INTO v_candidates, v_count
          FROM (
            SELECT jsonb_build_object(
                'canonical_employee_id', ve.canonical_employee_id,
                'display_name',          ve.display_name
            ) AS c
              FROM mcp_api.v_api_employees ve
             WHERE ve.display_name   ILIKE '%' || v_query || '%'
                OR ve.external_label ILIKE '%' || v_query || '%'
             LIMIT 6
          ) s;
    END IF;

    IF v_count = 0 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'NOT_FOUND',
                'message', format('No employee matched %L.', v_query)
            )
        );
    ELSIF v_count > 1 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'AMBIGUOUS',
                'message', format('%s candidates matched %L.', v_count, v_query),
                'candidates', v_candidates
            )
        );
    END IF;

    v_first := v_candidates->0;
    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'canonical_employee_id', v_first->>'canonical_employee_id',
            'display_name',          v_first->>'display_name'
        ),
        'provenance', jsonb_build_object(
            'source',      'v_api_employees',
            'computed_at', NOW(),
            'row_count',   1,
            'truncated',   false
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_resolve_employee(TEXT) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_resolve_employee(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_resolve_employee(TEXT) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_resolve_employee(TEXT) IS
    'Resolve a free-text query to a canonical employee id. Returns AMBIGUOUS '
    'with candidates when more than one match is found.';

-- ============================================================================
-- TOOL 5: api_resolve_project
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_api.api_resolve_project(
    p_query         TEXT,
    p_client_hint   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_query         TEXT := TRIM(COALESCE(p_query, ''));
    v_hint          TEXT := NULLIF(TRIM(COALESCE(p_client_hint, '')), '');
    v_candidates    JSONB;
    v_count         INTEGER;
    v_first         JSONB;
BEGIN
    IF v_query = '' THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'NOT_FOUND',
                'message', 'Empty query.'
            )
        );
    END IF;

    SELECT
        COALESCE(jsonb_agg(c ORDER BY c->>'project_name'), '[]'::jsonb),
        COUNT(*)::INTEGER
      INTO v_candidates, v_count
      FROM (
        SELECT jsonb_build_object(
            'canonical_project_id',  vp.canonical_project_id,
            'project_name',          vp.project_name,
            'canonical_company_id',  vp.canonical_company_id,
            'company_display_name',  vp.company_display_name
        ) AS c
          FROM mcp_api.v_api_projects vp
         WHERE vp.project_name ILIKE '%' || v_query || '%'
           AND (v_hint IS NULL OR vp.company_display_name ILIKE '%' || v_hint || '%')
         LIMIT 6
      ) s;

    IF v_count = 0 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'NOT_FOUND',
                'message', format('No project matched %L%s.',
                    v_query,
                    CASE WHEN v_hint IS NULL THEN ''
                         ELSE format(' with client hint %L', v_hint) END)
            )
        );
    ELSIF v_count > 1 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'AMBIGUOUS',
                'message', format('%s projects matched %L.', v_count, v_query),
                'candidates', v_candidates
            )
        );
    END IF;

    v_first := v_candidates->0;
    RETURN jsonb_build_object(
        'ok', true,
        'data', v_first,
        'provenance', jsonb_build_object(
            'source',      'v_api_projects',
            'computed_at', NOW(),
            'row_count',   1,
            'truncated',   false
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_resolve_project(TEXT, TEXT) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_resolve_project(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_resolve_project(TEXT, TEXT) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_resolve_project(TEXT, TEXT) IS
    'Resolve a free-text project query, optionally narrowed by a client hint.';

-- ============================================================================
-- TOOL 6: api_resolve_date_range
-- ============================================================================
-- Resolve common natural-language phrases ("last week", "this month",
-- "last 30 days", "yesterday", "today", "month-to-date", "last month",
-- "this year") to a {start_date, end_date} pair.
--
-- The reference_date defaults to current_date (UTC). Weeks start ISO Monday.

CREATE OR REPLACE FUNCTION mcp_api.api_resolve_date_range(
    p_phrase            TEXT,
    p_reference_date    DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_phrase    TEXT := LOWER(TRIM(COALESCE(p_phrase, '')));
    v_ref       DATE := COALESCE(p_reference_date, CURRENT_DATE);
    v_start     DATE;
    v_end       DATE;
    v_label     TEXT;
BEGIN
    -- Tolerate punctuation/whitespace variations.
    v_phrase := REGEXP_REPLACE(v_phrase, '[[:space:]]+', ' ', 'g');

    IF v_phrase IN ('today') THEN
        v_start := v_ref; v_end := v_ref; v_label := 'today';
    ELSIF v_phrase IN ('yesterday') THEN
        v_start := v_ref - 1; v_end := v_ref - 1; v_label := 'yesterday';
    ELSIF v_phrase IN ('this week', 'current week') THEN
        v_start := date_trunc('week', v_ref)::date;
        v_end   := v_start + 6;
        v_label := 'this week';
    ELSIF v_phrase IN ('last week', 'previous week') THEN
        v_start := (date_trunc('week', v_ref) - INTERVAL '7 days')::date;
        v_end   := v_start + 6;
        v_label := 'last week';
    ELSIF v_phrase IN ('this month', 'current month', 'month to date',
                       'month-to-date', 'mtd') THEN
        v_start := date_trunc('month', v_ref)::date;
        v_end   := v_ref;
        v_label := 'month to date';
    ELSIF v_phrase IN ('last month', 'previous month') THEN
        v_start := date_trunc('month', v_ref - INTERVAL '1 month')::date;
        v_end   := (date_trunc('month', v_ref)::date - 1);
        v_label := 'last month';
    ELSIF v_phrase IN ('last 7 days', 'past 7 days') THEN
        v_end := v_ref; v_start := v_ref - 6; v_label := 'last 7 days';
    ELSIF v_phrase IN ('last 14 days', 'past 14 days', 'past two weeks') THEN
        v_end := v_ref; v_start := v_ref - 13; v_label := 'last 14 days';
    ELSIF v_phrase IN ('last 30 days', 'past 30 days') THEN
        v_end := v_ref; v_start := v_ref - 29; v_label := 'last 30 days';
    ELSIF v_phrase IN ('last 90 days', 'past 90 days') THEN
        v_end := v_ref; v_start := v_ref - 89; v_label := 'last 90 days';
    ELSIF v_phrase IN ('this year', 'year to date', 'year-to-date', 'ytd') THEN
        v_start := date_trunc('year', v_ref)::date;
        v_end   := v_ref;
        v_label := 'year to date';
    ELSIF v_phrase IN ('last year', 'previous year') THEN
        v_start := date_trunc('year', v_ref - INTERVAL '1 year')::date;
        v_end   := (date_trunc('year', v_ref)::date - 1);
        v_label := 'last year';
    ELSE
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'INVALID_DATE',
                'message', format('Could not resolve date phrase %L.', p_phrase)
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'start_date', v_start,
            'end_date',   v_end,
            'label',      v_label,
            'reference_date', v_ref
        ),
        'provenance', jsonb_build_object(
            'source',       'api_resolve_date_range',
            'computed_at',  NOW(),
            'row_count',    1,
            'truncated',    false,
            'period_start', v_start,
            'period_end',   v_end
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_resolve_date_range(TEXT, DATE) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_resolve_date_range(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_resolve_date_range(TEXT, DATE) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_resolve_date_range(TEXT, DATE) IS
    'Resolve a natural-language date phrase to a (start_date, end_date) pair.';

-- ============================================================================
-- TOOL 7: api_get_employee_hours
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_api.api_get_employee_hours(
    p_canonical_employee_id UUID,
    p_start_date            DATE,
    p_end_date              DATE,
    p_granularity           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_buckets   JSONB;
    v_count     INTEGER;
    v_total     NUMERIC := 0;
BEGIN
    IF p_canonical_employee_id IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'NOT_FOUND',
                'message', 'canonical_employee_id is required.'
            )
        );
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'INVALID_DATE',
                'message', 'start_date and end_date are required and start must be <= end.'
            )
        );
    END IF;

    v_buckets := mcp_api._internal_aggregate_employee_hours(
        p_canonical_employee_id, p_start_date, p_end_date, p_granularity
    );

    SELECT COALESCE(SUM((b->>'hours')::numeric), 0)::numeric, jsonb_array_length(v_buckets)
      INTO v_total, v_count
      FROM jsonb_array_elements(v_buckets) AS b;

    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'granularity', p_granularity,
            'total_hours', ROUND(v_total, 2),
            'buckets',     v_buckets
        ),
        'provenance', jsonb_build_object(
            'source',                 'v_api_employee_daily',
            'computed_at',            NOW(),
            'row_count',              v_count,
            'truncated',              false,
            'canonical_employee_id',  p_canonical_employee_id,
            'period_start',           p_start_date,
            'period_end',             p_end_date
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_get_employee_hours(UUID, DATE, DATE, TEXT) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_get_employee_hours(UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_get_employee_hours(UUID, DATE, DATE, TEXT) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_get_employee_hours(UUID, DATE, DATE, TEXT) IS
    'Aggregated hours for a canonical employee over a date range, grouped by '
    'day|week|month|total. Hours only — no minutes, no entry/task counts.';

-- ============================================================================
-- TOOL 8: api_get_employee_week_summary
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_api.api_get_employee_week_summary(
    p_canonical_employee_id UUID,
    p_week_start_date       DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_week_start    DATE;
    v_week_end      DATE;
    v_per_day       JSONB;
    v_total_hours   NUMERIC := 0;
BEGIN
    IF p_canonical_employee_id IS NULL OR p_week_start_date IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'INVALID_DATE',
                'message', 'canonical_employee_id and week_start_date are required.'
            )
        );
    END IF;

    -- Snap to ISO Monday so callers passing a mid-week date still get a
    -- well-defined window.
    v_week_start := date_trunc('week', p_week_start_date)::date;
    v_week_end   := v_week_start + 6;

    v_per_day := mcp_api._internal_aggregate_employee_hours(
        p_canonical_employee_id, v_week_start, v_week_end, 'day'
    );

    SELECT COALESCE(SUM((b->>'hours')::numeric), 0)
      INTO v_total_hours
      FROM jsonb_array_elements(v_per_day) AS b;

    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'week_start',  v_week_start,
            'week_end',    v_week_end,
            'total_hours', ROUND(v_total_hours, 2),
            'per_day',     v_per_day
        ),
        'provenance', jsonb_build_object(
            'source',                'v_api_employee_daily',
            'computed_at',           NOW(),
            'row_count',             jsonb_array_length(v_per_day),
            'truncated',             false,
            'canonical_employee_id', p_canonical_employee_id,
            'period_start',          v_week_start,
            'period_end',            v_week_end
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_get_employee_week_summary(UUID, DATE) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_get_employee_week_summary(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_get_employee_week_summary(UUID, DATE) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_get_employee_week_summary(UUID, DATE) IS
    'Per-day hours plus the weekly total for one canonical employee.';

-- ============================================================================
-- TOOL 9: api_get_employee_projects
-- ============================================================================
-- Returns the canonical projects an employee touched in the date range, with
-- per-project hours. We DO NOT surface entry_count or task_count.

CREATE OR REPLACE FUNCTION mcp_api.api_get_employee_projects(
    p_canonical_employee_id UUID,
    p_start_date            DATE,
    p_end_date              DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_data      JSONB;
    v_count     INTEGER;
BEGIN
    IF p_canonical_employee_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL
        OR p_start_date > p_end_date THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'INVALID_DATE',
                'message', 'canonical_employee_id, start_date, end_date are required and start <= end.'
            )
        );
    END IF;

    -- Joining v_api_employee_daily on canonical_company_id to v_api_projects
    -- on canonical_company_id gives us the company-level breakdown. The MCP
    -- semantics treat "projects an employee touched" as the canonical company
    -- attribution — we deliberately do NOT join by project_id at this layer
    -- because employee_daily_totals is at (user_id, client_id, work_date)
    -- granularity, not project. We surface canonical_company_id alongside
    -- the project list so consumers understand the grouping unit.
    SELECT
        COALESCE(jsonb_agg(p ORDER BY (p->>'hours')::numeric DESC), '[]'::jsonb),
        COUNT(*)::INTEGER
      INTO v_data, v_count
      FROM (
        SELECT jsonb_build_object(
            'canonical_company_id', vc.canonical_company_id,
            'company_display_name', vc.display_name,
            'hours',                ROUND(SUM(d.rounded_hours)::numeric, 2)
        ) AS p
          FROM mcp_api.v_api_employee_daily d
          JOIN mcp_api.v_api_companies vc
            ON vc.canonical_company_id = d.canonical_company_id
         WHERE d.canonical_employee_id = p_canonical_employee_id
           AND d.work_date BETWEEN p_start_date AND p_end_date
         GROUP BY vc.canonical_company_id, vc.display_name
        HAVING SUM(d.rounded_hours) > 0
      ) s;

    RETURN jsonb_build_object(
        'ok', true,
        'data', v_data,
        'provenance', jsonb_build_object(
            'source',                'v_api_employee_daily',
            'computed_at',           NOW(),
            'row_count',             v_count,
            'truncated',             false,
            'canonical_employee_id', p_canonical_employee_id,
            'period_start',          p_start_date,
            'period_end',            p_end_date
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_get_employee_projects(UUID, DATE, DATE) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_get_employee_projects(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_get_employee_projects(UUID, DATE, DATE) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_get_employee_projects(UUID, DATE, DATE) IS
    'List canonical companies the employee touched in the range, with hours.';

-- ============================================================================
-- TOOL 10: api_get_employee_time_off
-- ============================================================================

CREATE OR REPLACE FUNCTION mcp_api.api_get_employee_time_off(
    p_canonical_employee_id UUID,
    p_start_date            DATE,
    p_end_date              DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_data      JSONB;
    v_count     INTEGER;
BEGIN
    IF p_canonical_employee_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL
        OR p_start_date > p_end_date THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'INVALID_DATE',
                'message', 'canonical_employee_id, start_date, end_date are required and start <= end.'
            )
        );
    END IF;

    SELECT
        COALESCE(jsonb_agg(t ORDER BY t->>'start_date'), '[]'::jsonb),
        COUNT(*)::INTEGER
      INTO v_data, v_count
      FROM (
        SELECT jsonb_build_object(
            'start_date',     to_jsonb(eto.start_date),
            'end_date',       to_jsonb(eto.end_date),
            'total_days',     to_jsonb(eto.total_days),
            'time_off_type',  to_jsonb(eto.time_off_type)
        ) AS t
          FROM mcp_api.v_api_employee_time_off eto
         WHERE eto.canonical_employee_id = p_canonical_employee_id
           AND eto.start_date <= p_end_date
           AND eto.end_date   >= p_start_date
      ) s;

    RETURN jsonb_build_object(
        'ok', true,
        'data', v_data,
        'provenance', jsonb_build_object(
            'source',                'v_api_employee_time_off',
            'computed_at',           NOW(),
            'row_count',             v_count,
            'truncated',             false,
            'canonical_employee_id', p_canonical_employee_id,
            'period_start',          p_start_date,
            'period_end',            p_end_date
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_get_employee_time_off(UUID, DATE, DATE) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_get_employee_time_off(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_get_employee_time_off(UUID, DATE, DATE) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_get_employee_time_off(UUID, DATE, DATE) IS
    'Approved time-off events overlapping the given range. Excludes bamboo_* '
    'ids, employee_email, and notes.';

-- ============================================================================
-- TOOL 11: api_verify_employee_week
-- ============================================================================
-- The single CONDITION-12 contract: expected_hours is supplied by the
-- caller. The function body MUST contain ZERO references to public.resources
-- or to its expected_hours column. The CI grep guard
-- mcp-grep-guards.sh enforces this — see scripts/ci/.
--
-- Output:
--   data.actual_hours, data.expected_hours, data.delta, data.matches (bool),
--   data.tolerance (always 0.5h to absorb rounding-mode swings).

CREATE OR REPLACE FUNCTION mcp_api.api_verify_employee_week(
    p_canonical_employee_id UUID,
    p_week_start_date       DATE,
    p_expected_hours        NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = mcp_api, pg_temp
AS $$
DECLARE
    v_week_start    DATE;
    v_week_end      DATE;
    v_actual        NUMERIC := 0;
    v_delta         NUMERIC;
    v_matches       BOOLEAN;
    v_tolerance     NUMERIC := 0.5;
BEGIN
    IF p_canonical_employee_id IS NULL OR p_week_start_date IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'INVALID_DATE',
                'message', 'canonical_employee_id and week_start_date are required.'
            )
        );
    END IF;

    IF p_expected_hours IS NULL OR p_expected_hours < 0 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', jsonb_build_object(
                'code', 'INVALID_DATE',
                'message', 'expected_hours must be a non-negative number supplied by the caller.'
            )
        );
    END IF;

    v_week_start := date_trunc('week', p_week_start_date)::date;
    v_week_end   := v_week_start + 6;

    SELECT COALESCE(SUM(d.rounded_hours), 0)
      INTO v_actual
      FROM mcp_api.v_api_employee_daily d
     WHERE d.canonical_employee_id = p_canonical_employee_id
       AND d.work_date BETWEEN v_week_start AND v_week_end;

    v_actual  := ROUND(v_actual, 2);
    v_delta   := ROUND(v_actual - p_expected_hours, 2);
    v_matches := ABS(v_delta) <= v_tolerance;

    RETURN jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
            'week_start',     v_week_start,
            'week_end',       v_week_end,
            'expected_hours', p_expected_hours,
            'actual_hours',   v_actual,
            'delta',          v_delta,
            'tolerance',      v_tolerance,
            'matches',        v_matches
        ),
        'provenance', jsonb_build_object(
            'source',                'v_api_employee_daily',
            'computed_at',           NOW(),
            'row_count',             1,
            'truncated',             false,
            'canonical_employee_id', p_canonical_employee_id,
            'period_start',          v_week_start,
            'period_end',            v_week_end
        )
    );
END;
$$;

ALTER FUNCTION mcp_api.api_verify_employee_week(UUID, DATE, NUMERIC) OWNER TO mcp_owner;
REVOKE ALL ON FUNCTION mcp_api.api_verify_employee_week(UUID, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_api.api_verify_employee_week(UUID, DATE, NUMERIC) TO mcp_reader;
COMMENT ON FUNCTION mcp_api.api_verify_employee_week(UUID, DATE, NUMERIC) IS
    'Compare expected_hours (caller-supplied) to actual rounded hours for a '
    'canonical employee in a given week. NEVER reads public.resources.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '106 mcp_api functions migration complete:';
    RAISE NOTICE '  - 3 helpers: api_authenticate_key, api_consume_rate_limit, api_log_request';
    RAISE NOTICE '  - 11 tools: list/resolve/get/verify all present';
    RAISE NOTICE '  - All SECURITY DEFINER, SET search_path = mcp_api, pg_temp';
    RAISE NOTICE '  - All owned by mcp_owner; EXECUTE granted to mcp_reader';
    RAISE NOTICE '  - api_verify_employee_week takes expected_hours from caller (Condition 12)';
END $$;

COMMIT;
