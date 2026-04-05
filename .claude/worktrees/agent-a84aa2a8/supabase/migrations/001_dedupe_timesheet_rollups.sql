-- ============================================================================
-- 001: Deduplicate timesheet_daily_rollups
-- ============================================================================
-- Run this FIRST to clean up existing duplicates
-- ============================================================================

BEGIN;

CREATE TEMP TABLE rows_to_keep AS
SELECT DISTINCT ON (
    clockify_workspace_id,
    work_date,
    COALESCE(user_id, ''),
    COALESCE(project_id, ''),
    COALESCE(task_id, '')
) id
FROM timesheet_daily_rollups
ORDER BY
    clockify_workspace_id,
    work_date,
    COALESCE(user_id, ''),
    COALESCE(project_id, ''),
    COALESCE(task_id, ''),
    synced_at DESC NULLS LAST,
    id DESC;

CREATE TABLE IF NOT EXISTS _migration_audit_deleted_duplicates (
    deleted_at TIMESTAMPTZ DEFAULT NOW(),
    original_id UUID,
    clockify_workspace_id TEXT,
    work_date DATE,
    project_id TEXT,
    project_name TEXT,
    user_id TEXT,
    user_name TEXT,
    task_id TEXT,
    task_name TEXT,
    total_minutes INTEGER,
    synced_at TIMESTAMPTZ
);

INSERT INTO _migration_audit_deleted_duplicates (
    original_id, clockify_workspace_id, work_date, project_id, project_name,
    user_id, user_name, task_id, task_name, total_minutes, synced_at
)
SELECT id, clockify_workspace_id, work_date, project_id, project_name,
    user_id, user_name, task_id, task_name, total_minutes, synced_at
FROM timesheet_daily_rollups
WHERE id NOT IN (SELECT id FROM rows_to_keep);

DELETE FROM timesheet_daily_rollups
WHERE id NOT IN (SELECT id FROM rows_to_keep);

DROP TABLE rows_to_keep;

DO $$
DECLARE
    deleted_count INTEGER;
    remaining_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO deleted_count FROM _migration_audit_deleted_duplicates;
    SELECT COUNT(*) INTO remaining_count FROM timesheet_daily_rollups;
    RAISE NOTICE '001 complete: Deleted % duplicates, % rows remaining', deleted_count, remaining_count;
END $$;

COMMIT;
