-- ============================================================================
-- 019: Fix Project Auto-Creation Trigger
-- ============================================================================
-- PROBLEM:
--   The original trigger (trg_auto_create_project) only fires on INSERT.
--   When n8n does an UPSERT and the row exists, it becomes an UPDATE,
--   so new projects from those entries are never created.
--
-- FIX:
--   1. Update trigger to fire on INSERT OR UPDATE
--   2. Backfill any missing projects from existing timesheet data
--
-- Depends on: 009_create_projects_table.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- Step 1: Update the trigger function to handle both INSERT and UPDATE
-- ============================================================================
-- The function itself doesn't need changes - upsert_project_from_timesheet
-- already handles duplicates with ON CONFLICT DO UPDATE.

-- ============================================================================
-- Step 2: Recreate the trigger to fire on INSERT OR UPDATE
-- ============================================================================
DROP TRIGGER IF EXISTS trg_auto_create_project ON timesheet_daily_rollups;

CREATE TRIGGER trg_auto_create_project
  AFTER INSERT OR UPDATE ON timesheet_daily_rollups
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_project_from_rollup();

-- ============================================================================
-- Step 3: Backfill missing projects from existing timesheet data
-- ============================================================================
-- This catches any projects that were missed due to the INSERT-only trigger.

INSERT INTO projects (project_id, project_name)
SELECT DISTINCT project_id, project_name
FROM timesheet_daily_rollups
WHERE project_id IS NOT NULL
  AND project_id != ''
  AND project_name IS NOT NULL
  AND project_name != ''
  AND project_id NOT IN (SELECT project_id FROM projects)
ON CONFLICT (project_id) DO UPDATE
  SET project_name = EXCLUDED.project_name
  WHERE projects.project_name != EXCLUDED.project_name;

-- ============================================================================
-- Report results
-- ============================================================================
DO $$
DECLARE
  project_count INTEGER;
  new_projects INTEGER;
BEGIN
  SELECT COUNT(*) INTO project_count FROM projects;

  -- Count projects that were just added (created_at within last minute)
  SELECT COUNT(*) INTO new_projects
  FROM projects
  WHERE created_at > NOW() - INTERVAL '1 minute';

  RAISE NOTICE '019 complete: % projects total, % newly backfilled', project_count, new_projects;
END $$;

COMMIT;
