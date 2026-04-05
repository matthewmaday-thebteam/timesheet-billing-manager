-- ============================================================================
-- 003: Rollback - Remove Unique Constraint
-- ============================================================================
-- Only run this if you need to undo 002
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS timesheet_daily_rollups_workspace_entry_unique;

DO $$
BEGIN
    RAISE NOTICE '003 complete: Unique constraint removed';
END $$;

COMMIT;
