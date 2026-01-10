-- ============================================================================
-- 005: Rollback - Revert to Rollup-Based Model
-- ============================================================================
-- WARNING: This does NOT restore deleted duplicate rows.
-- Check _migration_audit_deleted_duplicates for archived data.
-- ============================================================================

BEGIN;

-- Drop the new partial unique index
DROP INDEX IF EXISTS timesheet_daily_rollups_ws_taskid_unique;

-- Recreate the old rollup-based unique constraint (if you need it back)
-- Uncomment if needed:
-- CREATE UNIQUE INDEX timesheet_daily_rollups_uniq
-- ON timesheet_daily_rollups (clockify_workspace_id, work_date, project_key, user_key, task_key);

DO $$
BEGIN
    RAISE NOTICE '005 rollback complete:';
    RAISE NOTICE '  - Partial unique index dropped';
    RAISE NOTICE '  - Deleted rows remain in _migration_audit_deleted_duplicates';
END $$;

COMMIT;
