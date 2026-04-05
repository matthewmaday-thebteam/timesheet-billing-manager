-- ============================================================================
-- Migration 087: Create Layer 2 physical tables (task_totals, employee_totals)
-- ============================================================================
-- Purpose: Pre-aggregated summary tables derived from timesheet_daily_rollups.
-- Populated post-sync by populate_layer2_totals() after rounding completes.
--
-- This migration deploys:
--   1. task_totals table — aggregated by project/task/client/month
--   2. employee_totals table — aggregated by user/project/client/month
--   3. RLS policies for both tables
--   4. populate_layer2_totals() function — DELETE+INSERT rebuild per month
--   5. Backfill all existing data
--   6. Verification checks
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create task_totals table
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_totals (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id      TEXT NOT NULL DEFAULT '',
    project_name    TEXT NOT NULL DEFAULT 'No Project',
    task_name       TEXT NOT NULL DEFAULT 'No Task',
    client_id       TEXT NOT NULL DEFAULT '__UNASSIGNED__',
    client_name     TEXT NOT NULL DEFAULT 'Unassigned',
    summary_month   DATE NOT NULL,
    actual_minutes  BIGINT NOT NULL DEFAULT 0,
    rounded_minutes BIGINT NOT NULL DEFAULT 0,
    actual_hours    NUMERIC(10,2) NOT NULL DEFAULT 0,
    rounded_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
    entry_count     INTEGER NOT NULL DEFAULT 0,
    first_date      DATE,
    last_date       DATE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT task_totals_unique UNIQUE (project_id, task_name, client_id, summary_month)
);

CREATE INDEX IF NOT EXISTS idx_task_totals_month ON task_totals (summary_month);
CREATE INDEX IF NOT EXISTS idx_task_totals_project ON task_totals (project_id);
CREATE INDEX IF NOT EXISTS idx_task_totals_client ON task_totals (client_id);

-- ============================================================================
-- STEP 2: Create employee_totals table
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_totals (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT '',
    user_name       TEXT NOT NULL DEFAULT 'Unknown User',
    project_id      TEXT NOT NULL DEFAULT '',
    project_name    TEXT NOT NULL DEFAULT 'No Project',
    client_id       TEXT NOT NULL DEFAULT '__UNASSIGNED__',
    client_name     TEXT NOT NULL DEFAULT 'Unassigned',
    summary_month   DATE NOT NULL,
    actual_minutes  BIGINT NOT NULL DEFAULT 0,
    rounded_minutes BIGINT NOT NULL DEFAULT 0,
    actual_hours    NUMERIC(10,2) NOT NULL DEFAULT 0,
    rounded_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
    entry_count     INTEGER NOT NULL DEFAULT 0,
    first_date      DATE,
    last_date       DATE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT employee_totals_unique UNIQUE (user_id, project_id, client_id, summary_month)
);

CREATE INDEX IF NOT EXISTS idx_employee_totals_month ON employee_totals (summary_month);
CREATE INDEX IF NOT EXISTS idx_employee_totals_user ON employee_totals (user_id);
CREATE INDEX IF NOT EXISTS idx_employee_totals_project ON employee_totals (project_id);
CREATE INDEX IF NOT EXISTS idx_employee_totals_client ON employee_totals (client_id);

-- ============================================================================
-- STEP 3: RLS policies
-- ============================================================================

ALTER TABLE task_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read task_totals"
    ON task_totals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access to task_totals"
    ON task_totals FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read employee_totals"
    ON employee_totals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access to employee_totals"
    ON employee_totals FOR ALL TO service_role USING (true);

-- ============================================================================
-- STEP 4: Create populate_layer2_totals() function
-- ============================================================================
-- Called after each sync (post-rounding) to rebuild Layer 2 for affected months.
-- Uses DELETE + INSERT to fully rebuild each affected month from all sources.
--
-- Parameters:
--   p_workspace_id  — clockify_workspace_id (or ClickUp team_id) — passed for
--                     signature consistency but NOT used to scope the rebuild
--   p_range_start   — start of sync date range (inclusive)
--   p_range_end     — end of sync date range (inclusive)
--
-- Returns: JSONB with task_rows, employee_rows, and months array
-- ============================================================================

