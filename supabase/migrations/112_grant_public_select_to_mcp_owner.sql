-- ============================================================================
-- Migration 112: Grant SELECT on public.* tables/views to mcp_owner
-- ============================================================================
-- Purpose:
--   Migrations 103-105 created the mcp_owner role and the v_api_* views,
--   but never granted mcp_owner the underlying SELECT privileges on the
--   public.* objects those views depend on. Postgres allows view creation
--   without source-table SELECT, so the migrations applied cleanly — but
--   any actual query through the views fails at runtime with
--   "permission denied for view <source>".
--
--   This migration grants the missing privileges. Each grant is the
--   minimum needed for one or more v_api_* views to function:
--
--     v_api_employees                → public.v_employee_table_entities,
--                                       public.resources, public.employment_types
--     v_api_companies                → public.companies, public.v_company_canonical
--     v_api_projects                 → public.projects, public.v_project_canonical,
--                                       public.companies
--     v_api_employee_daily           → public.employee_daily_totals,
--                                       public.resource_user_associations,
--                                       public.v_entity_canonical, public.resources,
--                                       public.physical_person_groups,
--                                       public.physical_person_group_members
--     v_api_employee_project_daily   → public.employee_totals + above
--     v_api_employee_time_off        → public.employee_time_off,
--                                       public.v_entity_canonical
--     _internal_assert_admin         → EXECUTE on public.is_admin(uuid)
--
--   These are all SELECT-only grants on read paths Manifest already
--   exposes elsewhere (admin-list-users, employee management, etc.).
--   No new financial column becomes reachable because the v_api_* views
--   project explicit non-financial columns only.
--
--   Postulate #0: this only adds privileges to mcp_owner. No public.*
--   table is altered.
-- ============================================================================

BEGIN;

GRANT USAGE ON SCHEMA public TO mcp_owner;

GRANT SELECT ON
    public.resources,
    public.v_employee_table_entities,
    public.v_entity_canonical,
    public.physical_person_groups,
    public.physical_person_group_members,
    public.resource_user_associations,
    public.companies,
    public.v_company_canonical,
    public.projects,
    public.v_project_canonical,
    public.project_group_members,
    public.employee_daily_totals,
    public.employee_totals,
    public.employee_time_off,
    public.employment_types
TO mcp_owner;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO mcp_owner;

COMMIT;
