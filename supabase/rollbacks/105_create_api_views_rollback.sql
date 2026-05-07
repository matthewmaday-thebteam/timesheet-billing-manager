-- ============================================================================
-- Rollback for migration 105 — drop the 5 mcp_api views
-- ============================================================================
BEGIN;

DROP VIEW IF EXISTS mcp_api.v_api_employee_time_off;
DROP VIEW IF EXISTS mcp_api.v_api_employee_daily;
DROP VIEW IF EXISTS mcp_api.v_api_projects;
DROP VIEW IF EXISTS mcp_api.v_api_companies;
DROP VIEW IF EXISTS mcp_api.v_api_employees;

COMMIT;
