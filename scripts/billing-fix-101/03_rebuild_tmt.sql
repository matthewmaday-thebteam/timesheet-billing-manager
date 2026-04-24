-- =====================================================================
-- 03_rebuild_tmt.sql
-- One-shot rebuild of public.task_monthly_totals across all of history.
--
-- PREREQUISITE: migration 101 MUST be applied before running this.
-- Migration 101 fixes populate_task_monthly_totals so that DELETE and
-- INSERT cover the same set of months (full months, not the amputated
-- firstOfMonth-14d window). This script simply invokes that fixed
-- function across the entire date range that Layer 1 covers.
--
-- Safe to re-run. The fixed function itself is idempotent:
-- DELETE then INSERT per affected month.
-- =====================================================================

DO $$
DECLARE
    v_range_start DATE;
    v_range_end   DATE := CURRENT_DATE;
    v_result      JSONB;
BEGIN
    SELECT MIN(work_date)
      INTO v_range_start
      FROM public.timesheet_daily_rollups;

    IF v_range_start IS NULL THEN
        RAISE EXCEPTION
            'timesheet_daily_rollups is empty; refusing to rebuild task_monthly_totals.';
    END IF;

    RAISE NOTICE 'Rebuilding task_monthly_totals for % through %',
        v_range_start, v_range_end;

    -- The fixed (migration 101) populate function will internally widen
    -- the range to full calendar months, so we can pass the raw earliest
    -- work_date here without pre-snapping to the first-of-month.
    SELECT public.populate_task_monthly_totals(
               NULL::text,     -- all projects
               v_range_start,  -- earliest work_date in layer 1
               v_range_end     -- today
           )
      INTO v_result;

    RAISE NOTICE 'populate_task_monthly_totals returned: %', v_result;
END
$$;

-- ---------------------------------------------------------------------
-- Post-rebuild sanity counts. Compare against the snapshot captured in
-- 01_snapshot.sql to see the magnitude of the rebuild.
-- ---------------------------------------------------------------------
SELECT
    'task_monthly_totals post-rebuild'                           AS label,
    COUNT(*)                                                     AS tmt_rows,
    COUNT(DISTINCT (project_id, summary_month))                  AS distinct_project_months,
    COUNT(DISTINCT summary_month)                                AS distinct_months,
    COUNT(DISTINCT project_id)                                   AS distinct_projects,
    SUM(actual_minutes)                                          AS total_minutes,
    ROUND(SUM(actual_minutes)::numeric / 60.0, 2)                AS total_hours
FROM public.task_monthly_totals;

-- Delta vs snapshot: should reflect the recovered (previously amputated) hours.
SELECT
    'rebuild delta vs pre-fix snapshot'                                        AS label,
    (SELECT COUNT(*)        FROM public.task_monthly_totals)
      - (SELECT COUNT(*)    FROM billing_snapshots.tmt_2026_04_24_pre_fix)    AS row_delta,
    (SELECT SUM(actual_minutes) FROM public.task_monthly_totals)
      - (SELECT SUM(actual_minutes) FROM billing_snapshots.tmt_2026_04_24_pre_fix) AS minute_delta,
    ROUND(
        (
            (SELECT SUM(actual_minutes) FROM public.task_monthly_totals)
          - (SELECT SUM(actual_minutes) FROM billing_snapshots.tmt_2026_04_24_pre_fix)
        )::numeric / 60.0,
        2
    ) AS hour_delta;
