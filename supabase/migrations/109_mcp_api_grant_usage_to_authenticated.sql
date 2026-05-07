-- ============================================================================
-- Migration 109: Grant USAGE on mcp_api to authenticated for admin RPCs
-- ============================================================================
-- Purpose:
--   The frontend admin UI at /api-keys calls three admin RPCs in the
--   mcp_api schema via supabase.schema('mcp_api').rpc(...):
--     - admin_list_api_keys()
--     - admin_create_api_key(...)
--     - admin_revoke_api_key(...)
--
--   For PostgREST (the role authenticator) to dispatch these calls, the
--   `authenticated` role needs USAGE on the mcp_api schema. Migration 103
--   granted USAGE to mcp_owner and mcp_reader only.
--
--   The admin RPCs are SECURITY DEFINER and gated by _internal_assert_admin()
--   inside the function body, so granting USAGE does NOT expose admin
--   functionality to non-admins — only the schema's existence becomes
--   reachable to authenticated users; the admin gate inside each function
--   is what actually authorizes the call.
--
--   Companion configuration: PostgREST `db_schema` setting is updated in
--   Supabase project settings to include `mcp_api`. That part is not
--   captured in a migration — it lives in the project's API config.
-- ============================================================================

BEGIN;

GRANT USAGE ON SCHEMA mcp_api TO authenticated;

COMMIT;
