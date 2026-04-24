-- =====================================================================
-- 02_blast_radius_report.sql
-- READ-ONLY. Produces four sections of diagnostic output so the operator
-- can quantify the damage before rebuilding. Archive this output
-- (psql -f 02_blast_radius_report.sql > reports/2026-04-24_blast_radius.txt)
-- BEFORE running 03_rebuild_tmt.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
SELECT 'SECTION 1: DRIFT ENUMERATION (Layer 1 canonical vs Layer 3 tmt)' AS section;
-- ---------------------------------------------------------------------
-- Canonical-project × month reconciliation. Uses the same JOIN pattern
-- that migration 093's populate_task_monthly_totals uses to resolve
-- project_group membership to the primary project.
WITH layer1_canonical AS (
    SELECT
        COALESCE(pg.primary_project_id, p.id) AS canonical_project_id,
        DATE_TRUNC('month', tdr.work_date)::date AS summary_month,
        SUM(tdr.total_minutes)                   AS layer1_minutes
    FROM public.timesheet_daily_rollups tdr
    JOIN public.projects p
        ON p.project_id = tdr.project_id
    LEFT JOIN public.project_group_members pgm
        ON pgm.member_project_id = p.id
    LEFT JOIN public.project_groups pg
        ON pg.id = pgm.group_id
    GROUP BY 1, 2
),
layer3_canonical AS (
    SELECT
        tmt.project_id                  AS canonical_project_id,
        tmt.summary_month,
        SUM(tmt.actual_minutes)         AS layer3_minutes
    FROM public.task_monthly_totals tmt
    GROUP BY 1, 2
)
SELECT
    COALESCE(l1.canonical_project_id, l3.canonical_project_id) AS canonical_project_id,
    COALESCE(l1.summary_month,         l3.summary_month)        AS summary_month,
    COALESCE(l1.layer1_minutes, 0)                              AS layer1_minutes,
    COALESCE(l3.layer3_minutes, 0)                              AS layer3_minutes,
    COALESCE(l1.layer1_minutes, 0) - COALESCE(l3.layer3_minutes, 0) AS delta_minutes,
    ROUND(
        (COALESCE(l1.layer1_minutes, 0) - COALESCE(l3.layer3_minutes, 0))::numeric / 60.0,
        2
    ) AS delta_hours
FROM layer1_canonical l1
FULL OUTER JOIN layer3_canonical l3
    ON  l1.canonical_project_id = l3.canonical_project_id
    AND l1.summary_month         = l3.summary_month
WHERE ABS(COALESCE(l1.layer1_minutes, 0) - COALESCE(l3.layer3_minutes, 0)) > 0
ORDER BY ABS(COALESCE(l1.layer1_minutes, 0) - COALESCE(l3.layer3_minutes, 0)) DESC;

-- ---------------------------------------------------------------------
SELECT 'SECTION 2: SUMMARY BY MONTH (missing hours, distinct projects)' AS section;
-- ---------------------------------------------------------------------
WITH layer1_canonical AS (
    SELECT
        COALESCE(pg.primary_project_id, p.id) AS canonical_project_id,
        DATE_TRUNC('month', tdr.work_date)::date AS summary_month,
        SUM(tdr.total_minutes)                   AS layer1_minutes
    FROM public.timesheet_daily_rollups tdr
    JOIN public.projects p
        ON p.project_id = tdr.project_id
    LEFT JOIN public.project_group_members pgm
        ON pgm.member_project_id = p.id
    LEFT JOIN public.project_groups pg
        ON pg.id = pgm.group_id
    GROUP BY 1, 2
),
layer3_canonical AS (
    SELECT
        tmt.project_id                  AS canonical_project_id,
        tmt.summary_month,
        SUM(tmt.actual_minutes)         AS layer3_minutes
    FROM public.task_monthly_totals tmt
    GROUP BY 1, 2
),
drift AS (
    SELECT
        COALESCE(l1.canonical_project_id, l3.canonical_project_id) AS canonical_project_id,
        COALESCE(l1.summary_month,         l3.summary_month)        AS summary_month,
        COALESCE(l1.layer1_minutes, 0) - COALESCE(l3.layer3_minutes, 0) AS delta_minutes
    FROM layer1_canonical l1
    FULL OUTER JOIN layer3_canonical l3
        ON  l1.canonical_project_id = l3.canonical_project_id
        AND l1.summary_month         = l3.summary_month
)
SELECT
    summary_month,
    COUNT(*) FILTER (WHERE ABS(delta_minutes) > 0)            AS projects_with_drift,
    COUNT(*) FILTER (WHERE delta_minutes > 0)                 AS projects_missing_hours,
    COUNT(*) FILTER (WHERE delta_minutes < 0)                 AS projects_with_extra_hours,
    ROUND(SUM(GREATEST(delta_minutes, 0))::numeric / 60.0, 2) AS total_missing_hours,
    ROUND(SUM(LEAST(delta_minutes, 0))::numeric   / 60.0, 2)  AS total_extra_hours
