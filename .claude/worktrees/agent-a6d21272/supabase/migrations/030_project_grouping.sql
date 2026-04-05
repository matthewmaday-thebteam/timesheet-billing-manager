-- ============================================================================
-- Migration 030: Project Grouping
-- ============================================================================
-- Purpose: Allow admins to group multiple project entities (from different
-- time tracking systems) that represent the same real-world project.
--
-- Key concepts:
--   - Primary project: The anchor project for a group (shown in Projects table)
--   - Member project: A project associated to a group (hidden from Projects table)
--   - Unassociated project: A project not in any group (shown in Projects table)
--   - Canonical project: The Primary project ID for grouped projects, or own ID if unassociated
--
-- Business rules (mirroring company grouping):
--   BR-1: A project can belong to 0 or 1 group
--   BR-2: A group is created only when an admin adds the first member
--   BR-3: Only unassociated projects can be added as members
--   BR-4: The Primary project never appears in the "Project Associations" list
--   BR-5: The Primary project cannot be removed from its group
--   BR-6: A group is dissolved if it has zero members
--   BR-7: Member projects are hidden from Projects table
--   BR-8: Reports aggregate by canonical project (Primary)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create project_groups table
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The primary project for this group (anchor)
    primary_project_id UUID NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Enforce: each project can be primary of at most one group
    CONSTRAINT uq_project_groups_primary_project
        UNIQUE(primary_project_id),

    -- FK to projects with RESTRICT - cannot delete project if it's a group primary
    CONSTRAINT fk_project_groups_primary_project
        FOREIGN KEY (primary_project_id)
        REFERENCES projects(id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_pg_primary_project_id
    ON project_groups(primary_project_id);

COMMENT ON TABLE project_groups IS 'Groups projects. A group is anchored by a primary project.';
COMMENT ON COLUMN project_groups.primary_project_id IS 'The primary/anchor project for this group.';

-- ============================================================================
-- STEP 2: Create project_group_members table
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The group this member belongs to
    group_id UUID NOT NULL,

    -- The member project
    member_project_id UUID NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- BR-1: Project can belong to at most one group
    CONSTRAINT uq_pgm_member_project
        UNIQUE(member_project_id),

    -- FK to group - CASCADE delete: if group is dissolved, members are released
    CONSTRAINT fk_pgm_group
        FOREIGN KEY (group_id)
        REFERENCES project_groups(id)
        ON DELETE CASCADE,

    -- FK to projects - CASCADE delete: if member project is deleted, remove from group
    CONSTRAINT fk_pgm_member_project
        FOREIGN KEY (member_project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pgm_group_id ON project_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_pgm_member_project_id ON project_group_members(member_project_id);

COMMENT ON TABLE project_group_members IS 'Members of a project group. Members are hidden from the projects table.';

-- ============================================================================
-- STEP 3: Updated_at trigger for project_groups
-- ============================================================================

DROP TRIGGER IF EXISTS trg_project_groups_updated_at ON project_groups;
CREATE TRIGGER trg_project_groups_updated_at
    BEFORE UPDATE ON project_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: Trigger - Prevent member from being a primary (BR-3, BR-4)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_prevent_project_member_as_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check 1: New member cannot already be a primary
    IF EXISTS (
        SELECT 1 FROM project_groups
        WHERE primary_project_id = NEW.member_project_id
    ) THEN
        RAISE EXCEPTION 'Project % is already a primary and cannot be added as a member',
            NEW.member_project_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Check 2: New member cannot be the primary of the group being joined
    IF EXISTS (
        SELECT 1 FROM project_groups
        WHERE id = NEW.group_id AND primary_project_id = NEW.member_project_id
    ) THEN
        RAISE EXCEPTION 'Cannot add primary project as a member of its own group'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pgm_prevent_member_as_primary ON project_group_members;
CREATE TRIGGER trg_pgm_prevent_member_as_primary
    BEFORE INSERT ON project_group_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_prevent_project_member_as_primary();

-- ============================================================================
-- STEP 5: Trigger - Prevent primary from being a member
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_prevent_project_primary_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM project_group_members
        WHERE member_project_id = NEW.primary_project_id
    ) THEN
        RAISE EXCEPTION 'Project % is already a member and cannot be a primary',
            NEW.primary_project_id
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pg_prevent_primary_as_member ON project_groups;
CREATE TRIGGER trg_pg_prevent_primary_as_member
    BEFORE INSERT ON project_groups
    FOR EACH ROW
    EXECUTE FUNCTION trg_prevent_project_primary_as_member();

-- ============================================================================
-- STEP 6: Trigger - Auto-dissolve empty groups (BR-6)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_auto_dissolve_empty_project_group()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM project_group_members
        WHERE group_id = OLD.group_id
    ) THEN
        DELETE FROM project_groups WHERE id = OLD.group_id;
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pgm_auto_dissolve ON project_group_members;
CREATE TRIGGER trg_pgm_auto_dissolve
    AFTER DELETE ON project_group_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_auto_dissolve_empty_project_group();

