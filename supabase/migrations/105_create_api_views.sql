-- ============================================================================
-- Migration 105: mcp_api views (canonical, redacted projections of public.*)
-- ============================================================================
-- Purpose:
--   Define the five views that constitute the *only* read surface for the
--   MCP runtime. Every view:
--
--     1. Lives in mcp_api.
--     2. Is owned by mcp_owner.
--     3. Has security_invoker = false (i.e. runs with definer privileges).
--        We do NOT enable security_invoker per Condition 4 — the views are
--        the boundary, and if we flipped them to invoker semantics, mcp_reader
--        would need direct SELECT on every public.* table referenced. That
--        would shred the locked posture.
--     4. Lists every column EXPLICITLY (no wildcard SELECTs, ever).
--     5. Excludes every PII / financial / source-system field per Condition 10.
--
--   The five views:
--
--     v_api_employees           — canonical employee directory (one row per
--                                  canonical resource).
--     v_api_projects            — canonical project directory (one row per
--                                  canonical project), with canonical company.
--     v_api_companies           — canonical company directory.
--     v_api_employee_daily      — Layer 3 daily totals by canonical employee
--                                  + canonical company + day. Source of truth
--                                  for hour-aggregation tools.
--     v_api_employee_time_off   — approved time-off, by canonical employee.
--
--   Excluded fields (locked) per Condition 10:
--     - resources financial/capacity columns (cost, rate, hours-target, mode)
--     - resources.email (PII by audit policy in this surface)
--     - resources raw source-system id
--     - projects rate, target hours
--     - billing limits (min/max), carryover columns, the manual flag
--     - employee_time_off source-system ids, employee_email, notes
--     - employee_daily_totals entry_count, task_count
--     - employee_daily_totals minute-level columns (force consumers to one
--       unit: hours.)
-- ============================================================================

BEGIN;

SET LOCAL search_path = mcp_api, public;

-- ----------------------------------------------------------------------------
-- 1. v_api_employees
-- ----------------------------------------------------------------------------
-- One row per canonical employee. We only surface employees that appear in
-- v_employee_table_entities (i.e. primaries and unassociated; members are
-- hidden, matching every other reporting surface).
--
-- Display name strategy (mirrors the public directory):
--     COALESCE(NULLIF(TRIM(first_name||' '||last_name), ''), external_label, 'Unknown')
--
-- We do not expose user_id, email, monthly_cost, hourly_rate, expected_hours,
-- billing_mode, employment_type_id, group_id, member_count.

CREATE OR REPLACE VIEW mcp_api.v_api_employees AS
SELECT
    vte.id                                                   AS canonical_employee_id,
    COALESCE(
        NULLIF(TRIM(BOTH ' ' FROM CONCAT_WS(' ', vte.first_name, vte.last_name)), ''),
        vte.external_label,
        'Unknown Employee'
    )                                                        AS display_name,
    vte.first_name                                           AS first_name,
    vte.last_name                                            AS last_name,
    vte.external_label                                       AS external_label,
    vte.employment_type_name                                 AS employment_type
FROM public.v_employee_table_entities vte;

ALTER VIEW mcp_api.v_api_employees OWNER TO mcp_owner;

COMMENT ON VIEW mcp_api.v_api_employees IS
    'Canonical employee directory for MCP. One row per primary/unassociated '
    'resource. Excludes member resources, PII (email), and every financial '
    'field. Column drift is enforced by mcp-schema-snapshot.sql.';

-- ----------------------------------------------------------------------------
-- 2. v_api_companies
-- ----------------------------------------------------------------------------
-- One row per canonical company (companies that are unassociated or primaries
-- of a company group).

CREATE OR REPLACE VIEW mcp_api.v_api_companies AS
SELECT
    c.id                                                     AS canonical_company_id,
    COALESCE(NULLIF(TRIM(c.display_name), ''), c.client_name) AS display_name,
    c.client_name                                            AS source_name
FROM public.companies c
JOIN public.v_company_canonical vcc
    ON vcc.company_id = c.id
WHERE vcc.role IN ('primary','unassociated');

ALTER VIEW mcp_api.v_api_companies OWNER TO mcp_owner;

COMMENT ON VIEW mcp_api.v_api_companies IS
    'Canonical company directory for MCP. Excludes member companies. Does not '
    'surface the manual-origin flag, notes, or any financial field.';

-- ----------------------------------------------------------------------------
-- 3. v_api_projects
-- ----------------------------------------------------------------------------
-- One row per canonical project, joined to the canonical company. Canonical
-- project resolution mirrors migration 095 (project_groups +
-- project_group_members → primary_project_id; otherwise own id).

