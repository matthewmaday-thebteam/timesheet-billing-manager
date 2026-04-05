-- ============================================================================
-- Migration 088: Add rounding_increment to timesheet_daily_rollups
-- ============================================================================
-- Purpose: Store the rounding increment used to compute rounded_minutes so
-- downstream consumers can display the rule that was applied.
--
-- This migration deploys:
--   1. nullable rounding_increment INTEGER column on timesheet_daily_rollups
--   2. Updated populate_rounded_minutes() function — now also writes rounding_increment
--   3. Backfill all existing entries with rounding_increment
--   4. Verification checks
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add nullable rounding_increment column
-- ============================================================================

ALTER TABLE timesheet_daily_rollups
    ADD COLUMN IF NOT EXISTS rounding_increment INTEGER;

COMMENT ON COLUMN timesheet_daily_rollups.rounding_increment IS
    'The rounding increment (0, 5, 15, or 30) used to compute rounded_minutes. '
    'Populated post-sync by populate_rounded_minutes(). NULL = not yet computed.';

-- ============================================================================
-- STEP 2: Replace populate_rounded_minutes() function
-- ============================================================================
-- Same signature: (p_workspace_id TEXT, p_range_start DATE, p_range_end DATE)
-- Now also writes rounding_increment alongside rounded_minutes.

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
            billing_apply_rounding(total_minutes, rounding_increment) AS new_rounded,
            rounding_increment AS used_increment
        FROM entries_with_rounding
    )
    UPDATE timesheet_daily_rollups tdr
    SET rounded_minutes = c.new_rounded,
        rounding_increment = c.used_increment
    FROM computed c
    WHERE tdr.id = c.entry_id
      AND (tdr.rounded_minutes IS DISTINCT FROM c.new_rounded
           OR tdr.rounding_increment IS DISTINCT FROM c.used_increment);

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION populate_rounded_minutes(TEXT, DATE, DATE) IS
    'Populate rounded_minutes and rounding_increment on timesheet_daily_rollups for a workspace and date range. '
    'Uses billing_apply_rounding() with per-project rounding config. '
    'Only updates rows where rounded_minutes or rounding_increment actually changed. Returns count of updated rows.';

-- ============================================================================
-- STEP 3: Backfill all existing entries with rounding_increment
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
            billing_apply_rounding(total_minutes, rounding_increment) AS new_rounded,
            rounding_increment AS used_increment
        FROM entries_with_rounding
    ),
    updated AS (
        UPDATE timesheet_daily_rollups tdr
        SET rounded_minutes = c.new_rounded,
            rounding_increment = c.used_increment
        FROM computed c
        WHERE tdr.id = c.entry_id
          AND (tdr.rounded_minutes IS DISTINCT FROM c.new_rounded
               OR tdr.rounding_increment IS DISTINCT FROM c.used_increment)
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_backfilled FROM updated;

    RAISE NOTICE 'Backfill complete: updated % entries with rounding_increment', v_backfilled;
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
          AND column_name = 'rounding_increment'
    ) INTO v_col_exists;

    -- Check function exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_name = 'populate_rounded_minutes'
    ) INTO v_func_exists;

    -- Check backfill coverage
    SELECT COUNT(*) INTO v_total_count FROM timesheet_daily_rollups;
    SELECT COUNT(*) INTO v_null_count FROM timesheet_daily_rollups WHERE rounding_increment IS NULL;

    RAISE NOTICE 'Migration 088 Complete:';
    RAISE NOTICE '  - rounding_increment column: %', CASE WHEN v_col_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - populate_rounded_minutes() function: %', CASE WHEN v_func_exists THEN 'EXISTS' ELSE 'MISSING' END;
    RAISE NOTICE '  - Backfill coverage: % of % entries have rounding_increment (% still NULL)',
        v_total_count - v_null_count, v_total_count, v_null_count;

    IF NOT v_col_exists THEN
        RAISE EXCEPTION 'Migration 088 Failed: rounding_increment column was not created';
    END IF;
    IF NOT v_func_exists THEN
        RAISE EXCEPTION 'Migration 088 Failed: populate_rounded_minutes() function was not created';
    END IF;
END $$;

COMMIT;