-- ============================================================================
-- STEP 7: View - v_project_canonical (Canonical Project Mapping)
-- ============================================================================

CREATE OR REPLACE VIEW v_project_canonical AS
WITH project_roles AS (
    SELECT
        p.id AS project_id,
        g_primary.id AS group_id_as_primary,
        g_member.id AS group_id_as_member,
        g_member.primary_project_id AS member_canonical
    FROM projects p
    LEFT JOIN project_groups g_primary
        ON g_primary.primary_project_id = p.id
    LEFT JOIN project_group_members m
        ON m.member_project_id = p.id
    LEFT JOIN project_groups g_member
        ON g_member.id = m.group_id
)
SELECT
    project_id,
    COALESCE(member_canonical, project_id) AS canonical_project_id,
    COALESCE(group_id_as_primary, group_id_as_member) AS group_id,
    CASE
        WHEN group_id_as_primary IS NOT NULL THEN 'primary'::TEXT
        WHEN group_id_as_member IS NOT NULL THEN 'member'::TEXT
        ELSE 'unassociated'::TEXT
    END AS role
FROM project_roles;

COMMENT ON VIEW v_project_canonical IS 'Maps each project to its canonical project ID. Used for reporting aggregation.';

-- ============================================================================
-- STEP 8: View - v_project_table_entities (Projects Table Filter)
-- ============================================================================

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
    ) AS member_count
FROM projects p
LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
WHERE vpc.role IS NULL OR vpc.role != 'member';

COMMENT ON VIEW v_project_table_entities IS 'Returns projects visible in the Projects table (primaries and unassociated, excludes members).';

-- ============================================================================
-- STEP 9: View - v_project_group_member_details
-- ============================================================================

CREATE OR REPLACE VIEW v_project_group_member_details AS
SELECT
    pg.id AS group_id,
    pg.primary_project_id,
    pgm.member_project_id,
    p.project_id AS member_external_project_id,
    p.project_name AS member_project_name,
    pgm.created_at AS member_added_at
FROM project_groups pg
JOIN project_group_members pgm ON pgm.group_id = pg.id
JOIN projects p ON p.id = pgm.member_project_id;

COMMENT ON VIEW v_project_group_member_details IS 'Returns member details for each project group. Used for Edit Project modal.';

