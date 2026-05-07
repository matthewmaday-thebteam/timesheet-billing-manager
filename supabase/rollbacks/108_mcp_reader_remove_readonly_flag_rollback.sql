-- ============================================================================
-- Rollback for migration 108 — restore default_transaction_read_only flag
-- ============================================================================
-- Restores the (illusory) defense-in-depth flag on mcp_reader. After this
-- rollback the auth path will start failing with read-only-transaction
-- errors, so this rollback should be paired with rollbacks 107..103 that
-- drop the dependent SECURITY DEFINER functions entirely.
-- ============================================================================

BEGIN;

ALTER ROLE mcp_reader SET default_transaction_read_only = on;

COMMIT;
