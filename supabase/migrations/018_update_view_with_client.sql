-- ============================================================================
-- 018: Update Timesheet Views to Include Client/Company Columns
-- ============================================================================
-- Adds client_id and client_name to v_timesheet_entries and
-- v_timesheet_daily_rollups views for Company => Project grouping.
--
-- Depends on: 017_add_client_columns.sql (client columns in base table)
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
    -- NEW: Client/Company columns
    COALESCE(client_id, '') AS client_id,
    COALESCE(client_name, 'Unassigned') AS client_name
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
    -- NEW: Client/Company columns
    COALESCE(client_id, '') AS client_id,
    COALESCE(client_name, 'Unassigned') AS client_name
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

-- Report results
DO $$
BEGIN
    RAISE NOTICE '018 complete: Added client_id and client_name to timesheet views';
END $$;

COMMIT;
