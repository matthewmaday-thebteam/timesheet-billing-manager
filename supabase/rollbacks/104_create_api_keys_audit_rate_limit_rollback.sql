-- ============================================================================
-- Rollback for migration 104 — drop control tables + redactor helper
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS mcp_api._redact_jsonb_params(JSONB);

DROP TABLE IF EXISTS mcp_api.rate_limit_buckets;
DROP TABLE IF EXISTS mcp_api.api_audit_log;
DROP TABLE IF EXISTS mcp_api.api_keys;

COMMIT;