FROM drift
WHERE ABS(delta_minutes) > 0
GROUP BY summary_month
ORDER BY summary_month DESC;

-- ---------------------------------------------------------------------
SELECT 'SECTION 3: VERSION STATUS (project_monthly_summary by month × version)' AS section;
-- ---------------------------------------------------------------------
SELECT
    summary_month,
    calculation_version,
    COUNT(*) AS rows,
    MIN(calculated_at) AS earliest_calc,
    MAX(calculated_at) AS latest_calc
FROM public.project_monthly_summary
GROUP BY summary_month, calculation_version
ORDER BY summary_month DESC, calculation_version;

-- ---------------------------------------------------------------------
SELECT 'SECTION 4: INVOICE CORRELATION (affected company×month → qbo_invoice_log)' AS section;
-- ---------------------------------------------------------------------
-- For every (company, month) pair where Layer 1 vs Layer 3 drifted, look
-- up whether QBO already has an invoice on record and in what state.
--
-- Pre-flight: confirm the qbo_invoice_log schema actually has the columns
-- we JOIN/SELECT on below (company_id, summary_month, status, sent_at,
-- total_amount_cents). If the JOIN below returns all NULLs, verify actual
-- column names via the pre-flight SELECT above and adjust accordingly.
SELECT 'SECTION 4 PRE-FLIGHT: qbo_invoice_log columns' AS note;
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'qbo_invoice_log'
 ORDER BY ordinal_position;

-- If the JOIN below returns all NULLs, verify actual column names via the
-- pre-flight SELECT above and adjust accordingly.
WITH layer1_canonical AS (
    SELECT
        COALESCE(pg.primary_project_id, p.id) AS canonical_project_id,
        DATE_TRUNC('month', tdr.work_date)::date AS summary_month,
        SUM(tdr.total_minutes)                   AS layer1_minutes
    FROM public.timesheet_daily_rollups tdr
    JOIN public.projects p
        ON p.project_id = tdr.project_id
    LEFT JOIN public.project_group_members pgm
        ON pgm.member_project_id = p.id
    LEFT JOIN public.project_groups pg
        ON pg.id = pgm.group_id
    GROUP BY 1, 2
),
layer3_canonical AS (
    SELECT
        tmt.project_id                  AS canonical_project_id,
        tmt.summary_month,
        SUM(tmt.actual_minutes)         AS layer3_minutes
    FROM public.task_monthly_totals tmt
    GROUP BY 1, 2
),
drift AS (
    SELECT
        COALESCE(l1.canonical_project_id, l3.canonical_project_id) AS canonical_project_id,
        COALESCE(l1.summary_month,         l3.summary_month)        AS summary_month,
        COALESCE(l1.layer1_minutes, 0) - COALESCE(l3.layer3_minutes, 0) AS delta_minutes
    FROM layer1_canonical l1
    FULL OUTER JOIN layer3_canonical l3
        ON  l1.canonical_project_id = l3.canonical_project_id
        AND l1.summary_month         = l3.summary_month
    WHERE ABS(COALESCE(l1.layer1_minutes, 0) - COALESCE(l3.layer3_minutes, 0)) > 0
)
SELECT
    d.canonical_project_id,
    p.project_name,
    p.client_name,
    p.company_id,
    d.summary_month,
    ROUND(d.delta_minutes::numeric / 60.0, 2) AS delta_hours,
    q.id                           AS qbo_invoice_log_id,
    q.status                       AS invoice_status,
    q.sent_at                      AS invoice_sent_at,
    q.total_amount_cents           AS invoice_total_cents
FROM drift d
JOIN public.projects p
    ON p.id = d.canonical_project_id
LEFT JOIN public.qbo_invoice_log q
    ON  q.company_id   = p.company_id
    AND q.report_year  = EXTRACT(YEAR  FROM d.summary_month)::int
    AND q.report_month = EXTRACT(MONTH FROM d.summary_month)::int
ORDER BY d.summary_month DESC, ABS(d.delta_minutes) DESC;
