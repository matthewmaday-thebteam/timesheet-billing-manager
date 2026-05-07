-- ============================================================================
-- Rollback for migration 109 — revoke USAGE on mcp_api from authenticated
-- ============================================================================
-- Restores the pre-109 state where authenticated could not see the mcp_api
-- schema. After this rollback the admin UI (/api-keys) will fail with
-- "Invalid schema: mcp_api" until either USAGE is regranted or the schema
-- is dropped via rollbacks 107..103.
-- ============================================================================

BEGIN;

REVOKE USAGE ON SCHEMA mcp_api FROM authenticated;

COMMIT;