-- ============================================================================
-- STEP 10: RPC - rpc_project_group_create_and_add_member
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_project_group_create_and_add_member(
    p_primary_project_id UUID,
    p_member_project_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_group_id UUID;
    v_primary_role TEXT;
    v_member_role TEXT;
    v_result JSON;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_primary_project_id = p_member_project_id THEN
        RAISE EXCEPTION 'Primary and member cannot be the same project'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_primary_project_id) THEN
        RAISE EXCEPTION 'Primary project not found: %', p_primary_project_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_member_project_id) THEN
        RAISE EXCEPTION 'Member project not found: %', p_member_project_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT role INTO v_primary_role
    FROM v_project_canonical
    WHERE project_id = p_primary_project_id;

    IF v_primary_role IS NOT NULL AND v_primary_role != 'unassociated' THEN
        RAISE EXCEPTION 'Primary project must be unassociated. Current role: %', v_primary_role
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT role INTO v_member_role
    FROM v_project_canonical
    WHERE project_id = p_member_project_id;

    IF v_member_role IS NOT NULL AND v_member_role != 'unassociated' THEN
        RAISE EXCEPTION 'Member project must be unassociated. Current role: %', v_member_role
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO project_groups (primary_project_id, created_by)
    VALUES (p_primary_project_id, auth.uid())
    RETURNING id INTO v_group_id;

    INSERT INTO project_group_members (group_id, member_project_id)
    VALUES (v_group_id, p_member_project_id);

    SELECT json_build_object(
        'success', true,
        'group_id', v_group_id,
        'primary_project_id', p_primary_project_id,
        'member_project_ids', (
            SELECT COALESCE(json_agg(m.member_project_id), '[]'::JSON)
            FROM project_group_members m
            WHERE m.group_id = v_group_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_project_group_create_and_add_member IS
    'Creates a new project group with a primary project and adds the first member. Admin only.';

-- ============================================================================
-- STEP 11: RPC - rpc_project_group_add_member
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_project_group_add_member(
    p_primary_project_id UUID,
    p_member_project_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_group_id UUID;
    v_member_role TEXT;
    v_result JSON;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_primary_project_id = p_member_project_id THEN
        RAISE EXCEPTION 'Primary and member cannot be the same project'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT id INTO v_group_id
    FROM project_groups
    WHERE primary_project_id = p_primary_project_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'No group exists for primary project: %. Use rpc_project_group_create_and_add_member instead.', p_primary_project_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_member_project_id) THEN
        RAISE EXCEPTION 'Member project not found: %', p_member_project_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT role INTO v_member_role
    FROM v_project_canonical
    WHERE project_id = p_member_project_id;

    IF v_member_role IS NOT NULL AND v_member_role != 'unassociated' THEN
        RAISE EXCEPTION 'Member project must be unassociated. Current role: %', v_member_role
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO project_group_members (group_id, member_project_id)
    VALUES (v_group_id, p_member_project_id);

    SELECT json_build_object(
        'success', true,
        'group_id', v_group_id,
        'primary_project_id', p_primary_project_id,
        'member_project_ids', (
            SELECT COALESCE(json_agg(m.member_project_id), '[]'::JSON)
            FROM project_group_members m
            WHERE m.group_id = v_group_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_project_group_add_member IS
    'Adds a member to an existing project group. Admin only.';

-- ============================================================================
-- STEP 12: RPC - rpc_project_group_remove_member
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_project_group_remove_member(
    p_primary_project_id UUID,
    p_member_project_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_group_id UUID;
    v_group_dissolved BOOLEAN := FALSE;
    v_result JSON;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT id INTO v_group_id
    FROM project_groups
    WHERE primary_project_id = p_primary_project_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'No group exists for primary project: %', p_primary_project_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM project_group_members
        WHERE group_id = v_group_id AND member_project_id = p_member_project_id
    ) THEN
        RAISE EXCEPTION 'Project % is not a member of the group for primary %',
            p_member_project_id, p_primary_project_id
            USING ERRCODE = 'no_data_found';
    END IF;

    DELETE FROM project_group_members
    WHERE group_id = v_group_id AND member_project_id = p_member_project_id;

    IF NOT EXISTS (SELECT 1 FROM project_groups WHERE id = v_group_id) THEN
        v_group_dissolved := TRUE;
    END IF;

    IF v_group_dissolved THEN
        v_result := json_build_object(
            'success', true,
            'group_dissolved', true,
            'group_id', NULL::UUID,
            'primary_project_id', p_primary_project_id,
            'removed_member_project_id', p_member_project_id,
            'member_project_ids', '[]'::JSON
        );
    ELSE
        SELECT json_build_object(
            'success', true,
            'group_dissolved', false,
            'group_id', v_group_id,
            'primary_project_id', p_primary_project_id,
            'removed_member_project_id', p_member_project_id,
            'member_project_ids', (
                SELECT COALESCE(json_agg(m.member_project_id), '[]'::JSON)
                FROM project_group_members m
                WHERE m.group_id = v_group_id
            )
        ) INTO v_result;
    END IF;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_project_group_remove_member IS
    'Removes a member from a project group. Dissolves group if last member. Admin only.';

-- ============================================================================
-- STEP 13: RPC - rpc_project_group_get
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_project_group_get(
    p_project_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
    v_role TEXT;
    v_result JSON;
BEGIN
    SELECT role, group_id INTO v_role, v_group_id
    FROM v_project_canonical
    WHERE project_id = p_project_id;

    IF v_role = 'member' THEN
        SELECT json_build_object(
            'success', true,
            'project_id', p_project_id,
            'role', 'member',
            'group_id', v_group_id,
            'primary_project_id', pg.primary_project_id,
            'message', 'This project is a member. Query via the primary project.'
        ) INTO v_result
        FROM project_groups pg
        WHERE pg.id = v_group_id;

        RETURN v_result;
    END IF;

    IF v_role = 'primary' THEN
        SELECT json_build_object(
            'success', true,
            'project_id', p_project_id,
            'role', 'primary',
            'group_id', v_group_id,
            'primary_project_id', p_project_id,
            'members', (
                SELECT COALESCE(
                    json_agg(
                        json_build_object(
                            'member_project_id', gmd.member_project_id,
                            'project_id', gmd.member_external_project_id,
                            'project_name', gmd.member_project_name,
                            'added_at', gmd.member_added_at
                        )
                        ORDER BY gmd.member_project_name
                    ),
                    '[]'::JSON
                )
                FROM v_project_group_member_details gmd
                WHERE gmd.group_id = v_group_id
            )
        ) INTO v_result;

        RETURN v_result;
    END IF;

    RETURN json_build_object(
        'success', true,
        'project_id', p_project_id,
        'role', 'unassociated',
        'group_id', NULL::UUID,
        'primary_project_id', NULL::UUID,
        'members', '[]'::JSON
    );
END;
$$;

COMMENT ON FUNCTION rpc_project_group_get IS
    'Returns group information for a project. Read-only, available to all authenticated users.';

-- ============================================================================
-- STEP 14: RPC - rpc_list_unassociated_projects
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_list_unassociated_projects(
    p_exclude_project_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    project_id TEXT,
    project_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.project_id,
        p.project_name
    FROM projects p
    JOIN v_project_canonical vpc ON vpc.project_id = p.id
    WHERE vpc.role = 'unassociated'
      AND (p_exclude_project_id IS NULL OR p.id != p_exclude_project_id)
    ORDER BY p.project_name;
END;
$$;

COMMENT ON FUNCTION rpc_list_unassociated_projects IS
    'Lists unassociated projects available for grouping. Used for dropdown population.';

-- ============================================================================
-- STEP 15: RLS Policies for project_groups
-- ============================================================================

ALTER TABLE project_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on project_groups" ON project_groups;
CREATE POLICY "Allow authenticated read on project_groups"
    ON project_groups
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow admin insert on project_groups" ON project_groups;
CREATE POLICY "Allow admin insert on project_groups"
    ON project_groups
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update on project_groups" ON project_groups;
CREATE POLICY "Allow admin update on project_groups"
    ON project_groups
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete on project_groups" ON project_groups;
CREATE POLICY "Allow admin delete on project_groups"
    ON project_groups
    FOR DELETE
    TO authenticated
    USING (is_admin());

DROP POLICY IF EXISTS "Allow service role full access on project_groups" ON project_groups;
CREATE POLICY "Allow service role full access on project_groups"
    ON project_groups
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 16: RLS Policies for project_group_members
-- ============================================================================

ALTER TABLE project_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on project_group_members" ON project_group_members;
CREATE POLICY "Allow authenticated read on project_group_members"
    ON project_group_members
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow admin insert on project_group_members" ON project_group_members;
CREATE POLICY "Allow admin insert on project_group_members"
    ON project_group_members
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update on project_group_members" ON project_group_members;
CREATE POLICY "Allow admin update on project_group_members"
    ON project_group_members
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete on project_group_members" ON project_group_members;
CREATE POLICY "Allow admin delete on project_group_members"
    ON project_group_members
    FOR DELETE
    TO authenticated
    USING (is_admin());

DROP POLICY IF EXISTS "Allow service role full access on project_group_members" ON project_group_members;
CREATE POLICY "Allow service role full access on project_group_members"
    ON project_group_members
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 17: Grant permissions
-- ============================================================================

GRANT SELECT ON project_groups TO authenticated;
GRANT SELECT ON project_group_members TO authenticated;
GRANT ALL ON project_groups TO service_role;
GRANT ALL ON project_group_members TO service_role;

GRANT SELECT ON v_project_canonical TO authenticated;
GRANT SELECT ON v_project_table_entities TO authenticated;
GRANT SELECT ON v_project_group_member_details TO authenticated;

GRANT EXECUTE ON FUNCTION rpc_project_group_create_and_add_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_project_group_add_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_project_group_remove_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_project_group_get(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_list_unassociated_projects(UUID) TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '030 Project Grouping migration complete:';
    RAISE NOTICE '  - project_groups table created';
    RAISE NOTICE '  - project_group_members table created';
    RAISE NOTICE '  - Constraint triggers for business rules';
    RAISE NOTICE '  - v_project_canonical view for canonical mapping';
    RAISE NOTICE '  - v_project_table_entities view for Projects table filtering';
    RAISE NOTICE '  - v_project_group_member_details view for modal display';
    RAISE NOTICE '  - RPC functions for group management';
    RAISE NOTICE '  - RLS policies applied';
END $$;

COMMIT;
