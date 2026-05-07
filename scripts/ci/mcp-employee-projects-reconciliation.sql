-- ============================================================================
-- mcp-employee-projects-reconciliation.sql
--
-- Cross-view reconciliation: per canonical employee, the total rounded hours
-- attributed by the Layer 3 path (powering v_api_employee_daily) must agree
-- with the total rounded hours attributed by the Layer 2 path (powering
-- v_api_employee_project_daily) within a small tolerance.
--
-- Why we DO NOT compare SUM(rounded_hours) from each view directly:
--   - v_api_employee_daily reads Layer 3 (employee_daily_totals), which
--     rounds ONCE per (user_id, client_id, work_date) row.
--   - v_api_employee_project_daily reads Layer 2 (employee_totals), which
--     rounds ONCE per (user_id, project_id, task_name, client_id, work_date)
--     row — i.e. N times per day for an employee with N task rows.
--   Summing pre-rounded hours from each view therefore introduces an
--   accumulating rounding asymmetry: ~0.005h × tasks/day can build up to
--   well over 0.01h across a 90-day window even when the underlying source
--   data agrees perfectly. That produced false positives in CI.
--
-- Apples-to-apples path (this script):
--   Both Layer 2 and Layer 3 are derived from the same source —
--   timesheet_daily_rollups.rounded_minutes (the integer-minute, source-of-
--   truth canonical rounding). We aggregate INTEGER minutes per canonical
--   employee on each side (mirroring the canonical-employee mapping each
--   view performs), divide by 60.0 and ROUND exactly ONCE per side. Any
--   delta that exceeds the tolerance below indicates a genuine regression
--   in canonical mapping or rollup coverage — never a rounding artifact.
--
-- USAGE:
--   psql "$URL" -v ON_ERROR_STOP=1 \
--      -v mcp.recon_period_start='2026-01-01' \
--      -v mcp.recon_period_end='2026-04-30' \
--      -f scripts/ci/mcp-employee-projects-reconciliation.sql
--
--   When the period vars are absent, defaults to last 90 days ending today
--   (UTC). Tolerance is 0.01h per employee (well under one rounding step,
--   safe because both sides round only once over identical integer-minute
--   sums).
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

    -- Per-employee comparison.
    --
    -- Both sides aggregate INTEGER rounded_minutes from the same source-of-
    -- truth (timesheet_daily_rollups, materialized into Layer 2/3 by
    -- populate_layer2_totals in migration 091), mirroring the canonical-
    -- employee join that each MCP view performs:
    --
    --   Layer 3 path (v_api_employee_daily):
    --     employee_daily_totals
    --       -> resources (user_id -> id)
    --       -> v_entity_canonical (entity_id -> canonical_entity_id)
    --     No canonical-role filter — matches the view exactly.
    --
    --   Layer 2 path (v_api_employee_project_daily):
    --     employee_totals
    --       -> resource_user_associations (user_id -> resource_id)
    --       -> v_entity_canonical (entity_id -> canonical_entity_id)
    --       -> v_project_canonical (filter role IN primary/unassociated)
    --       -> v_entity_canonical  (filter role IN primary/unassociated)
    --     The view applies both role filters, so we mirror them here.
    --
    -- Each side performs ROUND(SUM(rounded_minutes)/60.0, 2) ONCE — there is
    -- no per-row pre-rounding, so the delta cannot reflect rounding
    -- asymmetry. It can only reflect (a) rollup coverage gaps between
    -- Layer 2 and Layer 3, or (b) canonical-mapping drift between the two
    -- join paths above. Both are real regressions worth surfacing.
    CREATE TEMP TABLE _recon ON COMMIT DROP AS
    WITH layer3_minutes AS (
        SELECT vec.canonical_entity_id                              AS canonical_employee_id,
               SUM(COALESCE(edt.rounded_minutes, 0))::BIGINT        AS rounded_minutes
          FROM public.employee_daily_totals edt
          JOIN public.resources r
            ON r.user_id = edt.user_id
          JOIN public.v_entity_canonical vec
            ON vec.entity_id = r.id
         WHERE edt.work_date BETWEEN v_period_start AND v_period_end
         GROUP BY vec.canonical_entity_id
    ),
    layer2_minutes AS (
        SELECT vec.canonical_entity_id                              AS canonical_employee_id,
               SUM(COALESCE(et.rounded_minutes, 0))::BIGINT         AS rounded_minutes
          FROM public.employee_totals et
          JOIN public.resource_user_associations rua
            ON rua.user_id = et.user_id
          JOIN public.v_entity_canonical vec
            ON vec.entity_id = rua.resource_id
          JOIN public.projects p
            ON p.project_id = et.project_id
          JOIN public.v_project_canonical vpc
            ON vpc.project_id = p.id
         WHERE et.work_date BETWEEN v_period_start AND v_period_end
           AND vpc.role IN ('primary','unassociated')
           AND vec.role IN ('primary','unassociated')
         GROUP BY vec.canonical_entity_id
    )
    SELECT
        COALESCE(l3.canonical_employee_id, l2.canonical_employee_id) AS canonical_employee_id,
        ROUND(COALESCE(l3.rounded_minutes, 0) / 60.0, 2)             AS hours_from_daily,
        ROUND(COALESCE(l2.rounded_minutes, 0) / 60.0, 2)             AS hours_from_project,
        ROUND(
            (COALESCE(l3.rounded_minutes, 0) - COALESCE(l2.rounded_minutes, 0))
                / 60.0,
            2
        )                                                            AS delta
      FROM layer3_minutes l3
      FULL OUTER JOIN layer2_minutes l2
        ON l2.canonical_employee_id = l3.canonical_employee_id;

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
            E'between Layer 3 (v_api_employee_daily) and Layer 2 '
            E'(v_api_employee_project_daily) canonical-minute totals in '
            E'[% .. %] (tolerance=%h, max_abs_delta=%h).',
            v_drift_count, v_employees, v_period_start, v_period_end,
            v_tolerance, v_max_delta;
    END IF;

    RAISE NOTICE
        'mcp-employee-projects-reconciliation: % employees agree within %h in [% .. %] (max_abs_delta=%h).',
        v_employees, v_tolerance, v_period_start, v_period_end, v_max_delta;
END $$;
