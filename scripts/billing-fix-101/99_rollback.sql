-- =====================================================================
-- 99_rollback.sql
-- REQUIRES EXPLICIT OPERATOR AUTHORIZATION BEFORE RUNNING
-- =====================================================================
-- Restores public.project_monthly_summary and public.task_monthly_totals
-- from the 2026-04-24 pre-fix snapshots, drops migration 101's new
-- validate_task_monthly_totals_vs_rollups(DATE, DATE), and restores the
-- v2 (migration 093) body of populate_task_monthly_totals(TEXT, DATE, DATE)
-- inline. This returns the database to its pre-migration-101 state.
--
-- Only run this if 05_validate.sql failed AND the team has confirmed the
-- rebuild produced worse numbers than the pre-fix state. Rolling back
-- RE-INTRODUCES the amputation bug; it must be paired with re-disabling
-- the sync crons (they should already be unscheduled).
--
-- Atomic: a single BEGIN/COMMIT wraps both restores so you cannot end
-- up with one table restored and the other not.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Pre-flight: snapshots must exist and be non-empty. Abort otherwise so
-- we never TRUNCATE a live table we cannot restore.
-- ---------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'billing_snapshots'
           AND table_name   = 'tmt_2026_04_24_pre_fix'
    ) THEN
        RAISE EXCEPTION 'billing_snapshots.tmt_2026_04_24_pre_fix missing — aborting rollback';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'billing_snapshots'
           AND table_name   = 'pms_2026_04_24_pre_fix'
    ) THEN
        RAISE EXCEPTION 'billing_snapshots.pms_2026_04_24_pre_fix missing — aborting rollback';
    END IF;
    IF (SELECT COUNT(*) FROM billing_snapshots.tmt_2026_04_24_pre_fix) = 0 THEN
        RAISE EXCEPTION 'tmt snapshot empty — aborting rollback';
    END IF;
    IF (SELECT COUNT(*) FROM billing_snapshots.pms_2026_04_24_pre_fix) = 0 THEN
        RAISE EXCEPTION 'pms snapshot empty — aborting rollback';
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- project_monthly_summary
-- ---------------------------------------------------------------------
-- Explicit column list on both sides: the snapshot has an extra
-- snapshot_taken_at column (added in 01_snapshot.sql) that is NOT part of
-- public.project_monthly_summary. Columns below match the live table as
-- declared in migration 044 (CREATE TABLE project_monthly_summary, lines
-- ~27-81), in declared order.
-- ---------------------------------------------------------------------
TRUNCATE TABLE public.project_monthly_summary;

INSERT INTO public.project_monthly_summary (
    id,
    summary_month,
    project_id,
    company_id,
    actual_minutes,
    rounded_minutes,
    actual_hours,
    rounded_hours,
    carryover_in_hours,
    adjusted_hours,
    billed_hours,
    unbillable_hours,
    carryover_out_hours,
    minimum_padding_hours,
    minimum_applied,
    maximum_applied,
    has_billing_limits,
    is_active_used,
    base_revenue_cents,
    billed_revenue_cents,
    invoiced_revenue_cents,
    rate_used,
    rate_source,
    rounding_used,
    minimum_hours_config,
    maximum_hours_config,
    carryover_enabled_config,
    resource_count,
    task_count,
    source_entry_count,
    calculated_at,
    calculation_version,
    created_at,
    updated_at
)
SELECT
    s.id,
    s.summary_month,
    s.project_id,
    s.company_id,
    s.actual_minutes,
    s.rounded_minutes,
    s.actual_hours,
    s.rounded_hours,
    s.carryover_in_hours,
    s.adjusted_hours,
    s.billed_hours,
    s.unbillable_hours,
    s.carryover_out_hours,
    s.minimum_padding_hours,
    s.minimum_applied,
    s.maximum_applied,
    s.has_billing_limits,
    s.is_active_used,
    s.base_revenue_cents,
    s.billed_revenue_cents,
    s.invoiced_revenue_cents,
    s.rate_used,
    s.rate_source,
    s.rounding_used,
    s.minimum_hours_config,
    s.maximum_hours_config,
    s.carryover_enabled_config,
    s.resource_count,
    s.task_count,
    s.source_entry_count,
    s.calculated_at,
    s.calculation_version,
    s.created_at,
    s.updated_at
FROM billing_snapshots.pms_2026_04_24_pre_fix s;

-- ---------------------------------------------------------------------
-- task_monthly_totals
-- ---------------------------------------------------------------------
-- Explicit column list matches migration 093 (CREATE TABLE
-- task_monthly_totals, lines ~396-414), in declared order. id is a
-- GENERATED ALWAYS AS IDENTITY column; we must use OVERRIDING SYSTEM
-- VALUE to preserve the snapshot's original ids. snapshot_taken_at from
-- the snapshot table is deliberately excluded.
-- ---------------------------------------------------------------------
TRUNCATE TABLE public.task_monthly_totals;

INSERT INTO public.task_monthly_totals (
    id,
    project_id,
    project_name,
    task_name,
    client_id,
    client_name,
    summary_month,
    actual_minutes,
    rounded_entry_minutes,
    rounded_task_minutes,
    actual_hours,
    rounded_entry_hours,
    rounded_task_hours,
    entry_count,
    updated_at
)
OVERRIDING SYSTEM VALUE
SELECT
    s.id,
    s.project_id,
    s.project_name,
    s.task_name,
    s.client_id,
    s.client_name,
    s.summary_month,
    s.actual_minutes,
    s.rounded_entry_minutes,
    s.rounded_task_minutes,
    s.actual_hours,
    s.rounded_entry_hours,
    s.rounded_task_hours,
    s.entry_count,
    s.updated_at
FROM billing_snapshots.tmt_2026_04_24_pre_fix s;

-- ---------------------------------------------------------------------
-- Remove migration-101 additions:
--   1) Drop validate_task_monthly_totals_vs_rollups (introduced by 101).
--   2) Replace populate_task_monthly_totals with its exact v2 body from
--      migration 093 (lines 434-557). This restores the pre-fix broken
--      behavior -- which is the point of rollback -- so the operator
--      does not need to re-run migration 093 via the migration runner
--      (most runners refuse to re-apply an already-applied migration).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.validate_task_monthly_totals_vs_rollups(DATE, DATE);

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

COMMENT ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) IS
    'Restored to v2 (migration 093) body by 99_rollback.sql. Re-introduces the March 1-17 amputation bug by design (this is rollback).';

GRANT EXECUTE ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION populate_task_monthly_totals(TEXT, DATE, DATE) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------
-- Post-rollback verification
-- ---------------------------------------------------------------------
SELECT
    'project_monthly_summary rollback'                                AS label,
    (SELECT COUNT(*) FROM public.project_monthly_summary)             AS live_rows,
    (SELECT COUNT(*) FROM billing_snapshots.pms_2026_04_24_pre_fix)   AS snapshot_rows;

SELECT
    'task_monthly_totals rollback'                                    AS label,
    (SELECT COUNT(*) FROM public.task_monthly_totals)                 AS live_rows,
    (SELECT COUNT(*) FROM billing_snapshots.tmt_2026_04_24_pre_fix)   AS snapshot_rows;

-- ---------------------------------------------------------------------
-- OPERATOR NOTE:
-- populate_task_monthly_totals has been restored to its v2 body inline.
-- Migration 093 does NOT need to be re-applied. Do NOT re-enable the
-- sync crons until the root cause is re-analyzed.
-- ---------------------------------------------------------------------
