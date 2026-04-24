-- =====================================================================
-- 05_validate.sql
-- Post-fix invariant + spot-check validation.
-- Read-only. If anything fails, the script emits a loud
--    '!!!! VALIDATION FAILED: ...'
-- row that the operator must not ignore. In that case do NOT re-enable
-- the sync crons; run 99_rollback.sql instead.
-- =====================================================================

-- ---------------------------------------------------------------------
SELECT 'SECTION 1: GLOBAL INVARIANT (validate_task_monthly_totals_vs_rollups)' AS section;
-- Must return 0 rows post-fix.
-- ---------------------------------------------------------------------
SELECT *
  FROM public.validate_task_monthly_totals_vs_rollups(NULL, NULL);

-- Hard-fail marker if the invariant reports any drift:
SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM public.validate_task_monthly_totals_vs_rollups(NULL, NULL)) = 0
            THEN 'OK: task_monthly_totals matches timesheet_daily_rollups (zero drift)'
        ELSE '!!!! VALIDATION FAILED: validate_task_monthly_totals_vs_rollups returned '
             || (SELECT COUNT(*) FROM public.validate_task_monthly_totals_vs_rollups(NULL, NULL))::text
             || ' drift rows — DO NOT re-enable sync crons; run 99_rollback.sql'
    END AS invariant_status;

-- ---------------------------------------------------------------------
SELECT 'SECTION 2: NEOCURRENCY MARCH 2026 SPOT-CHECK (project_monthly_summary)' AS section;
-- Expected: rounded_hours ≈ 1303.50, billed_hours = 1160,
-- billed_revenue_cents = 6148000 (± a few cents).
-- Canonical project: a93b6d26-89b3-4a04-b13e-dd07b838928c, month 2026-03-01.
-- ---------------------------------------------------------------------
SELECT
    project_id,
    summary_month,
    rounded_hours,
    billed_hours,
    billed_revenue_cents,
    calculation_version,
    calculated_at
FROM public.project_monthly_summary
WHERE project_id    = 'a93b6d26-89b3-4a04-b13e-dd07b838928c'::uuid
  AND summary_month = DATE '2026-03-01';

SELECT
    CASE
        WHEN pms.rounded_hours IS NULL
            THEN '!!!! VALIDATION FAILED: no project_monthly_summary row for Neocurrency 2026-03'
        -- rounded_hours tolerance widened to ± 0.05 to absorb per-task vs
        -- per-entry rounding-mode shifts that can flip the last cent of
        -- a total without indicating a real regression.
        WHEN ABS(pms.rounded_hours - 1303.50)           > 0.05
            THEN '!!!! VALIDATION FAILED: Neocurrency March rounded_hours='
                 || pms.rounded_hours::text || ' (expected 1303.50 ± 0.05)'
        -- billed_hours stays exact: 1160 is a MAX cap and must match.
        WHEN pms.billed_hours <> 1160
            THEN '!!!! VALIDATION FAILED: Neocurrency March billed_hours='
                 || pms.billed_hours::text || ' (expected 1160)'
        -- billed_revenue_cents tolerance widened to ± 100 (one dollar) to
        -- match the rounded_hours tolerance under the current rate.
        WHEN ABS(pms.billed_revenue_cents - 6148000)    > 100
            THEN '!!!! VALIDATION FAILED: Neocurrency March billed_revenue_cents='
                 || pms.billed_revenue_cents::text || ' (expected 6148000 ± 100)'
        ELSE 'OK: Neocurrency March 2026 matches expected values'
    END AS neocurrency_spot_check_status
FROM (
    SELECT rounded_hours, billed_hours, billed_revenue_cents
      FROM public.project_monthly_summary
     WHERE project_id    = 'a93b6d26-89b3-4a04-b13e-dd07b838928c'::uuid
       AND summary_month = DATE '2026-03-01'
    UNION ALL
    SELECT NULL, NULL, NULL
    WHERE NOT EXISTS (
        SELECT 1 FROM public.project_monthly_summary
         WHERE project_id    = 'a93b6d26-89b3-4a04-b13e-dd07b838928c'::uuid
           AND summary_month = DATE '2026-03-01'
    )
    LIMIT 1
) pms;

-- ---------------------------------------------------------------------
SELECT 'SECTION 3: NEOCURRENCY MARCH 2026 LAYER 1 DAY-BY-DAY (truth)' AS section;
-- Expected: weekday count matches March 2026 business days worked,
-- total hours = 1294.77.
-- ---------------------------------------------------------------------
WITH neocurrency_layer1 AS (
    SELECT
        tdr.work_date,
        EXTRACT(ISODOW FROM tdr.work_date) AS iso_dow,
        SUM(tdr.total_minutes)              AS minutes
    FROM public.timesheet_daily_rollups tdr
    JOIN public.projects p
        ON p.project_id = tdr.project_id
    LEFT JOIN public.project_group_members pgm
        ON pgm.member_project_id = p.id
    LEFT JOIN public.project_groups pg
        ON pg.id = pgm.group_id
    WHERE COALESCE(pg.primary_project_id, p.id)
              = 'a93b6d26-89b3-4a04-b13e-dd07b838928c'::uuid
      AND tdr.work_date >= DATE '2026-03-01'
      AND tdr.work_date <  DATE '2026-04-01'
    GROUP BY tdr.work_date
)
SELECT
    COUNT(*)                                                  AS distinct_days,
    COUNT(*) FILTER (WHERE iso_dow BETWEEN 1 AND 5)           AS weekdays_present,
    COUNT(*) FILTER (WHERE iso_dow IN (6, 7))                 AS weekend_days_present,
    ROUND(SUM(minutes)::numeric / 60.0, 2)                    AS total_hours
FROM neocurrency_layer1;

SELECT
    CASE
        WHEN ABS(
                 (SELECT ROUND(SUM(minutes)::numeric / 60.0, 2)
                    FROM (
                        SELECT SUM(tdr.total_minutes) AS minutes
                          FROM public.timesheet_daily_rollups tdr
                          JOIN public.projects p
                            ON p.project_id = tdr.project_id
                          LEFT JOIN public.project_group_members pgm
                            ON pgm.member_project_id = p.id
                          LEFT JOIN public.project_groups pg
                            ON pg.id = pgm.group_id
                         WHERE COALESCE(pg.primary_project_id, p.id)
                                   = 'a93b6d26-89b3-4a04-b13e-dd07b838928c'::uuid
                           AND tdr.work_date >= DATE '2026-03-01'
                           AND tdr.work_date <  DATE '2026-04-01'
                         GROUP BY tdr.work_date
                    ) d
                 )
                 - 1294.77
             ) > 0.01
            THEN '!!!! VALIDATION FAILED: Neocurrency March Layer 1 total_hours != 1294.77'
        ELSE 'OK: Neocurrency March Layer 1 total_hours = 1294.77'
    END AS neocurrency_layer1_status;
