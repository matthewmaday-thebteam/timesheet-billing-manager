-- ============================================================================
-- Migration 093: Task Monthly Totals + Rounding Mode
-- ============================================================================
-- Purpose:
--   1. Add rounding_mode column to project_monthly_rounding table
--   2. Update get_effective_project_rounding() to return rounding_mode
--   3. Update get_all_project_roundings_for_month() to return rounding_mode
--   4. Update get_all_project_rates_for_month() to return rounding_mode
--   5. Update set_project_rounding_for_month() to accept rounding_mode
--   6. Create task_monthly_totals table
--   7. Create populate_task_monthly_totals() function
--   8. Backfill all historical data
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Add rounding_mode to project_monthly_rounding
-- ============================================================================

ALTER TABLE project_monthly_rounding
    ADD COLUMN IF NOT EXISTS rounding_mode TEXT NOT NULL DEFAULT 'task'
    CONSTRAINT chk_valid_rounding_mode CHECK (rounding_mode IN ('entry', 'task'));

COMMENT ON COLUMN project_monthly_rounding.rounding_mode IS
    'Rounding method: task = round per-task monthly total (legacy), entry = round each individual time entry';

-- ============================================================================
-- PART 2: Update get_effective_project_rounding() to return rounding_mode
-- ============================================================================

DROP FUNCTION IF EXISTS get_effective_project_rounding(UUID, DATE);

CREATE OR REPLACE FUNCTION get_effective_project_rounding(
    p_project_id UUID,
    p_month DATE
)
RETURNS TABLE (
    effective_rounding INTEGER,
    source TEXT,
    source_month DATE,
    effective_rounding_mode TEXT
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_first_seen_month DATE;
    v_lookup_month DATE;
    v_rounding INTEGER;
    v_rounding_month DATE;
    v_rounding_mode TEXT;
BEGIN
    -- Get first_seen_month for this project
    SELECT first_seen_month INTO v_first_seen_month
    FROM projects WHERE id = p_project_id;

    -- Handle NULL first_seen_month
    IF v_first_seen_month IS NULL THEN
        RAISE WARNING 'Project % has NULL first_seen_month', p_project_id;
        RETURN QUERY SELECT get_default_rounding_increment(), 'default'::TEXT, NULL::DATE, 'task'::TEXT;
        RETURN;
    END IF;

    -- Determine which month to look up (backfill if before first_seen)
    v_lookup_month := GREATEST(v_month, v_first_seen_month);

    -- Find most recent rounding <= lookup month
    SELECT pmr.rounding_increment, pmr.rounding_month, pmr.rounding_mode
    INTO v_rounding, v_rounding_month, v_rounding_mode
    FROM project_monthly_rounding pmr
    WHERE pmr.project_id = p_project_id
      AND pmr.rounding_month <= v_lookup_month
    ORDER BY pmr.rounding_month DESC
    LIMIT 1;

    -- Determine source
    IF v_rounding IS NOT NULL THEN
        IF v_month < v_first_seen_month THEN
            RETURN QUERY SELECT v_rounding, 'backfill'::TEXT, v_rounding_month, COALESCE(v_rounding_mode, 'task')::TEXT;
        ELSIF v_rounding_month = v_month THEN
            RETURN QUERY SELECT v_rounding, 'explicit'::TEXT, v_rounding_month, COALESCE(v_rounding_mode, 'task')::TEXT;
        ELSE
            RETURN QUERY SELECT v_rounding, 'inherited'::TEXT, v_rounding_month, COALESCE(v_rounding_mode, 'task')::TEXT;
        END IF;
    ELSE
        -- No explicit rounding set - use default
        RETURN QUERY SELECT get_default_rounding_increment(), 'default'::TEXT, NULL::DATE, 'task'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_effective_project_rounding(UUID, DATE) IS
    'Returns effective rounding increment and mode for a project in a given month with source tracking. v2: adds effective_rounding_mode.';

-- ============================================================================
-- PART 2b: Update get_all_project_roundings_for_month() to return rounding_mode
-- ============================================================================

DROP FUNCTION IF EXISTS get_all_project_roundings_for_month(DATE);

CREATE OR REPLACE FUNCTION get_all_project_roundings_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    effective_rounding INTEGER,
    source TEXT,
    source_month DATE,
    effective_rounding_mode TEXT
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    RETURN QUERY
    WITH rounding_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pmr.rounding_increment,
            pmr.rounding_month,
            pmr.rounding_mode
        FROM projects p
        LEFT JOIN project_monthly_rounding pmr
            ON pmr.project_id = p.id
           AND pmr.rounding_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pmr.rounding_month DESC
    )
    SELECT
        rl.proj_id AS project_id,
        COALESCE(rl.rounding_increment, get_default_rounding_increment()) AS effective_rounding,
        CASE
            WHEN rl.rounding_increment IS NULL THEN 'default'
            WHEN v_month < rl.first_seen_month THEN 'backfill'
            WHEN rl.rounding_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.rounding_month AS source_month,
        COALESCE(rl.rounding_mode, 'task') AS effective_rounding_mode
    FROM rounding_lookup rl;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_all_project_roundings_for_month(DATE) IS
    'Returns all projects with effective rounding and mode for a given month. v2: adds effective_rounding_mode.';

