-- ============================================================================
-- Migration 035: Fix Unassigned Client ID in Views
-- ============================================================================
-- Purpose: Update v_timesheet_entries to use '__UNASSIGNED__' for NULL client_ids
--          instead of empty string. This ensures:
--          1. Canonical company mapping finds the Unassigned company
--          2. Entries without a client appear under "Unassigned" in Revenue
-- ============================================================================

BEGIN;

-- ============================================================================
-- Update v_timesheet_entries view
-- ============================================================================
DROP VIEW IF EXISTS v_timesheet_entries;

CREATE VIEW v_timesheet_entries AS
SELECT
    id,
    clockify_workspace_id,
    work_date,
    COALESCE(project_id, '') AS project_id,
    COALESCE(project_name, 'No Project') AS project_name,
    COALESCE(user_id, '') AS user_id,
    COALESCE(user_name, 'Unknown User') AS user_name,
    task_id,
    COALESCE(task_name, 'No Task') AS task_name,
    COALESCE(total_minutes, 0) AS total_minutes,
    synced_at,
    COALESCE(project_key, COALESCE(project_name, 'No Project')) AS project_key,
    COALESCE(user_key, COALESCE(user_name, 'Unknown User')) AS user_key,
    COALESCE(task_key, COALESCE(task_name, 'No Task')) AS task_key,
    -- Use '__UNASSIGNED__' for NULL client_id so canonical mapping works
    COALESCE(NULLIF(client_id, ''), '__UNASSIGNED__') AS client_id,
    COALESCE(NULLIF(client_name, ''), 'Unassigned') AS client_name
FROM timesheet_daily_rollups
WHERE total_minutes IS NOT NULL AND total_minutes > 0;

-- Grant read access
GRANT SELECT ON v_timesheet_entries TO authenticated;
GRANT SELECT ON v_timesheet_entries TO anon;

-- ============================================================================
-- Update v_timesheet_daily_rollups view
-- ============================================================================
DROP VIEW IF EXISTS v_timesheet_daily_rollups;

CREATE VIEW v_timesheet_daily_rollups AS
SELECT
    clockify_workspace_id,
    work_date,
    COALESCE(project_id, '') AS project_id,
    COALESCE(project_name, 'No Project') AS project_name,
    COALESCE(user_id, '') AS user_id,
    COALESCE(user_name, 'Unknown User') AS user_name,
    COALESCE(task_name, 'No Task') AS task_name,
    SUM(COALESCE(total_minutes, 0)) AS total_minutes,
    MAX(synced_at) AS synced_at,
    COALESCE(project_key, COALESCE(project_name, 'No Project')) AS project_key,
    COALESCE(user_key, COALESCE(user_name, 'Unknown User')) AS user_key,
    COALESCE(task_key, COALESCE(task_name, 'No Task')) AS task_key,
    -- Use '__UNASSIGNED__' for NULL client_id so canonical mapping works
    COALESCE(NULLIF(client_id, ''), '__UNASSIGNED__') AS client_id,
    COALESCE(NULLIF(client_name, ''), 'Unassigned') AS client_name
FROM timesheet_daily_rollups
WHERE total_minutes IS NOT NULL AND total_minutes > 0
GROUP BY
    clockify_workspace_id,
    work_date,
    project_id,
    project_name,
    user_id,
    user_name,
    task_name,
    project_key,
    user_key,
    task_key,
    client_id,
    client_name;

-- Grant read access
GRANT SELECT ON v_timesheet_daily_rollups TO authenticated;
GRANT SELECT ON v_timesheet_daily_rollups TO anon;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '035 Fix Unassigned Client ID migration complete:';
    RAISE NOTICE '  - v_timesheet_entries now uses __UNASSIGNED__ for NULL client_ids';
    RAISE NOTICE '  - v_timesheet_daily_rollups now uses __UNASSIGNED__ for NULL client_ids';
    RAISE NOTICE '  - Entries without a client will now appear under "Unassigned" in Revenue';
END $$;

COMMIT;
