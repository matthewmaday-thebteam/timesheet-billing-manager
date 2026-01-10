-- ============================================================================
-- 006: Create View for Normalized Timesheet Entries
-- ============================================================================
-- This view normalizes raw Clockify entries for the dashboard.
-- It ensures all required fields are present with proper defaults.
-- The frontend queries this view instead of the raw table.
-- ============================================================================

-- Drop existing view if it exists
DROP VIEW IF EXISTS v_timesheet_entries;

-- Create the normalized view
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
    COALESCE(task_key, COALESCE(task_name, 'No Task')) AS task_key
FROM timesheet_daily_rollups
WHERE total_minutes IS NOT NULL AND total_minutes > 0;

-- Grant read access
GRANT SELECT ON v_timesheet_entries TO authenticated;
GRANT SELECT ON v_timesheet_entries TO anon;

-- ============================================================================
-- Optional: Create an aggregated rollup view (if you need pre-aggregated data)
-- This groups raw entries by date, project, user, and task
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
    COALESCE(task_key, COALESCE(task_name, 'No Task')) AS task_key
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
    task_key;

-- Grant read access
GRANT SELECT ON v_timesheet_daily_rollups TO authenticated;
GRANT SELECT ON v_timesheet_daily_rollups TO anon;
