-- ============================================================================
-- Migration 108: Remove default_transaction_read_only flag from mcp_reader
-- ============================================================================
-- Purpose:
--   Migration 103 set `ALTER ROLE mcp_reader SET default_transaction_read_only = on`
--   as a defense-in-depth measure. In practice the flag is illusory and
--   actively breaks the auth path:
--
--     - The Edge Function authenticates as `mcp_reader` and calls
--       SECURITY DEFINER functions owned by `mcp_owner`.
--     - `transaction_read_only` is a transaction-level GUC that applies to
--       the entire transaction regardless of which role is currently
--       executing inside SECURITY DEFINER bodies.
--     - The auth path performs essential writes:
--         _authenticate_and_consume → UPDATE api_keys.last_used_at +
--                                      INSERT/UPDATE rate_limit_buckets
--         api_log_request           → INSERT api_audit_log
--     - All of these fail with "cannot execute UPDATE in a read-only
--       transaction" once the role default kicks in.
--
--   The actual access control is the privilege grant: `mcp_reader` has
--   EXECUTE on the 11 curated `api_*` functions only and no direct
--   privileges on any table or view. The read_only flag added no real
--   protection on top of that.
--
--   This migration removes the flag. Other timeouts and the search_path
--   setting from 103 remain intact.
--
--   Postulate #0: this only affects mcp_reader's session defaults; no
--   public.* object is touched.
-- ============================================================================

BEGIN;

ALTER ROLE mcp_reader RESET default_transaction_read_only;

COMMIT;