CREATE OR REPLACE VIEW mcp_api.v_api_projects AS
SELECT
    p.id                                                     AS canonical_project_id,
    p.project_name                                           AS project_name,
    -- Resolve canonical company through v_company_canonical so projects on a
    -- member company point to the primary company id.
    COALESCE(vcc.canonical_company_id, p.company_id)         AS canonical_company_id,
    COALESCE(NULLIF(TRIM(c.display_name), ''), c.client_name) AS company_display_name,
    p.first_seen_month                                       AS first_seen_month
FROM public.projects p
JOIN public.v_project_canonical vpc
    ON vpc.project_id = p.id
LEFT JOIN public.v_company_canonical vcc
    ON vcc.company_id = p.company_id
LEFT JOIN public.companies c
    ON c.id = COALESCE(vcc.canonical_company_id, p.company_id)
WHERE vpc.role IN ('primary','unassociated');

ALTER VIEW mcp_api.v_api_projects OWNER TO mcp_owner;

COMMENT ON VIEW mcp_api.v_api_projects IS
    'Canonical project directory for MCP. Excludes member projects. Does not '
    'surface rate, target hours, billing limits, carryover, or the '
    'manual-origin flag.';

-- ----------------------------------------------------------------------------
-- 4. v_api_employee_daily
-- ----------------------------------------------------------------------------
-- Layer 3 (employee_daily_totals) projected to canonical ids. Note we pivot
-- via resources.user_id -> resources.id -> v_entity_canonical to obtain the
-- canonical_employee_id, and via companies.client_id -> companies.id ->
-- v_company_canonical for canonical_company_id. The view emits ONLY rounded
-- hours — never minutes, entry_count, task_count, or the raw user_id/client_id.

CREATE OR REPLACE VIEW mcp_api.v_api_employee_daily AS
SELECT
    vec.canonical_entity_id                                  AS canonical_employee_id,
    COALESCE(vcc.canonical_company_id, c.id)                 AS canonical_company_id,
    edt.work_date                                            AS work_date,
    edt.rounded_hours                                        AS rounded_hours
FROM public.employee_daily_totals edt
JOIN public.resources r
    ON r.user_id = edt.user_id
JOIN public.v_entity_canonical vec
    ON vec.entity_id = r.id
LEFT JOIN public.companies c
    ON c.client_id = edt.client_id
LEFT JOIN public.v_company_canonical vcc
    ON vcc.company_id = c.id;

ALTER VIEW mcp_api.v_api_employee_daily OWNER TO mcp_owner;

COMMENT ON VIEW mcp_api.v_api_employee_daily IS
    'Per canonical-employee, canonical-company, work_date totals for MCP. '
    'Hours only — minute-level fields and counts are intentionally excluded.';

-- ----------------------------------------------------------------------------
-- 5. v_api_employee_time_off
-- ----------------------------------------------------------------------------
-- Approved-only time off, projected to the canonical employee. We never
-- surface the bamboo_* ids or notes.
--
-- The employee_time_off DDL lives outside version control (ad-hoc migration);
-- the manifest-mcp/README.md captures the schema we depend on.

CREATE OR REPLACE VIEW mcp_api.v_api_employee_time_off AS
SELECT
    vec.canonical_entity_id                                  AS canonical_employee_id,
    eto.start_date                                           AS start_date,
    eto.end_date                                             AS end_date,
    eto.total_days                                           AS total_days,
    eto.time_off_type                                        AS time_off_type,
    eto.status                                               AS status
FROM public.employee_time_off eto
JOIN public.resources r
    ON r.id = eto.resource_id
JOIN public.v_entity_canonical vec
    ON vec.entity_id = r.id
WHERE eto.status = 'approved';

ALTER VIEW mcp_api.v_api_employee_time_off OWNER TO mcp_owner;

COMMENT ON VIEW mcp_api.v_api_employee_time_off IS
    'Approved time-off events per canonical employee. Bamboo source ids, '
    'employee_email, and notes are excluded.';

-- ----------------------------------------------------------------------------
-- 6. Privileges
-- ----------------------------------------------------------------------------
-- Views are NOT exposed to mcp_reader directly. Reader only EXECUTEs the
-- api_* SECURITY DEFINER functions in migration 106, which then SELECT from
-- these views with mcp_owner privileges. We still REVOKE explicitly.

REVOKE ALL ON mcp_api.v_api_employees         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON mcp_api.v_api_companies         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON mcp_api.v_api_projects          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON mcp_api.v_api_employee_daily    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON mcp_api.v_api_employee_time_off FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    RAISE NOTICE '105 mcp_api views migration complete:';
    RAISE NOTICE '  - mcp_api.v_api_employees';
    RAISE NOTICE '  - mcp_api.v_api_companies';
    RAISE NOTICE '  - mcp_api.v_api_projects';
    RAISE NOTICE '  - mcp_api.v_api_employee_daily';
    RAISE NOTICE '  - mcp_api.v_api_employee_time_off';
    RAISE NOTICE '  All owned by mcp_owner; no security_invoker; no wildcard SELECTs.';
END $$;

COMMIT;
