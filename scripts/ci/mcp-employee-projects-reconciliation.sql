-- ============================================================================
-- mcp-employee-projects-reconciliation.sql
--
-- Cross-view reconciliation: per canonical employee, the SUM of rounded_hours
-- in v_api_employee_project_daily must equal the SUM of rounded_hours in
-- v_api_employee_daily within a small tolerance.
--
-- Why:
--   v_api_employee_daily reads Layer 3 (employee_daily_totals)
--     -> grouped by (user_id, client_id, work_date).
--   v_api_employee_project_daily reads Layer 2 (employee_totals)
--     -> grouped by (user_id, project_id, task_name, client_id, work_date).
--   Both materialize from the same source rows; rounding is applied at the
--   Layer 2 row level (per-task) and Layer 3 collapses by SUM. Either layer
--   should produce the same per-employee per-day rounded total — drift
--   between them indicates a regression in either rollup.
--
-- USAGE:
--   psql "$URL" -v ON_ERROR_STOP=1 \
--      -v mcp.recon_period_start='2026-01-01' \
--      -v mcp.recon_period_end='2026-04-30' \
--      -f scripts/ci/mcp-employee-projects-reconciliation.sql
--
--   When the period vars are absent, defaults to last 90 days ending today
--   (UTC). Tolerance is 0.01h per employee (well under one rounding step).
-- ============================================================================

DO $$
DECLARE
    v_period_start  DATE := COALESCE(
        NULLIF(current_setting('mcp.recon_period_start', true), '')::DATE,
        (CURRENT_DATE - 89)::DATE
    );
    v_period_end    DATE := COALESCE(
        NULLIF(current_setting('mcp.recon_period_end', true), '')::DATE,
        CURRENT_DATE
    );
    v_tolerance     NUMERIC := 0.01;  -- hours
    v_drift_count   INTEGER := 0;
    v_employees     INTEGER := 0;
    v_max_delta     NUMERIC := 0;
    drift_row       RECORD;
BEGIN
    IF v_period_start > v_period_end THEN
        RAISE EXCEPTION
            'mcp-employee-projects-reconciliation: period_start (%) > period_end (%).',
            v_period_start, v_period_end;
    END IF;

    -- Build a per-employee comparison: total rounded_hours from each view in
    -- the same window, then surface every employee whose delta exceeds
    -- v_tolerance.
    CREATE TEMP TABLE _recon ON COMMIT DROP AS
    WITH employee_daily AS (
        SELECT d.canonical_employee_id,
               ROUND(SUM(d.rounded_hours)::numeric, 2) AS hours_from_daily
          FROM mcp_api.v_api_employee_daily d
         WHERE d.work_date BETWEEN v_period_start AND v_period_end
         GROUP BY d.canonical_employee_id
    ),
    employee_project AS (
        SELECT d.canonical_employee_id,
               ROUND(SUM(d.rounded_hours)::numeric, 2) AS hours_from_project
          FROM mcp_api.v_api_employee_project_daily d
         WHERE d.work_date BETWEEN v_period_start AND v_period_end
         GROUP BY d.canonical_employee_id
    )
    SELECT
        COALESCE(ed.canonical_employee_id, ep.canonical_employee_id) AS canonical_employee_id,
        COALESCE(ed.hours_from_daily,   0) AS hours_from_daily,
        COALESCE(ep.hours_from_project, 0) AS hours_from_project,
        ROUND((COALESCE(ed.hours_from_daily, 0)
             - COALESCE(ep.hours_from_project, 0))::numeric, 2) AS delta
    FROM employee_daily ed
    FULL OUTER JOIN employee_project ep
        ON ep.canonical_employee_id = ed.canonical_employee_id;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE ABS(delta) > v_tolerance),
           COALESCE(MAX(ABS(delta)), 0)
      INTO v_employees, v_drift_count, v_max_delta
      FROM _recon;

    IF v_drift_count > 0 THEN
        FOR drift_row IN
            SELECT canonical_employee_id, hours_from_daily, hours_from_project, delta
              FROM _recon
             WHERE ABS(delta) > v_tolerance
             ORDER BY ABS(delta) DESC
             LIMIT 10
        LOOP
            RAISE NOTICE
                '  drift: employee=%  daily=%h  project=%h  delta=%h',
                drift_row.canonical_employee_id,
                drift_row.hours_from_daily,
                drift_row.hours_from_project,
                drift_row.delta;
        END LOOP;

        RAISE EXCEPTION
            E'mcp-employee-projects-reconciliation: % of % employees drifted '
            E'between v_api_employee_daily and v_api_employee_project_daily '
            E'in [% .. %] (tolerance=%h, max_abs_delta=%h).',
            v_drift_count, v_employees, v_period_start, v_period_end,
            v_tolerance, v_max_delta;
    END IF;

    RAISE NOTICE
        'mcp-employee-projects-reconciliation: % employees agree within %h in [% .. %] (max_abs_delta=%h).',
        v_employees, v_tolerance, v_period_start, v_period_end, v_max_delta;
END $$;
