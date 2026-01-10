-- ============================================================================
-- 002: Add Unique Constraint to timesheet_daily_rollups
-- ============================================================================
-- Run this AFTER 001 (deduplication) completes successfully
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS timesheet_daily_rollups_workspace_entry_unique
ON timesheet_daily_rollups (
    clockify_workspace_id,
    work_date,
    COALESCE(user_id, '__NULL__'),
    COALESCE(project_id, '__NULL__'),
    COALESCE(task_id, '__NULL__')
);

DO $$
BEGIN
    RAISE NOTICE '002 complete: Unique constraint added';
END $$;

COMMIT;
