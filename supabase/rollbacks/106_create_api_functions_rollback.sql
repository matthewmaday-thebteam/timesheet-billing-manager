-- ============================================================================
-- Rollback for migration 106
-- ============================================================================
-- Drop the 11 api_* tools, the helpers, and the internal aggregation kernel.
-- Order doesn't matter much (no FK between functions), but we drop tools
-- first, then helpers, then the kernel.
-- ============================================================================

BEGIN;

-- 11 tools
DROP FUNCTION IF EXISTS mcp_api.api_verify_employee_week(UUID, DATE, NUMERIC);
DROP FUNCTION IF EXISTS mcp_api.api_get_employee_time_off(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS mcp_api.api_get_employee_projects(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS mcp_api.api_get_employee_week_summary(UUID, DATE);
DROP FUNCTION IF EXISTS mcp_api.api_get_employee_hours(UUID, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS mcp_api.api_resolve_date_range(TEXT, DATE);
DROP FUNCTION IF EXISTS mcp_api.api_resolve_project(TEXT, TEXT);
DROP FUNCTION IF EXISTS mcp_api.api_resolve_employee(TEXT);
DROP FUNCTION IF EXISTS mcp_api.api_list_companies();
DROP FUNCTION IF EXISTS mcp_api.api_list_projects();
DROP FUNCTION IF EXISTS mcp_api.api_list_employees();

-- Internal kernel
DROP FUNCTION IF EXISTS mcp_api._internal_aggregate_employee_hours(UUID, DATE, DATE, TEXT);

-- Helpers
DROP FUNCTION IF EXISTS mcp_api.api_log_request(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS mcp_api._authenticate_and_consume(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS mcp_api.api_consume_rate_limit(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS mcp_api.api_authenticate_key(TEXT);

COMMIT;