CREATE OR REPLACE FUNCTION populate_layer2_totals(
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
    v_task_rows INTEGER := 0;
    v_employee_rows INTEGER := 0;
BEGIN
    -- Compute affected months: all first-of-month dates in the range
    SELECT ARRAY(
        SELECT d::DATE
        FROM generate_series(
            DATE_TRUNC('month', p_range_start)::DATE,
            DATE_TRUNC('month', p_range_end)::DATE,
            '1 month'::INTERVAL
        ) AS d
    ) INTO v_affected_months;

    -- -----------------------------------------------------------------------
    -- Rebuild task_totals for affected months
    -- -----------------------------------------------------------------------
    DELETE FROM task_totals
    WHERE summary_month = ANY(v_affected_months);

    INSERT INTO task_totals (
        project_id, project_name, task_name,
        client_id, client_name, summary_month,
        actual_minutes, rounded_minutes,
        actual_hours, rounded_hours,
        entry_count, first_date, last_date, updated_at
    )
    SELECT
        COALESCE(tdr.project_id, '')            AS project_id,
        MAX(COALESCE(tdr.project_name, 'No Project')) AS project_name,
        COALESCE(tdr.task_name, 'No Task')       AS task_name,
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__') AS client_id,
        MAX(COALESCE(NULLIF(tdr.client_name, ''), 'Unassigned')) AS client_name,
        DATE_TRUNC('month', tdr.work_date)::DATE AS summary_month,
        SUM(tdr.total_minutes)                   AS actual_minutes,
        SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)) AS rounded_minutes,
        ROUND(SUM(tdr.total_minutes) / 60.0, 2) AS actual_hours,
        ROUND(SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)) / 60.0, 2) AS rounded_hours,
        COUNT(*)::INTEGER                        AS entry_count,
        MIN(tdr.work_date)                       AS first_date,
        MAX(tdr.work_date)                       AS last_date,
        NOW()                                    AS updated_at
    FROM timesheet_daily_rollups tdr
    WHERE tdr.total_minutes IS NOT NULL
      AND tdr.total_minutes > 0
      AND DATE_TRUNC('month', tdr.work_date)::DATE = ANY(v_affected_months)
    GROUP BY
        COALESCE(tdr.project_id, ''),
        COALESCE(tdr.task_name, 'No Task'),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        DATE_TRUNC('month', tdr.work_date)::DATE;

    GET DIAGNOSTICS v_task_rows = ROW_COUNT;

    -- -----------------------------------------------------------------------
    -- Rebuild employee_totals for affected months
    -- -----------------------------------------------------------------------
    DELETE FROM employee_totals
    WHERE summary_month = ANY(v_affected_months);

    INSERT INTO employee_totals (
        user_id, user_name, project_id, project_name,
        client_id, client_name, summary_month,
        actual_minutes, rounded_minutes,
        actual_hours, rounded_hours,
        entry_count, first_date, last_date, updated_at
    )
    SELECT
        COALESCE(tdr.user_id, '')                AS user_id,
        MAX(COALESCE(tdr.user_name, 'Unknown User')) AS user_name,
        COALESCE(tdr.project_id, '')             AS project_id,
        MAX(COALESCE(tdr.project_name, 'No Project')) AS project_name,
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__') AS client_id,
        MAX(COALESCE(NULLIF(tdr.client_name, ''), 'Unassigned')) AS client_name,
        DATE_TRUNC('month', tdr.work_date)::DATE AS summary_month,
        SUM(tdr.total_minutes)                   AS actual_minutes,
        SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)) AS rounded_minutes,
        ROUND(SUM(tdr.total_minutes) / 60.0, 2) AS actual_hours,
        ROUND(SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)) / 60.0, 2) AS rounded_hours,
        COUNT(*)::INTEGER                        AS entry_count,
        MIN(tdr.work_date)                       AS first_date,
        MAX(tdr.work_date)                       AS last_date,
        NOW()                                    AS updated_at
    FROM timesheet_daily_rollups tdr
    WHERE tdr.total_minutes IS NOT NULL
      AND tdr.total_minutes > 0
      AND DATE_TRUNC('month', tdr.work_date)::DATE = ANY(v_affected_months)
    GROUP BY
        COALESCE(tdr.user_id, ''),
        COALESCE(tdr.project_id, ''),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        DATE_TRUNC('month', tdr.work_date)::DATE;

    GET DIAGNOSTICS v_employee_rows = ROW_COUNT;

    RETURN jsonb_build_object(
        'task_rows', v_task_rows,
        'employee_rows', v_employee_rows,
        'months', to_jsonb(v_affected_months)
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION populate_layer2_totals(TEXT, DATE, DATE) IS
    'Rebuild task_totals and employee_totals for all months touched by the given date range. '
    'Uses DELETE+INSERT to fully rebuild each affected month from all sources (not workspace-scoped). '
    'Returns JSONB with task_rows, employee_rows, and months array.';

-- Grants
GRANT EXECUTE ON FUNCTION populate_layer2_totals(TEXT, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION populate_layer2_totals(TEXT, DATE, DATE) TO authenticated;

-- ============================================================================
-- STEP 5: Backfill all existing data
-- ============================================================================
-- Computes the min/max work_date from timesheet_daily_rollups and calls
-- populate_layer2_totals for the full range.

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
        v_result := populate_layer2_totals('__backfill__', v_min_date, v_max_date);
        RAISE NOTICE 'Backfill complete: %', v_result::TEXT;
    END IF;
END $$;

-- ============================================================================
-- STEP 6: Verification
-- ============================================================================

DO $$
DECLARE
    v_task_table_exists BOOLEAN;
    v_employee_table_exists BOOLEAN;
    v_func_exists BOOLEAN;
    v_task_count INTEGER;
    v_employee_count INTEGER;
BEGIN
    -- Check task_totals table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'task_totals' AND table_schema = 'public'
    ) INTO v_task_table_exists;

    -- Check employee_totals table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'employee_totals' AND table_schema = 'public'
    ) INTO v_employee_table_exists;

    -- Check function exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_name = 'populate_layer2_totals'
    ) INTO v_func_exists;

    -- Check row counts
    SELECT COUNT(*) INTO v_task_count FROM task_totals;
    SELECT COUNT(*) INTO v_employee_count FROM employee_totals;

    RAISE NOTICE 'Migration 087 Complete:';
    RAISE NOTICE '  - task_totals table: %', CASE WHEN v_task_table_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - employee_totals table: %', CASE WHEN v_employee_table_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - populate_layer2_totals() function: %', CASE WHEN v_func_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - task_totals rows: %', v_task_count;
    RAISE NOTICE '  - employee_totals rows: %', v_employee_count;

    IF NOT v_task_table_exists THEN
        RAISE EXCEPTION 'Migration 087 Failed: task_totals table was not created';
    END IF;
    IF NOT v_employee_table_exists THEN
        RAISE EXCEPTION 'Migration 087 Failed: employee_totals table was not created';
    END IF;
    IF NOT v_func_exists THEN
        RAISE EXCEPTION 'Migration 087 Failed: populate_layer2_totals() function was not created';
    END IF;
    IF v_task_count = 0 THEN
        RAISE WARNING 'Migration 087 Warning: task_totals has 0 rows (may be expected if no rollup data exists)';
    END IF;
    IF v_employee_count = 0 THEN
        RAISE WARNING 'Migration 087 Warning: employee_totals has 0 rows (may be expected if no rollup data exists)';
    END IF;
END $$;

COMMIT;
