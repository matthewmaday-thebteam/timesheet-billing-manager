-- ============================================================================
-- Migration 101: Fix task_monthly_totals scope mismatch (v3)
-- ============================================================================
-- Purpose:
--   1. Fix populate_task_monthly_totals() scope mismatch bug.
--      In v2 (migration 093), DELETE used whole-month scope but INSERT used
--      the raw p_range_start/p_range_end. Sync edge functions call with
--      p_range_start = firstOfMonth(today) - 14 days, so the DELETE wiped the
--      whole month while the INSERT only re-populated from day 18 onward.
--      Result: days 1-17 of the current month were permanently lost from
--      task_monthly_totals after the first mid-month sync.
--
--      Fix: expand p_range_start/p_range_end to full month boundaries at the
--      top of the function body so DELETE and INSERT scopes match exactly.
--
--   2. Add validate_task_monthly_totals_vs_rollups() reconciliation invariant.
--      Returns per-(canonical_project, summary_month) rows where the minutes
--      in timesheet_daily_rollups (resolved to canonical) differ from
--      task_monthly_totals by more than 2 minutes. Used by the sync edge
--      functions to hard-abort the drain step if populate produced an
--      inconsistent state.
--
-- Rounding math, billing_apply_rounding, get_effective_project_rounding,
-- rate functions, rounding_mode, UNIQUE constraint, and ON CONFLICT are all
-- unchanged. The INNER JOIN on projects is preserved (orphan-dropping is a
-- separate known issue, out of scope).
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix populate_task_monthly_totals() -- expand range to month bounds
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
    -- v3 FIX (migration 101): Expand range to full month boundaries so that
    -- the DELETE scope (computed from v_affected_months = whole months) and
    -- the INSERT scope (filtered by work_date BETWEEN p_range_start AND
    -- p_range_end) match exactly. Prior to this fix a sync call with
    -- p_range_start = 2026-03-18 and p_range_end = 2026-04-24 would DELETE
    -- all of March and April but only re-INSERT data from Mar 18 onward,
    -- permanently amputating March 1-17 from task_monthly_totals.
    p_range_start := DATE_TRUNC('month', p_range_start)::DATE;
    p_range_end := (DATE_TRUNC('month', p_range_end)::DATE + INTERVAL '1 month - 1 day')::DATE;

    -- TODO(tech-debt): p_workspace_id is unused by this function body. The
    -- canonical resolution below operates across all workspaces. The parameter
    -- is retained for signature stability with the sync edge functions and
    -- with existing callers; remove in a future migration once callers are
    -- updated.

    -- Compute affected months from the (now month-aligned) date range
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

COMMENT ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) IS
    'v3 (101): Expands p_range_start/p_range_end to full month boundaries so DELETE and INSERT scopes match. Fixes March 1-17 amputation bug. Rounding logic and canonical resolution unchanged from v2 (093).';

-- Re-grant (SECURITY DEFINER functions must be granted to callers).
GRANT EXECUTE ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) TO authenticated;

-- ============================================================================
-- PART 2: Reconciliation invariant -- tmt must match rollups (canonical)
-- ============================================================================
-- Returns rows where task_monthly_totals diverges from the canonical-resolved
-- sum of timesheet_daily_rollups by more than 2 minutes for a given month.
--
-- The JOIN pattern (INNER JOIN projects, LEFT JOIN project_group_members,
-- LEFT JOIN project_groups) mirrors populate_task_monthly_totals exactly so
-- that any data populate drops for JOIN reasons is also excluded from the
-- truth side. This is apples-to-apples reconciliation within populate's
-- worldview; orphan-dropping (INNER JOIN on projects) is a separate known
-- issue that this invariant does not cover, by design.
--
-- Tolerance of 2 minutes absorbs rounding drift from NUMERIC(10,2) hours
-- conversions that are not part of this function's computation but could
-- theoretically appear in future callers.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_task_monthly_totals_vs_rollups(
    p_range_start DATE DEFAULT NULL,
    p_range_end DATE DEFAULT NULL
)
RETURNS TABLE (
    canonical_project_id UUID,
    summary_month DATE,
    rollup_minutes BIGINT,
    tmt_minutes BIGINT,
    delta_minutes BIGINT
)
SECURITY DEFINER
SET search_path = public
AS $$
    WITH rollup_truth AS (
        SELECT
            COALESCE(pg.primary_project_id, p.id) AS canonical_project_id,
            DATE_TRUNC('month', tdr.work_date)::DATE AS summary_month,
            SUM(tdr.total_minutes)::BIGINT AS rollup_minutes
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
        LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
        LEFT JOIN project_groups pg ON pg.id = pgm.group_id
        WHERE tdr.total_minutes IS NOT NULL
          AND tdr.total_minutes > 0
          AND (p_range_start IS NULL OR tdr.work_date >= DATE_TRUNC('month', p_range_start)::DATE)
          AND (p_range_end IS NULL OR tdr.work_date <= (DATE_TRUNC('month', p_range_end)::DATE + INTERVAL '1 month - 1 day')::DATE)
        GROUP BY
            COALESCE(pg.primary_project_id, p.id),
            DATE_TRUNC('month', tdr.work_date)::DATE
    ),
    tmt_observed AS (
        SELECT
            tmt.project_id AS canonical_project_id,
            tmt.summary_month,
            SUM(tmt.actual_minutes)::BIGINT AS tmt_minutes
        FROM task_monthly_totals tmt
        WHERE (p_range_start IS NULL OR tmt.summary_month >= DATE_TRUNC('month', p_range_start)::DATE)
          AND (p_range_end IS NULL OR tmt.summary_month <= DATE_TRUNC('month', p_range_end)::DATE)
        GROUP BY tmt.project_id, tmt.summary_month
    )
    SELECT
        COALESCE(rt.canonical_project_id, tobs.canonical_project_id) AS canonical_project_id,
        COALESCE(rt.summary_month, tobs.summary_month) AS summary_month,
        COALESCE(rt.rollup_minutes, 0) AS rollup_minutes,
        COALESCE(tobs.tmt_minutes, 0) AS tmt_minutes,
        (COALESCE(rt.rollup_minutes, 0) - COALESCE(tobs.tmt_minutes, 0))::BIGINT AS delta_minutes
    FROM rollup_truth rt
    FULL OUTER JOIN tmt_observed tobs
        ON tobs.canonical_project_id = rt.canonical_project_id
       AND tobs.summary_month = rt.summary_month
    WHERE ABS(COALESCE(rt.rollup_minutes, 0) - COALESCE(tobs.tmt_minutes, 0)) > 2;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION validate_task_monthly_totals_vs_rollups(DATE, DATE) IS
    'v1 (101): Reconciliation invariant. Returns per-(canonical_project, summary_month) rows where task_monthly_totals.actual_minutes diverges from the canonical-resolved sum of timesheet_daily_rollups.total_minutes by more than 2 minutes. Called by sync edge functions between populate_task_monthly_totals and drain_recalculation_queue to hard-abort the drain on inconsistency.';

-- NOTE: No grant to `authenticated`. This invariant scans the full
-- timesheet_daily_rollups / task_monthly_totals tables and is called only
-- by the sync edge functions (which run as service_role) between populate
-- and drain. Exposing it to end-user sessions would be both a performance
-- hazard and a minor info-disclosure surface for cross-tenant totals.
GRANT EXECUTE ON FUNCTION validate_task_monthly_totals_vs_rollups(DATE, DATE) TO service_role;

COMMIT;
