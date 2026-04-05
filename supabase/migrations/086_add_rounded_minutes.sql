-- ============================================================================
-- Migration 086: Add rounded_minutes to timesheet_daily_rollups
-- ============================================================================
-- Purpose: Store the rounded value of total_minutes per row so downstream
-- consumers (reports, dashboards) can read it directly without recalculating.
--
-- This migration deploys:
--   1. nullable rounded_minutes INTEGER column on timesheet_daily_rollups
--   2. populate_rounded_minutes() function — called post-sync to fill the column
--   3. Backfill all existing entries
--
-- The populate function uses the existing billing_apply_rounding() and
-- get_effective_project_rounding() functions to ensure consistency with the
-- billing engine.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add nullable rounded_minutes column
-- ============================================================================

ALTER TABLE timesheet_daily_rollups
    ADD COLUMN IF NOT EXISTS rounded_minutes INTEGER;

COMMENT ON COLUMN timesheet_daily_rollups.rounded_minutes IS
    'Per-entry rounded total_minutes using the project rounding config. '
    'Populated post-sync by populate_rounded_minutes(). NULL = not yet computed.';

-- ============================================================================
-- STEP 2: Create populate_rounded_minutes() function
-- ============================================================================
-- Called after each sync to fill rounded_minutes for entries in the synced range.
-- Uses billing_apply_rounding() and get_effective_project_rounding() for
-- consistency with the billing engine.
--
-- Parameters:
--   p_workspace_id  — clockify_workspace_id (or ClickUp team_id)
--   p_range_start   — start of sync date range (inclusive)
--   p_range_end     — end of sync date range (inclusive)
--
-- Returns: count of updated rows
-- ============================================================================

CREATE OR REPLACE FUNCTION populate_rounded_minutes(
    p_workspace_id TEXT,
    p_range_start DATE,
    p_range_end DATE
)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER := 0;
BEGIN
    WITH entries_with_rounding AS (
        SELECT
            tdr.id AS entry_id,
            tdr.total_minutes,
            COALESCE(
                (SELECT r.effective_rounding
                 FROM get_effective_project_rounding(p.id, DATE_TRUNC('month', tdr.work_date)::DATE) r),
                15
            ) AS rounding_increment
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
        WHERE tdr.clockify_workspace_id = p_workspace_id
          AND tdr.work_date >= p_range_start
          AND tdr.work_date <= p_range_end
    ),
    computed AS (
        SELECT
            entry_id,
            billing_apply_rounding(total_minutes, rounding_increment) AS new_rounded
        FROM entries_with_rounding
    )
    UPDATE timesheet_daily_rollups tdr
    SET rounded_minutes = c.new_rounded
    FROM computed c
    WHERE tdr.id = c.entry_id
      AND tdr.rounded_minutes IS DISTINCT FROM c.new_rounded;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION populate_rounded_minutes(TEXT, DATE, DATE) IS
    'Populate rounded_minutes on timesheet_daily_rollups for a workspace and date range. '
    'Uses billing_apply_rounding() with per-project rounding config. '
    'Only updates rows where the value actually changed. Returns count of updated rows.';

-- Grants
GRANT EXECUTE ON FUNCTION populate_rounded_minutes(TEXT, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION populate_rounded_minutes(TEXT, DATE, DATE) TO authenticated;

-- ============================================================================
-- STEP 3: Backfill all existing entries
-- ============================================================================
-- Uses the same logic as populate_rounded_minutes but without workspace/date filter.

DO $$
DECLARE
    v_backfilled INTEGER := 0;
BEGIN
    WITH entries_with_rounding AS (
        SELECT
            tdr.id AS entry_id,
            tdr.total_minutes,
            COALESCE(
                (SELECT r.effective_rounding
                 FROM get_effective_project_rounding(p.id, DATE_TRUNC('month', tdr.work_date)::DATE) r),
                15
            ) AS rounding_increment
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
    ),
    computed AS (
        SELECT
            entry_id,
            billing_apply_rounding(total_minutes, rounding_increment) AS new_rounded
        FROM entries_with_rounding
    ),
    updated AS (
        UPDATE timesheet_daily_rollups tdr
        SET rounded_minutes = c.new_rounded
        FROM computed c
        WHERE tdr.id = c.entry_id
          AND tdr.rounded_minutes IS DISTINCT FROM c.new_rounded
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_backfilled FROM updated;

    RAISE NOTICE 'Backfill complete: updated rounded_minutes for % entries', v_backfilled;
END $$;

-- ============================================================================
-- STEP 4: Verification
-- ============================================================================

DO $$
DECLARE
    v_col_exists BOOLEAN;
    v_func_exists BOOLEAN;
    v_null_count INTEGER;
    v_total_count INTEGER;
BEGIN
    -- Check column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'timesheet_daily_rollups'
          AND column_name = 'rounded_minutes'
    ) INTO v_col_exists;

    -- Check function exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_name = 'populate_rounded_minutes'
    ) INTO v_func_exists;

    -- Check backfill coverage
    SELECT COUNT(*) INTO v_total_count FROM timesheet_daily_rollups;
    SELECT COUNT(*) INTO v_null_count FROM timesheet_daily_rollups WHERE rounded_minutes IS NULL;

    RAISE NOTICE 'Migration 086 Complete:';
    RAISE NOTICE '  - rounded_minutes column: %', CASE WHEN v_col_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - populate_rounded_minutes() function: %', CASE WHEN v_func_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - Backfill coverage: % of % entries have rounded_minutes (% still NULL)',
        v_total_count - v_null_count, v_total_count, v_null_count;

    IF NOT v_col_exists THEN
        RAISE EXCEPTION 'Migration 086 Failed: rounded_minutes column was not created';
    END IF;
    IF NOT v_func_exists THEN
        RAISE EXCEPTION 'Migration 086 Failed: populate_rounded_minutes() function was not created';
    END IF;
END $$;

COMMIT;
