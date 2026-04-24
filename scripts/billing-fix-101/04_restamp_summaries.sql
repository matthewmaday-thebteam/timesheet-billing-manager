-- =====================================================================
-- 04_restamp_summaries.sql
-- Re-stamp public.project_monthly_summary ONLY for (project_id, summary_month)
-- pairs whose task_monthly_totals content actually changed vs the snapshot
-- captured in 01_snapshot.sql. This explicitly protects Jan/Feb 2026 v1.2
-- rows (which are known-correct) from needless regression.
--
-- Trigger (restamp if ANY of):
--   * |SUM(actual_minutes)_now - SUM(actual_minutes)_snap|          > 1 minute
--   * |SUM(rounded_task_minutes)_now - SUM(rounded_task_minutes)_snap|   > 1 minute
--   * |SUM(rounded_entry_minutes)_now - SUM(rounded_entry_minutes)_snap| > 1 minute
--   * COUNT(*)_now != COUNT(*)_snap   (different # of (task, client) pairs)
--
-- The count-based trigger catches structural reshuffles where totals
-- coincidentally match but the per-task breakdown changed and therefore
-- any downstream consumer of rounded_task_minutes would diverge.
--
-- Uses PERFORM inside a DO block; each call to recalculate_project_month
-- is its own statement, so a single row failure will not abort the run.
-- =====================================================================

DO $$
DECLARE
    r               RECORD;
    v_restamped     INT := 0;
    v_skipped       INT := 0;
    v_failed        INT := 0;
    v_threshold_min INT := 1;  -- minutes
BEGIN
    -- Aggregate current tmt per (project, month): minutes + row-count
    -- Aggregate snapshot tmt per (project, month): minutes + row-count
    -- Diff across ALL trigger dimensions, then loop over what changed.
    FOR r IN
        WITH current_agg AS (
            SELECT
                project_id,
                summary_month,
                COALESCE(SUM(actual_minutes), 0)        AS cur_actual_minutes,
                COALESCE(SUM(rounded_task_minutes), 0)  AS cur_rounded_task_minutes,
                COALESCE(SUM(rounded_entry_minutes), 0) AS cur_rounded_entry_minutes,
                COUNT(*)                                AS cur_row_count
            FROM public.task_monthly_totals
            GROUP BY project_id, summary_month
        ),
        snapshot_agg AS (
            SELECT
                project_id,
                summary_month,
                COALESCE(SUM(actual_minutes), 0)        AS snap_actual_minutes,
                COALESCE(SUM(rounded_task_minutes), 0)  AS snap_rounded_task_minutes,
                COALESCE(SUM(rounded_entry_minutes), 0) AS snap_rounded_entry_minutes,
                COUNT(*)                                AS snap_row_count
            FROM billing_snapshots.tmt_2026_04_24_pre_fix
            GROUP BY project_id, summary_month
        ),
        diff AS (
            SELECT
                COALESCE(c.project_id,    s.project_id)    AS project_id,
                COALESCE(c.summary_month, s.summary_month) AS summary_month,
                COALESCE(c.cur_actual_minutes,        0) AS cur_actual_minutes,
                COALESCE(s.snap_actual_minutes,       0) AS snap_actual_minutes,
                COALESCE(c.cur_rounded_task_minutes,  0) AS cur_rounded_task_minutes,
                COALESCE(s.snap_rounded_task_minutes, 0) AS snap_rounded_task_minutes,
                COALESCE(c.cur_rounded_entry_minutes, 0) AS cur_rounded_entry_minutes,
                COALESCE(s.snap_rounded_entry_minutes,0) AS snap_rounded_entry_minutes,
                COALESCE(c.cur_row_count,             0) AS cur_row_count,
                COALESCE(s.snap_row_count,            0) AS snap_row_count
            FROM current_agg c
            FULL OUTER JOIN snapshot_agg s
                ON  c.project_id    = s.project_id
                AND c.summary_month = s.summary_month
        )
        SELECT
            project_id,
            summary_month,
            (cur_actual_minutes        - snap_actual_minutes)        AS delta_actual_minutes,
            (cur_rounded_task_minutes  - snap_rounded_task_minutes)  AS delta_rounded_task_minutes,
            (cur_rounded_entry_minutes - snap_rounded_entry_minutes) AS delta_rounded_entry_minutes,
            (cur_row_count             - snap_row_count)             AS delta_row_count
          FROM diff
         WHERE ABS(cur_actual_minutes        - snap_actual_minutes)        > v_threshold_min
            OR ABS(cur_rounded_task_minutes  - snap_rounded_task_minutes)  > v_threshold_min
            OR ABS(cur_rounded_entry_minutes - snap_rounded_entry_minutes) > v_threshold_min
            OR cur_row_count <> snap_row_count
         ORDER BY project_id, summary_month ASC
    LOOP
        BEGIN
            PERFORM public.recalculate_project_month(r.project_id, r.summary_month);
            v_restamped := v_restamped + 1;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            RAISE WARNING
                'recalculate_project_month failed for project=% month=% : %',
                r.project_id, r.summary_month, SQLERRM;
        END;
    END LOOP;

    -- -----------------------------------------------------------------
    -- CASCADE PASS: for every project whose tmt changed in some month M,
    -- re-run recalculate_project_month for every month > M (up to the
    -- latest PMS month for that project) in strict ASC order, so any
    -- carryover_out from month M propagates as carryover_in to M+1, and
    -- on forward through the chain. This catches the case where month M+1
    -- has no tmt change but its carryover_in depends on month M.
    -- -----------------------------------------------------------------
    FOR r IN
        WITH changed_projects AS (
            -- Projects that had ANY tmt change vs snapshot, with earliest changed month
            SELECT
                COALESCE(c.project_id, s.project_id) AS project_id,
                MIN(COALESCE(c.summary_month, s.summary_month)) AS min_changed_month
            FROM (
                SELECT project_id, summary_month,
                       SUM(actual_minutes) AS am,
                       SUM(rounded_task_minutes) AS rtm,
                       SUM(rounded_entry_minutes) AS rem,
                       COUNT(*) AS rc
                FROM public.task_monthly_totals
                GROUP BY project_id, summary_month
            ) c
            FULL OUTER JOIN (
                SELECT project_id, summary_month,
                       SUM(actual_minutes) AS am,
                       SUM(rounded_task_minutes) AS rtm,
                       SUM(rounded_entry_minutes) AS rem,
                       COUNT(*) AS rc
                FROM billing_snapshots.tmt_2026_04_24_pre_fix
                GROUP BY project_id, summary_month
            ) s
              ON c.project_id = s.project_id
             AND c.summary_month = s.summary_month
            WHERE ABS(COALESCE(c.am, 0)  - COALESCE(s.am, 0))  > v_threshold_min
               OR ABS(COALESCE(c.rtm, 0) - COALESCE(s.rtm, 0)) > v_threshold_min
               OR ABS(COALESCE(c.rem, 0) - COALESCE(s.rem, 0)) > v_threshold_min
               OR COALESCE(c.rc, 0)     <> COALESCE(s.rc, 0)
            GROUP BY COALESCE(c.project_id, s.project_id)
        )
        SELECT
            pms.project_id,
            pms.summary_month
        FROM public.project_monthly_summary pms
        JOIN changed_projects cp ON cp.project_id = pms.project_id
        WHERE pms.summary_month > cp.min_changed_month
        ORDER BY pms.project_id, pms.summary_month ASC
    LOOP
        BEGIN
            PERFORM public.recalculate_project_month(r.project_id, r.summary_month);
            v_restamped := v_restamped + 1;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            RAISE WARNING
                'cascade recalc failed for project=% month=% : %',
                r.project_id, r.summary_month, SQLERRM;
        END;
    END LOOP;

    -- Count skipped (within-threshold on ALL dimensions) project-months for reporting.
    WITH current_agg AS (
        SELECT
            project_id,
            summary_month,
            COALESCE(SUM(actual_minutes), 0)        AS cur_actual_minutes,
            COALESCE(SUM(rounded_task_minutes), 0)  AS cur_rounded_task_minutes,
            COALESCE(SUM(rounded_entry_minutes), 0) AS cur_rounded_entry_minutes,
            COUNT(*)                                AS cur_row_count
          FROM public.task_monthly_totals
         GROUP BY project_id, summary_month
    ),
    snapshot_agg AS (
        SELECT
            project_id,
            summary_month,
            COALESCE(SUM(actual_minutes), 0)        AS snap_actual_minutes,
            COALESCE(SUM(rounded_task_minutes), 0)  AS snap_rounded_task_minutes,
            COALESCE(SUM(rounded_entry_minutes), 0) AS snap_rounded_entry_minutes,
            COUNT(*)                                AS snap_row_count
          FROM billing_snapshots.tmt_2026_04_24_pre_fix
         GROUP BY project_id, summary_month
    )
    SELECT COUNT(*)
      INTO v_skipped
      FROM current_agg c
      FULL OUTER JOIN snapshot_agg s
        ON  c.project_id    = s.project_id
        AND c.summary_month = s.summary_month
     WHERE ABS(COALESCE(c.cur_actual_minutes,        0) - COALESCE(s.snap_actual_minutes,        0)) <= v_threshold_min
       AND ABS(COALESCE(c.cur_rounded_task_minutes,  0) - COALESCE(s.snap_rounded_task_minutes,  0)) <= v_threshold_min
       AND ABS(COALESCE(c.cur_rounded_entry_minutes, 0) - COALESCE(s.snap_rounded_entry_minutes, 0)) <= v_threshold_min
       AND COALESCE(c.cur_row_count, 0) = COALESCE(s.snap_row_count, 0);

    RAISE NOTICE 'Re-stamp summary: restamped=%, skipped_within_threshold=%, failed=%',
        v_restamped, v_skipped, v_failed;
END
$$;

-- ---------------------------------------------------------------------
-- Final report: restamp summary, plus version mix after the run so the
-- operator can verify that Jan/Feb 2026 v1.2 rows survived untouched
-- (i.e. no regression to an older version).
-- ---------------------------------------------------------------------
SELECT
    summary_month,
    calculation_version,
    COUNT(*) AS rows,
    MAX(calculated_at) AS latest_calc
FROM public.project_monthly_summary
GROUP BY summary_month, calculation_version
ORDER BY summary_month DESC, calculation_version;
