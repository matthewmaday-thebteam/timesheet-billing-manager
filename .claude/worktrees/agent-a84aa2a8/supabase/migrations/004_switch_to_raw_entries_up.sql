-- ============================================================================
-- 004: Switch to Raw Clockify Time Entries Model
-- ============================================================================
-- Changes:
-- 1. Drop old rollup-based unique constraints
-- 2. Deduplicate rows by (clockify_workspace_id, task_id)
-- 3. Add partial unique index on (clockify_workspace_id, task_id) WHERE task_id IS NOT NULL
-- ============================================================================

BEGIN;

-- ============================================================================
-- Step 1: Drop existing unique constraints/indexes
-- ============================================================================

-- Drop the COALESCE-based index we created earlier (if exists)
DROP INDEX IF EXISTS timesheet_daily_rollups_workspace_entry_unique;

-- Drop the original rollup-based constraint (if exists)
ALTER TABLE timesheet_daily_rollups
DROP CONSTRAINT IF EXISTS timesheet_daily_rollups_uniq;

-- Also try dropping as an index (in case it was created as index not constraint)
DROP INDEX IF EXISTS timesheet_daily_rollups_uniq;

-- ============================================================================
-- Step 2: Deduplicate rows by (clockify_workspace_id, task_id)
-- Only for rows WHERE task_id IS NOT NULL
-- ============================================================================

-- Create temp table to identify rows to KEEP
-- Keep the row with most recent synced_at, then highest id as tiebreaker
CREATE TEMP TABLE rows_to_keep AS
SELECT DISTINCT ON (clockify_workspace_id, task_id) id
FROM timesheet_daily_rollups
WHERE task_id IS NOT NULL
ORDER BY clockify_workspace_id, task_id, synced_at DESC NULLS LAST, id DESC;

-- Archive duplicates before deleting
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
WHERE task_id IS NOT NULL
  AND id NOT IN (SELECT id FROM rows_to_keep);

-- Delete duplicates
DELETE FROM timesheet_daily_rollups
WHERE task_id IS NOT NULL
  AND id NOT IN (SELECT id FROM rows_to_keep);

DROP TABLE rows_to_keep;

-- ============================================================================
-- Step 3: Add partial unique index
-- Only enforces uniqueness when task_id IS NOT NULL
-- ============================================================================

CREATE UNIQUE INDEX timesheet_daily_rollups_ws_taskid_unique
ON timesheet_daily_rollups (clockify_workspace_id, task_id)
WHERE task_id IS NOT NULL;

-- ============================================================================
-- Step 4: Ensure useful indexes exist
-- ============================================================================

-- Keep/create index for date-based queries
CREATE INDEX IF NOT EXISTS idx_tdr_ws_date
ON timesheet_daily_rollups (clockify_workspace_id, work_date);

-- ============================================================================
-- Report results
-- ============================================================================

DO $$
DECLARE
    deleted_count INTEGER;
    remaining_count INTEGER;
    null_task_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO deleted_count FROM _migration_audit_deleted_duplicates;
    SELECT COUNT(*) INTO remaining_count FROM timesheet_daily_rollups;
    SELECT COUNT(*) INTO null_task_count FROM timesheet_daily_rollups WHERE task_id IS NULL;

    RAISE NOTICE '004 complete:';
    RAISE NOTICE '  - Deleted % duplicate rows', deleted_count;
    RAISE NOTICE '  - % total rows remaining', remaining_count;
    RAISE NOTICE '  - % rows with NULL task_id (not covered by unique index)', null_task_count;
    RAISE NOTICE '  - Partial unique index added on (clockify_workspace_id, task_id) WHERE task_id IS NOT NULL';
END $$;

COMMIT;