-- ============================================================================
-- PART 2c: Update set_project_rounding_for_month() to accept rounding_mode
-- ============================================================================

DROP FUNCTION IF EXISTS set_project_rounding_for_month(UUID, DATE, INTEGER);

CREATE OR REPLACE FUNCTION set_project_rounding_for_month(
    p_project_id UUID,
    p_month DATE,
    p_increment INTEGER,
    p_rounding_mode TEXT DEFAULT 'task'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    -- Validate increment
    IF p_increment NOT IN (0, 5, 15, 30) THEN
        RAISE EXCEPTION 'Invalid rounding increment. Must be 0, 5, 15, or 30';
    END IF;

    -- Validate rounding_mode
    IF p_rounding_mode NOT IN ('entry', 'task') THEN
        RAISE EXCEPTION 'Invalid rounding mode. Must be entry or task';
    END IF;

    -- Upsert: last write wins
    INSERT INTO project_monthly_rounding (project_id, rounding_month, rounding_increment, rounding_mode)
    VALUES (p_project_id, v_month, p_increment, p_rounding_mode)
    ON CONFLICT (project_id, rounding_month) DO UPDATE
    SET rounding_increment = EXCLUDED.rounding_increment,
        rounding_mode = EXCLUDED.rounding_mode,
        updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_project_rounding_for_month(UUID, DATE, INTEGER, TEXT) IS
    'Sets or updates rounding increment and mode for a project in a specific month (admin function). v2: adds rounding_mode parameter.';

-- Re-grant on the new function signatures
GRANT EXECUTE ON FUNCTION get_effective_project_rounding(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_project_rounding(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_all_project_roundings_for_month(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_project_roundings_for_month(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION set_project_rounding_for_month(UUID, DATE, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION set_project_rounding_for_month(UUID, DATE, INTEGER, TEXT) TO service_role;

-- ============================================================================
-- PART 2d: Update get_all_project_rates_for_month() to return rounding_mode
-- ============================================================================
-- This function is defined in 034 and returns rounding fields.
-- We need to add effective_rounding_mode to the return type.
-- Must DROP and recreate because RETURNS TABLE signature changes.

DROP FUNCTION IF EXISTS get_all_project_rates_for_month(DATE);

CREATE OR REPLACE FUNCTION get_all_project_rates_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    external_project_id TEXT,
    project_name TEXT,
    client_id TEXT,
    client_name TEXT,
    canonical_client_id TEXT,
    canonical_client_name TEXT,
    first_seen_month DATE,
    -- Rate fields
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE,
    existed_in_month BOOLEAN,
    -- Rounding fields
    effective_rounding INTEGER,
    rounding_source TEXT,
    rounding_source_month DATE,
    effective_rounding_mode TEXT,
    -- Billing limits fields
    minimum_hours NUMERIC,
    maximum_hours NUMERIC,
    carryover_enabled BOOLEAN,
    carryover_max_hours NUMERIC,
    carryover_expiry_months INTEGER,
    limits_source TEXT,
    limits_source_month DATE,
    -- Active status fields
    is_active BOOLEAN,
    active_source TEXT,
    active_source_month DATE,
    -- Carryover available
    carryover_hours_in NUMERIC
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    RETURN QUERY
    WITH rate_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.project_id AS ext_id,
            p.project_name,
            p.client_id,
            p.client_name,
            -- Get canonical company info
            COALESCE(canonical_c.client_id, c.client_id, p.client_id) AS canonical_client_id,
            COALESCE(canonical_c.display_name, canonical_c.client_name, c.display_name, c.client_name, p.client_name) AS canonical_client_name,
            p.first_seen_month,
            pmr.rate,
            pmr.rate_month
        FROM projects p
        -- Join with v_project_canonical to filter out member projects
        LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
        -- Join to get raw company
        LEFT JOIN companies c ON c.client_id = p.client_id
        -- Join to get canonical company mapping
        LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
        -- Join to get canonical company details
        LEFT JOIN companies canonical_c ON canonical_c.id = vcc.canonical_company_id
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = p.id
           AND pmr.rate_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
          AND (vpc.project_id IS NULL OR vpc.is_primary = true OR NOT EXISTS (
              SELECT 1 FROM v_project_canonical vpc2 WHERE vpc2.project_id = p.id
          ))
        ORDER BY p.id, pmr.rate_month DESC
    ),
    rounding_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pround.rounding_increment,
            pround.rounding_month,
            pround.rounding_mode
        FROM projects p
        LEFT JOIN project_monthly_rounding pround
            ON pround.project_id = p.id
           AND pround.rounding_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pround.rounding_month DESC
    ),
    limits_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            bl.minimum_hours,
            bl.maximum_hours,
            bl.carryover_enabled,
            bl.carryover_max_hours,
            bl.carryover_expiry_months,
            bl.limits_month
        FROM projects p
        LEFT JOIN project_monthly_billing_limits bl
            ON bl.project_id = p.id
           AND bl.limits_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, bl.limits_month DESC
    ),
    active_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            ast.is_active,
            ast.status_month
        FROM projects p
        LEFT JOIN project_monthly_active_status ast
            ON ast.project_id = p.id
           AND ast.status_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, ast.status_month DESC
    ),
    carryover_lookup AS (
        SELECT
            pch.project_id AS proj_id,
            SUM(pch.carryover_hours) AS total_carryover
        FROM project_carryover_hours pch
        WHERE pch.carryover_month = v_month
        GROUP BY pch.project_id
    )
    SELECT
        rl.proj_id AS project_id,
        rl.ext_id AS external_project_id,
        rl.project_name,
        rl.client_id,
        rl.client_name,
        rl.canonical_client_id,
        rl.canonical_client_name,
        rl.first_seen_month,
        -- Rate
        COALESCE(rl.rate, get_default_rate()) AS effective_rate,
        CASE
            WHEN rl.rate IS NULL THEN 'default'
            WHEN v_month < rl.first_seen_month THEN 'backfill'
            WHEN rl.rate_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.rate_month AS source_month,
        (v_month >= rl.first_seen_month) AS existed_in_month,
        -- Rounding
        COALESCE(rndl.rounding_increment, get_default_rounding_increment()) AS effective_rounding,
        CASE
            WHEN rndl.rounding_increment IS NULL THEN 'default'
            WHEN v_month < rndl.first_seen_month THEN 'backfill'
            WHEN rndl.rounding_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS rounding_source,
        rndl.rounding_month AS rounding_source_month,
        COALESCE(rndl.rounding_mode, 'task') AS effective_rounding_mode,
        -- Billing limits
        ll.minimum_hours,
        ll.maximum_hours,
        COALESCE(ll.carryover_enabled, false) AS carryover_enabled,
        ll.carryover_max_hours,
        ll.carryover_expiry_months,
        CASE
            WHEN ll.minimum_hours IS NULL AND ll.maximum_hours IS NULL THEN 'default'
            WHEN v_month < ll.first_seen_month THEN 'backfill'
            WHEN ll.limits_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS limits_source,
        ll.limits_month AS limits_source_month,
        -- Active status
        COALESCE(al.is_active, true) AS is_active,
        CASE
            WHEN al.is_active IS NULL THEN 'default'
            WHEN v_month < al.first_seen_month THEN 'backfill'
            WHEN al.status_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS active_source,
        al.status_month AS active_source_month,
        -- Carryover
        COALESCE(cl.total_carryover, 0) AS carryover_hours_in
    FROM rate_lookup rl
    LEFT JOIN rounding_lookup rndl ON rndl.proj_id = rl.proj_id
    LEFT JOIN limits_lookup ll ON ll.proj_id = rl.proj_id
    LEFT JOIN active_lookup al ON al.proj_id = rl.proj_id
    LEFT JOIN carryover_lookup cl ON cl.proj_id = rl.proj_id
    ORDER BY rl.canonical_client_name NULLS LAST, rl.project_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_all_project_rates_for_month(DATE) IS
    'Returns all projects with effective rates, rounding (with mode), limits, and active status for a given month. v3: adds effective_rounding_mode.';

GRANT EXECUTE ON FUNCTION get_all_project_rates_for_month(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_project_rates_for_month(DATE) TO service_role;

-- ============================================================================
-- PART 3: Create task_monthly_totals table
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_monthly_totals (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id              UUID NOT NULL,                   -- Internal canonical project UUID
    project_name            TEXT NOT NULL DEFAULT 'No Project',
    task_name               TEXT NOT NULL DEFAULT 'No Task',
    client_id               TEXT NOT NULL DEFAULT '__UNASSIGNED__',
    client_name             TEXT NOT NULL DEFAULT 'Unassigned',
    summary_month           DATE NOT NULL,
    actual_minutes          BIGINT NOT NULL DEFAULT 0,
    rounded_entry_minutes   BIGINT NOT NULL DEFAULT 0,
    rounded_task_minutes    BIGINT NOT NULL DEFAULT 0,
    actual_hours            NUMERIC(10,2) NOT NULL DEFAULT 0,
    rounded_entry_hours     NUMERIC(10,2) NOT NULL DEFAULT 0,
    rounded_task_hours      NUMERIC(10,2) NOT NULL DEFAULT 0,
    entry_count             INTEGER NOT NULL DEFAULT 0,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT task_monthly_totals_unique
        UNIQUE (project_id, task_name, client_id, summary_month)
);

CREATE INDEX IF NOT EXISTS idx_tmt_month ON task_monthly_totals (summary_month);
CREATE INDEX IF NOT EXISTS idx_tmt_project ON task_monthly_totals (project_id);

-- RLS
ALTER TABLE task_monthly_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read task_monthly_totals"
    ON task_monthly_totals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access to task_monthly_totals"
    ON task_monthly_totals FOR ALL TO service_role USING (true);

GRANT SELECT ON task_monthly_totals TO authenticated;
GRANT ALL ON task_monthly_totals TO service_role;

-- ============================================================================
-- PART 4: Create populate_task_monthly_totals()
-- ============================================================================

CREATE OR REPLACE FUNCTION populate_task_monthly_totals(
    p_workspace_id TEXT,
    p_range_start DATE,
    p_range_end DATE
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_affected_months DATE[];
    v_inserted INTEGER := 0;
    v_month DATE;
BEGIN
    -- Compute affected months from the date range
    SELECT ARRAY_AGG(DISTINCT DATE_TRUNC('month', d)::DATE)
    INTO v_affected_months
    FROM generate_series(p_range_start, p_range_end, '1 day'::INTERVAL) d;

    IF v_affected_months IS NULL OR array_length(v_affected_months, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'action', 'no_months_in_range',
            'range_start', p_range_start,
            'range_end', p_range_end
        );
    END IF;

    -- DELETE existing rows for the affected months (full rebuild per month)
    DELETE FROM task_monthly_totals
    WHERE summary_month = ANY(v_affected_months);

    -- INSERT by aggregating from timesheet_daily_rollups with canonical project resolution
    WITH canonical_entries AS (
        SELECT
            COALESCE(pg.primary_project_id, p.id) AS canonical_project_id,
            COALESCE(tdr.task_name, 'No Task') AS task_name,
            COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__') AS client_id,
            COALESCE(NULLIF(tdr.client_name, ''), 'Unassigned') AS client_name,
            DATE_TRUNC('month', tdr.work_date)::DATE AS summary_month,
            tdr.total_minutes,
            COALESCE(tdr.rounded_minutes, tdr.total_minutes) AS entry_rounded_minutes
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
        LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
        LEFT JOIN project_groups pg ON pg.id = pgm.group_id
        WHERE tdr.work_date >= p_range_start
          AND tdr.work_date <= p_range_end
          AND tdr.total_minutes IS NOT NULL
          AND tdr.total_minutes > 0
    ),
    -- Batch-lookup rounding config for all canonical projects and affected months
    rounding_config AS (
        SELECT DISTINCT
            ce.canonical_project_id,
            ce.summary_month,
            COALESCE(
                (SELECT r.effective_rounding
                 FROM get_effective_project_rounding(ce.canonical_project_id, ce.summary_month) r),
                15
            ) AS rounding_increment
        FROM canonical_entries ce
    ),
    aggregated AS (
        SELECT
            ce.canonical_project_id,
            MAX(canonical_p.project_name) AS project_name,
            ce.task_name,
            ce.client_id,
            MAX(ce.client_name) AS client_name,
            ce.summary_month,
            SUM(ce.total_minutes) AS actual_minutes,
            SUM(ce.entry_rounded_minutes) AS rounded_entry_minutes,
            billing_apply_rounding(SUM(ce.total_minutes)::INTEGER, rc.rounding_increment) AS rounded_task_minutes,
            COUNT(*) AS entry_count
        FROM canonical_entries ce
        JOIN projects canonical_p ON canonical_p.id = ce.canonical_project_id
        JOIN rounding_config rc
            ON rc.canonical_project_id = ce.canonical_project_id
           AND rc.summary_month = ce.summary_month
        GROUP BY
            ce.canonical_project_id,
            ce.task_name,
            ce.client_id,
            ce.summary_month,
            rc.rounding_increment
    )
    INSERT INTO task_monthly_totals (
        project_id, project_name, task_name, client_id, client_name,
        summary_month, actual_minutes, rounded_entry_minutes, rounded_task_minutes,
        actual_hours, rounded_entry_hours, rounded_task_hours,
        entry_count, updated_at
    )
    SELECT
        a.canonical_project_id,
        a.project_name,
        a.task_name,
        a.client_id,
        a.client_name,
        a.summary_month,
        a.actual_minutes,
        a.rounded_entry_minutes,
        a.rounded_task_minutes,
        ROUND(a.actual_minutes / 60.0, 2),
        ROUND(a.rounded_entry_minutes / 60.0, 2),
        ROUND(a.rounded_task_minutes / 60.0, 2),
        a.entry_count::INTEGER,
        NOW()
    FROM aggregated a;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RETURN jsonb_build_object(
        'action', 'task_monthly_totals_populated',
        'rows_inserted', v_inserted,
        'months_processed', array_length(v_affected_months, 1),
        'affected_months', to_jsonb(v_affected_months),
        'range_start', p_range_start,
        'range_end', p_range_end
    );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) TO authenticated;

-- ============================================================================
-- PART 5: Backfill all historical data
-- ============================================================================

DO $$
DECLARE
    v_min_date DATE;
    v_max_date DATE;
    v_result JSONB;
BEGIN
    SELECT MIN(work_date), MAX(work_date)
    INTO v_min_date, v_max_date
    FROM timesheet_daily_rollups
    WHERE total_minutes IS NOT NULL AND total_minutes > 0;

    IF v_min_date IS NULL OR v_max_date IS NULL THEN
        RAISE NOTICE 'Backfill skipped: no data in timesheet_daily_rollups';
    ELSE
        v_result := populate_task_monthly_totals('__backfill__', v_min_date, v_max_date);
        RAISE NOTICE 'Backfill complete: %', v_result::TEXT;
    END IF;
END $$;

-- ============================================================================
-- PART 6: Verification
-- ============================================================================

DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_func_exists BOOLEAN;
    v_col_exists BOOLEAN;
    v_tmt_count INTEGER;
BEGIN
    -- Check table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'task_monthly_totals'
    ) INTO v_table_exists;

    -- Check function exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_name = 'populate_task_monthly_totals'
    ) INTO v_func_exists;

    -- Check rounding_mode column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'project_monthly_rounding'
          AND column_name = 'rounding_mode'
    ) INTO v_col_exists;

    -- Count rows
    SELECT COUNT(*) INTO v_tmt_count FROM task_monthly_totals;

    RAISE NOTICE 'Migration 093 Verification:';
    RAISE NOTICE '  - task_monthly_totals table: %', CASE WHEN v_table_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - populate_task_monthly_totals() function: %', CASE WHEN v_func_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - rounding_mode column: %', CASE WHEN v_col_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - task_monthly_totals rows: %', v_tmt_count;

    IF NOT v_table_exists THEN
        RAISE EXCEPTION 'Migration 093 Failed: task_monthly_totals table was not created';
    END IF;
    IF NOT v_func_exists THEN
        RAISE EXCEPTION 'Migration 093 Failed: populate_task_monthly_totals() function was not created';
    END IF;
    IF NOT v_col_exists THEN
        RAISE EXCEPTION 'Migration 093 Failed: rounding_mode column was not added';
    END IF;
END $$;

COMMIT;
