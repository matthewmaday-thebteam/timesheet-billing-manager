-- ============================================================================
-- Migration 089: Fix canonical project resolution in populate_rounded_minutes()
-- ============================================================================
-- Purpose: populate_rounded_minutes() was looking up rounding config using the
-- sub-project's internal UUID (p.id) directly. When a timesheet entry is logged
-- against a sub-project (member of a project group), the rounding config is
-- stored on the PRIMARY/CANONICAL project, not the member. The function would
-- fall through to the default rounding (15) because the member has no config.
--
-- Example: NeoCurrency has rounding_increment = 0 on the primary project, but
-- entries logged under member sub-projects ("Projects", "Solutions") were
-- getting rounding_increment = 15 (the default fallback).
--
-- Fix: Resolve the canonical/primary project via project_group_members before
-- looking up rounding config, matching how recalculate_project_month() does it.
--
-- Pattern from recalculate_project_month() (migration 046):
--   project_groups.primary_project_id = canonical project
--   project_group_members.member_project_id = sub-project
--   project_group_members.group_id -> project_groups.id
--
-- Resolution: LEFT JOIN to project_group_members/project_groups, then
--   COALESCE(pg.primary_project_id, p.id) = canonical project ID
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Replace populate_rounded_minutes() with canonical project resolution
-- ============================================================================
-- Same signature: (p_workspace_id TEXT, p_range_start DATE, p_range_end DATE)
-- Change: resolve canonical project before calling get_effective_project_rounding()

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
                 FROM get_effective_project_rounding(
                     COALESCE(pg.primary_project_id, p.id),
                     DATE_TRUNC('month', tdr.work_date)::DATE
                 ) r),
                15
            ) AS rounding_increment
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
        LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
        LEFT JOIN project_groups pg ON pg.id = pgm.group_id
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
    'v1.1 (migration 089): Resolves canonical/primary project via project_group_members before looking up rounding config. '
    'Uses billing_apply_rounding() with per-project rounding config. '
    'Only updates rows where rounded_minutes or rounding_increment actually changed. Returns count of updated rows.';

-- ============================================================================
-- STEP 2: Backfill ALL entries with corrected canonical project resolution
-- ============================================================================
-- Unfiltered backfill: no workspace or date filter.
-- This recalculates rounding for every entry using the fixed canonical resolution.

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
                 FROM get_effective_project_rounding(
                     COALESCE(pg.primary_project_id, p.id),
                     DATE_TRUNC('month', tdr.work_date)::DATE
                 ) r),
                15
            ) AS rounding_increment
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
        LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
        LEFT JOIN project_groups pg ON pg.id = pgm.group_id
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

    RAISE NOTICE 'Backfill complete: updated % entries with corrected canonical project rounding', v_backfilled;
END $$;

-- ============================================================================
-- STEP 3: Verification — NeoCurrency January should have rounding_increment = 0
-- ============================================================================

DO $$
DECLARE
    v_neocurrency_count INTEGER;
    v_neocurrency_wrong INTEGER;
    v_total_changed INTEGER;
BEGIN
    -- Count NeoCurrency January entries that still have wrong rounding
    -- NeoCurrency entries should have rounding_increment = 0 (matching primary project config)
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE tdr.rounding_increment != 0)
    INTO v_neocurrency_count, v_neocurrency_wrong
    FROM timesheet_daily_rollups tdr
    JOIN projects p ON p.project_id = tdr.project_id
    LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
    LEFT JOIN project_groups pg ON pg.id = pgm.group_id
    WHERE (p.project_name ILIKE '%neocurrency%'
           OR EXISTS (
               SELECT 1 FROM projects pp
               WHERE pp.id = pg.primary_project_id
                 AND pp.project_name ILIKE '%neocurrency%'
           ))
      AND DATE_TRUNC('month', tdr.work_date)::DATE = '2026-01-01'::DATE;

    RAISE NOTICE 'Migration 089 Verification:';
    RAISE NOTICE '  - NeoCurrency January entries: %', v_neocurrency_count;
    RAISE NOTICE '  - NeoCurrency January with wrong rounding (should be 0): %', v_neocurrency_wrong;

    IF v_neocurrency_wrong > 0 THEN
        RAISE WARNING '  - POTENTIAL ISSUE: % NeoCurrency January entries still have non-zero rounding_increment', v_neocurrency_wrong;
    ELSE
        RAISE NOTICE '  - All NeoCurrency January entries have correct rounding_increment';
    END IF;
END $$;

-- ============================================================================
-- STEP 4: General verification — function exists and entries are populated
-- ============================================================================

DO $$
DECLARE
    v_func_exists BOOLEAN;
    v_null_count INTEGER;
    v_total_count INTEGER;
    v_sample_check TEXT;
BEGIN
    -- Check function exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_name = 'populate_rounded_minutes'
    ) INTO v_func_exists;

    -- Check backfill coverage
    SELECT COUNT(*) INTO v_total_count FROM timesheet_daily_rollups;
    SELECT COUNT(*) INTO v_null_count FROM timesheet_daily_rollups WHERE rounding_increment IS NULL;

    -- Show sample of entries where project is a group member (canonical resolution applied)
    SELECT string_agg(
        format('  Member: %s -> Canonical: %s, Rounding: %s',
            sub.member_name,
            sub.canonical_name,
            sub.rounding_increment
        ), E'\n'
    )
    INTO v_sample_check
    FROM (
        SELECT DISTINCT ON (p_member.project_name)
            p_member.project_name AS member_name,
            p_primary.project_name AS canonical_name,
            tdr2.rounding_increment
        FROM timesheet_daily_rollups tdr2
        JOIN projects p_member ON p_member.project_id = tdr2.project_id
        JOIN project_group_members pgm2 ON pgm2.member_project_id = p_member.id
        JOIN project_groups pg2 ON pg2.id = pgm2.group_id
        JOIN projects p_primary ON p_primary.id = pg2.primary_project_id
        ORDER BY p_member.project_name, tdr2.work_date DESC
        LIMIT 10
    ) sub;

    RAISE NOTICE 'Migration 089 Complete:';
    RAISE NOTICE '  - populate_rounded_minutes() function: %', CASE WHEN v_func_exists THEN 'UPDATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - Backfill coverage: % of % entries have rounding_increment (% still NULL)',
        v_total_count - v_null_count, v_total_count, v_null_count;

    IF v_sample_check IS NOT NULL THEN
        RAISE NOTICE '  - Sample grouped project entries:';
        RAISE NOTICE '%', v_sample_check;
    END IF;

    IF NOT v_func_exists THEN
        RAISE EXCEPTION 'Migration 089 Failed: populate_rounded_minutes() function was not created';
    END IF;
END $$;

COMMIT;
