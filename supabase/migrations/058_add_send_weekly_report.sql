-- ============================================================================
-- Migration 058: Add send_weekly_report to projects
-- ============================================================================
-- Boolean flag to opt a project into weekly summary reports sent to its
-- assigned project managers.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS send_weekly_report BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN projects.send_weekly_report IS
    'When true, weekly summary reports are sent to project managers assigned to this project.';
