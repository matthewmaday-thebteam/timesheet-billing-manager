-- ============================================================================
-- Migration 058: Add send_weekly_report to projects
-- ============================================================================
-- Boolean flag to opt a project into weekly summary reports sent to its
-- assigned project managers.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS send_weekly_report BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN projects.send_weekly_report IS
    'When true, weekly summary reports are sent to project managers assigned to this project.';

-- ============================================================================
-- Recreate v_project_table_entities to pick up the new column.
-- PostgreSQL views with SELECT * freeze column lists at creation time.
-- DROP + CREATE is required because the new column shifts positions,
-- which CREATE OR REPLACE cannot handle.
-- ============================================================================
DROP VIEW IF EXISTS v_project_table_entities;
CREATE VIEW v_project_table_entities AS
SELECT
    p.*,
    vpc.role AS grouping_role,
    vpc.group_id,
    COALESCE(
        (
            SELECT COUNT(*)::INTEGER
            FROM project_group_members m
            WHERE m.group_id = vpc.group_id
        ),
        0
    ) AS member_count,
    c.id AS company_uuid,
    COALESCE(c.display_name, c.client_name, p.client_name) AS company_display_name
FROM projects p
LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
LEFT JOIN companies c ON c.client_id = p.client_id
LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
WHERE vpc.role IS NULL OR vpc.role != 'member';

COMMENT ON VIEW v_project_table_entities IS 'Returns projects visible in the Projects table (primaries and unassociated, excludes members). Includes company display info.';
