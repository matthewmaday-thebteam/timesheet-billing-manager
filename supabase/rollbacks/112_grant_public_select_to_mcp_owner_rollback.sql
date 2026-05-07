-- ============================================================================
-- Rollback for migration 112 — revoke public.* SELECT from mcp_owner
-- ============================================================================
-- After this rollback every MCP query that touches public.* fails with
-- "permission denied for view <source>". Pair with rollbacks 111..103 if
-- decommissioning the MCP integration entirely.
-- ============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM mcp_owner;

REVOKE SELECT ON
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
FROM mcp_owner;

REVOKE USAGE ON SCHEMA public FROM mcp_owner;

COMMIT;
