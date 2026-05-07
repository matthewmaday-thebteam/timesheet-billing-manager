-- ============================================================================
-- mcp-manifest-lockin.sql
--
-- Compile-only view that touches every public.* column the MCP slice depends
-- on. If upstream renames or drops any of these columns, this view fails to
-- create and the CI step fails — surfacing the breaking change BEFORE it
-- reaches the views/functions that the MCP runtime executes.
--
-- This view is intentionally:
--   - Created once per CI run as a temporary view (CREATE OR REPLACE).
--   - Never read by any application code.
--   - Dropped at the end of the script.
--
-- USAGE:
--   psql "$URL" -v ON_ERROR_STOP=1 -f scripts/ci/mcp-manifest-lockin.sql
-- ============================================================================

CREATE OR REPLACE VIEW mcp_api.zz_manifest_lockin AS
SELECT
    -- public.resources columns we depend on (via v_employee_table_entities,
    -- v_entity_canonical, and the join in v_api_employee_daily).
    r.id                AS r_id,
    r.user_id           AS r_user_id,
    r.first_name        AS r_first_name,
    r.last_name         AS r_last_name,
    r.external_label    AS r_external_label,

    -- public.employment_types
    et.name             AS et_name,

    -- public.companies columns we depend on.
    c.id                AS c_id,
    c.client_id         AS c_client_id,
    c.client_name       AS c_client_name,
    c.display_name      AS c_display_name,

    -- public.projects columns.
    p.id                AS p_id,
    p.project_name      AS p_project_name,
    p.company_id        AS p_company_id,
    p.first_seen_month  AS p_first_seen_month,

    -- public.employee_daily_totals (Layer 3) columns.
    edt.user_id         AS edt_user_id,
    edt.client_id       AS edt_client_id,
    edt.work_date       AS edt_work_date,
    edt.rounded_hours   AS edt_rounded_hours,

    -- public.employee_time_off columns we depend on (filtered to status='approved'
    -- inside the view).
    eto.resource_id     AS eto_resource_id,
    eto.start_date      AS eto_start_date,
    eto.end_date        AS eto_end_date,
    eto.total_days      AS eto_total_days,
    eto.time_off_type   AS eto_time_off_type,
    eto.status          AS eto_status,

    -- canonical helper views provided by migrations 015, 023, 030.
    vec.entity_id       AS vec_entity_id,
    vec.canonical_entity_id AS vec_canonical_entity_id,
    vec.role            AS vec_role,
    vpc.project_id      AS vpc_project_id,
    vpc.canonical_project_id AS vpc_canonical_project_id,
    vpc.role            AS vpc_role,
    vcc.company_id      AS vcc_company_id,
    vcc.canonical_company_id AS vcc_canonical_company_id,
    vcc.role            AS vcc_role,

    -- v_employee_table_entities columns referenced by mcp_api.v_api_employees.
    vte.id                  AS vte_id,
    vte.first_name          AS vte_first_name,
    vte.last_name           AS vte_last_name,
    vte.external_label      AS vte_external_label,
    vte.employment_type_name AS vte_employment_type_name
FROM public.resources r
LEFT JOIN public.employment_types et   ON et.id = r.employment_type_id
LEFT JOIN public.companies c           ON c.id IS NOT NULL
LEFT JOIN public.projects p            ON p.id IS NOT NULL
LEFT JOIN public.employee_daily_totals edt ON edt.user_id = r.user_id
LEFT JOIN public.employee_time_off eto ON eto.resource_id = r.id
LEFT JOIN public.v_entity_canonical vec ON vec.entity_id = r.id
LEFT JOIN public.v_project_canonical vpc ON vpc.project_id = p.id
LEFT JOIN public.v_company_canonical vcc ON vcc.company_id = c.id
LEFT JOIN public.v_employee_table_entities vte ON vte.id = r.id
WHERE FALSE;  -- compile-only; never returns rows.

DROP VIEW mcp_api.zz_manifest_lockin;

DO $$
BEGIN
    RAISE NOTICE 'mcp-manifest-lockin: every required public.* column is still present.';
END $$;
