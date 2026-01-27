-- ============================================================================
-- Migration 031: Add company display info to v_project_table_entities
-- ============================================================================
-- Purpose: Include company information in the project table view for display
-- ============================================================================

BEGIN;

-- Drop and recreate the view with company join
CREATE OR REPLACE VIEW v_project_table_entities AS
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
    -- Company display info (using canonical company mapping)
    c.id AS company_uuid,
    COALESCE(c.display_name, c.client_name, p.client_name) AS company_display_name
FROM projects p
LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
LEFT JOIN companies c ON c.client_id = p.client_id
LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
WHERE vpc.role IS NULL OR vpc.role != 'member';

COMMENT ON VIEW v_project_table_entities IS 'Returns projects visible in the Projects table (primaries and unassociated, excludes members). Includes company display info.';

-- Grant permissions
GRANT SELECT ON v_project_table_entities TO authenticated;

DO $$
BEGIN
    RAISE NOTICE '031 Project table entities with company migration complete';
END $$;

COMMIT;
