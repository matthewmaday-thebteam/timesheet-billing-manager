-- ============================================================================
-- 015: Physical Person Entity Grouping
--
-- Purpose: Allow admins to group multiple employee entities (from different
-- time tracking systems) that represent the same physical person.
--
-- Key concepts:
--   - Primary entity: The anchor entity for a group (shown in Employee table)
--   - Member entity: An entity associated to a group (hidden from Employee table)
--   - Unassociated entity: An entity not in any group (shown in Employee table)
--   - Canonical entity: The Primary entity ID for grouped entities, or own ID if unassociated
--
-- Business rules enforced:
--   BR-1: An entity can belong to 0 or 1 group
--   BR-2: A group is created only when an admin adds the first member
--   BR-3: Only unassociated entities can be added as members
--   BR-4: The Primary entity never appears in the "User Associations" list
--   BR-5: The Primary entity cannot be removed from its group
--   BR-6: A group is dissolved if it has zero members
--   BR-7: Member entities are hidden from Employee table
--   BR-8: Reports aggregate by canonical entity (Primary)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create physical_person_groups table
-- ============================================================================
-- Represents a group of employee entities that belong to the same physical person.
-- Each group has exactly one primary entity that anchors the group.

CREATE TABLE IF NOT EXISTS physical_person_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The primary entity for this group (anchor)
    -- This is the resource that "owns" the group
    primary_resource_id UUID NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Enforce: each resource can be primary of at most one group
    CONSTRAINT uq_physical_person_groups_primary_resource
        UNIQUE(primary_resource_id),

    -- FK to resources with RESTRICT - cannot delete resource if it's a group primary
    CONSTRAINT fk_physical_person_groups_primary_resource
        FOREIGN KEY (primary_resource_id)
        REFERENCES resources(id)
        ON DELETE RESTRICT
);

-- Index for FK lookups
CREATE INDEX IF NOT EXISTS idx_ppg_primary_resource_id
    ON physical_person_groups(primary_resource_id);

COMMENT ON TABLE physical_person_groups IS 'Groups physical persons. A group is anchored by a primary entity (resource).';
COMMENT ON COLUMN physical_person_groups.primary_resource_id IS 'The primary/anchor entity for this group. Maps to resources.id.';

-- ============================================================================
-- STEP 2: Create physical_person_group_members table
-- ============================================================================
-- Maps member entities to groups.
-- A member is an employee entity associated with a primary entity's group.

CREATE TABLE IF NOT EXISTS physical_person_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The group this member belongs to
    group_id UUID NOT NULL,

    -- The member resource (employee entity)
    member_resource_id UUID NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- BR-1: Entity can belong to at most one group
    CONSTRAINT uq_ppgm_member_resource
        UNIQUE(member_resource_id),

    -- FK to group - CASCADE delete: if group is dissolved, members are released
    CONSTRAINT fk_ppgm_group
        FOREIGN KEY (group_id)
        REFERENCES physical_person_groups(id)
        ON DELETE CASCADE,

    -- FK to resources - CASCADE delete: if member resource is deleted, remove from group
    CONSTRAINT fk_ppgm_member_resource
        FOREIGN KEY (member_resource_id)
        REFERENCES resources(id)
        ON DELETE CASCADE
);

-- Indexes for FK lookups and common queries
CREATE INDEX IF NOT EXISTS idx_ppgm_group_id ON physical_person_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_ppgm_member_resource_id ON physical_person_group_members(member_resource_id);

COMMENT ON TABLE physical_person_group_members IS 'Members of a physical person group. Members are hidden from the employee table.';
COMMENT ON COLUMN physical_person_group_members.member_resource_id IS 'The member entity. Maps to resources.id. Cannot be the group primary.';

-- ============================================================================
-- STEP 3: Updated_at trigger for physical_person_groups
-- ============================================================================

DROP TRIGGER IF EXISTS trg_physical_person_groups_updated_at ON physical_person_groups;
CREATE TRIGGER trg_physical_person_groups_updated_at
    BEFORE UPDATE ON physical_person_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: Trigger - Prevent member from being a primary (BR-3, BR-4)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_prevent_member_as_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check 1: New member cannot already be a primary entity
    IF EXISTS (
        SELECT 1 FROM physical_person_groups
        WHERE primary_resource_id = NEW.member_resource_id
    ) THEN
        RAISE EXCEPTION 'Entity % is already a primary entity and cannot be added as a member',
            NEW.member_resource_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Check 2: New member cannot be the primary of the group being joined
    IF EXISTS (
        SELECT 1 FROM physical_person_groups
        WHERE id = NEW.group_id AND primary_resource_id = NEW.member_resource_id
    ) THEN
        RAISE EXCEPTION 'Cannot add primary entity as a member of its own group'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppgm_prevent_member_as_primary ON physical_person_group_members;
CREATE TRIGGER trg_ppgm_prevent_member_as_primary
    BEFORE INSERT ON physical_person_group_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_prevent_member_as_primary();

-- ============================================================================
-- STEP 5: Trigger - Prevent primary from being a member
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_prevent_primary_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check: New primary cannot already be a member entity
    IF EXISTS (
        SELECT 1 FROM physical_person_group_members
        WHERE member_resource_id = NEW.primary_resource_id
    ) THEN
        RAISE EXCEPTION 'Entity % is already a member of another group and cannot be a primary',
            NEW.primary_resource_id
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppg_prevent_primary_as_member ON physical_person_groups;
CREATE TRIGGER trg_ppg_prevent_primary_as_member
    BEFORE INSERT ON physical_person_groups
    FOR EACH ROW
    EXECUTE FUNCTION trg_prevent_primary_as_member();

-- ============================================================================
-- STEP 6: Trigger - Auto-dissolve empty groups (BR-6)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_auto_dissolve_empty_group()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- After a member is deleted, check if group is now empty
    IF NOT EXISTS (
        SELECT 1 FROM physical_person_group_members
        WHERE group_id = OLD.group_id
    ) THEN
        -- Dissolve the group
        DELETE FROM physical_person_groups WHERE id = OLD.group_id;
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppgm_auto_dissolve ON physical_person_group_members;
CREATE TRIGGER trg_ppgm_auto_dissolve
    AFTER DELETE ON physical_person_group_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_auto_dissolve_empty_group();

-- ============================================================================
-- STEP 7: View - v_entity_canonical (Canonical Entity Mapping)
-- ============================================================================
-- Maps every entity to its canonical entity ID.
-- Used for reporting aggregation.

CREATE OR REPLACE VIEW v_entity_canonical AS
WITH entity_roles AS (
    SELECT
        r.id AS entity_id,
        g_primary.id AS group_id_as_primary,
        g_member.id AS group_id_as_member,
        g_member.primary_resource_id AS member_canonical
    FROM resources r
    LEFT JOIN physical_person_groups g_primary
        ON g_primary.primary_resource_id = r.id
    LEFT JOIN physical_person_group_members m
        ON m.member_resource_id = r.id
    LEFT JOIN physical_person_groups g_member
        ON g_member.id = m.group_id
)
SELECT
    entity_id,
    -- Canonical: if member -> primary's entity_id, else -> own entity_id
    COALESCE(member_canonical, entity_id) AS canonical_entity_id,
    -- Group ID (if any)
    COALESCE(group_id_as_primary, group_id_as_member) AS group_id,
    -- Role
    CASE
        WHEN group_id_as_primary IS NOT NULL THEN 'primary'::TEXT
        WHEN group_id_as_member IS NOT NULL THEN 'member'::TEXT
        ELSE 'unassociated'::TEXT
    END AS role
FROM entity_roles;

COMMENT ON VIEW v_entity_canonical IS 'Maps each entity (resource) to its canonical entity ID. Used for reporting aggregation.';

-- ============================================================================
-- STEP 8: View - v_employee_table_entities (Employee Table Filter)
-- ============================================================================
-- Returns resources that should appear in the Employee table:
-- - Unassociated entities (not a primary, not a member)
-- - Primary entities (anchor of a group)
-- - Excludes all member entities

CREATE OR REPLACE VIEW v_employee_table_entities AS
SELECT
    r.*,
    -- Include employment type for convenience
    et.name AS employment_type_name,
    -- Include canonical info for display
    vec.role AS grouping_role,
    vec.group_id,
    -- Include count of members (if primary)
    COALESCE(
        (
            SELECT COUNT(*)::INTEGER
            FROM physical_person_group_members m
            WHERE m.group_id = vec.group_id
        ),
        0
    ) AS member_count
FROM resources r
LEFT JOIN employment_types et ON et.id = r.employment_type_id
LEFT JOIN v_entity_canonical vec ON vec.entity_id = r.id
WHERE vec.role IS NULL OR vec.role != 'member';

COMMENT ON VIEW v_employee_table_entities IS 'Returns resources visible in the Employee table (primaries and unassociated, excludes members).';

-- ============================================================================
-- STEP 9: View - v_group_member_details (Group Members with Details)
-- ============================================================================
-- Returns member details for a group, used for modal display.

CREATE OR REPLACE VIEW v_group_member_details AS
SELECT
    ppg.id AS group_id,
    ppg.primary_resource_id,
    ppgm.member_resource_id,
    r.external_label AS member_external_label,
    r.first_name AS member_first_name,
    r.last_name AS member_last_name,
    r.user_id AS member_user_id,
    ppgm.created_at AS member_added_at
FROM physical_person_groups ppg
JOIN physical_person_group_members ppgm ON ppgm.group_id = ppg.id
JOIN resources r ON r.id = ppgm.member_resource_id;

COMMENT ON VIEW v_group_member_details IS 'Returns member details for each group. Used for Edit Employee modal.';

-- ============================================================================
-- STEP 10: RPC - rpc_group_create_and_add_member
-- ============================================================================
-- Creates a new group with the primary entity and adds the first member.

CREATE OR REPLACE FUNCTION rpc_group_create_and_add_member(
    p_primary_resource_id UUID,
    p_member_resource_id UUID
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
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Validate: primary and member cannot be the same
    IF p_primary_resource_id = p_member_resource_id THEN
        RAISE EXCEPTION 'Primary and member cannot be the same entity'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Validate: primary entity must exist
    IF NOT EXISTS (SELECT 1 FROM resources WHERE id = p_primary_resource_id) THEN
        RAISE EXCEPTION 'Primary entity not found: %', p_primary_resource_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- Validate: member entity must exist
    IF NOT EXISTS (SELECT 1 FROM resources WHERE id = p_member_resource_id) THEN
        RAISE EXCEPTION 'Member entity not found: %', p_member_resource_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- Check: primary must be unassociated (BR-2, BR-3)
    SELECT role INTO v_primary_role
    FROM v_entity_canonical
    WHERE entity_id = p_primary_resource_id;

    IF v_primary_role IS NOT NULL AND v_primary_role != 'unassociated' THEN
        RAISE EXCEPTION 'Primary entity must be unassociated. Current role: %', v_primary_role
            USING ERRCODE = 'check_violation';
    END IF;

    -- Check: member must be unassociated (BR-3)
    SELECT role INTO v_member_role
    FROM v_entity_canonical
    WHERE entity_id = p_member_resource_id;

    IF v_member_role IS NOT NULL AND v_member_role != 'unassociated' THEN
        RAISE EXCEPTION 'Member entity must be unassociated. Current role: %', v_member_role
            USING ERRCODE = 'check_violation';
    END IF;

    -- Create the group
    INSERT INTO physical_person_groups (primary_resource_id, created_by)
    VALUES (p_primary_resource_id, auth.uid())
    RETURNING id INTO v_group_id;

    -- Add the member
    INSERT INTO physical_person_group_members (group_id, member_resource_id)
    VALUES (v_group_id, p_member_resource_id);

    -- Build result with current state
    SELECT json_build_object(
        'success', true,
        'group_id', v_group_id,
        'primary_resource_id', p_primary_resource_id,
        'member_resource_ids', (
            SELECT COALESCE(json_agg(m.member_resource_id), '[]'::JSON)
            FROM physical_person_group_members m
            WHERE m.group_id = v_group_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_group_create_and_add_member IS
    'Creates a new physical person group with a primary entity and adds the first member. Admin only.';

-- ============================================================================
-- STEP 11: RPC - rpc_group_add_member
-- ============================================================================
-- Adds a member to an existing group.

CREATE OR REPLACE FUNCTION rpc_group_add_member(
    p_primary_resource_id UUID,
    p_member_resource_id UUID
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
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Validate: primary and member cannot be the same
    IF p_primary_resource_id = p_member_resource_id THEN
        RAISE EXCEPTION 'Primary and member cannot be the same entity'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Find the group for this primary entity
    SELECT id INTO v_group_id
    FROM physical_person_groups
    WHERE primary_resource_id = p_primary_resource_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'No group exists for primary entity: %. Use rpc_group_create_and_add_member instead.', p_primary_resource_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Validate: member entity must exist
    IF NOT EXISTS (SELECT 1 FROM resources WHERE id = p_member_resource_id) THEN
        RAISE EXCEPTION 'Member entity not found: %', p_member_resource_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- Check: member must be unassociated (BR-3)
    SELECT role INTO v_member_role
    FROM v_entity_canonical
    WHERE entity_id = p_member_resource_id;

    IF v_member_role IS NOT NULL AND v_member_role != 'unassociated' THEN
        RAISE EXCEPTION 'Member entity must be unassociated. Current role: %', v_member_role
            USING ERRCODE = 'check_violation';
    END IF;

    -- Add the member
    INSERT INTO physical_person_group_members (group_id, member_resource_id)
    VALUES (v_group_id, p_member_resource_id);

    -- Build result with current state
    SELECT json_build_object(
        'success', true,
        'group_id', v_group_id,
        'primary_resource_id', p_primary_resource_id,
        'member_resource_ids', (
            SELECT COALESCE(json_agg(m.member_resource_id), '[]'::JSON)
            FROM physical_person_group_members m
            WHERE m.group_id = v_group_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_group_add_member IS
    'Adds a member to an existing physical person group. Admin only.';

-- ============================================================================
-- STEP 12: RPC - rpc_group_remove_member
-- ============================================================================
-- Removes a member from a group. Dissolves group if last member removed (BR-6).

CREATE OR REPLACE FUNCTION rpc_group_remove_member(
    p_primary_resource_id UUID,
    p_member_resource_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_group_id UUID;
    v_member_count INTEGER;
    v_group_dissolved BOOLEAN := FALSE;
    v_result JSON;
BEGIN
    -- Security check: caller must be admin
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Find the group for this primary entity
    SELECT id INTO v_group_id
    FROM physical_person_groups
    WHERE primary_resource_id = p_primary_resource_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'No group exists for primary entity: %', p_primary_resource_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Verify the member belongs to this group
    IF NOT EXISTS (
        SELECT 1 FROM physical_person_group_members
        WHERE group_id = v_group_id AND member_resource_id = p_member_resource_id
    ) THEN
        RAISE EXCEPTION 'Entity % is not a member of the group for primary %',
            p_member_resource_id, p_primary_resource_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Remove the member (triggers trg_auto_dissolve_empty_group if last)
    DELETE FROM physical_person_group_members
    WHERE group_id = v_group_id AND member_resource_id = p_member_resource_id;

    -- Check if group was dissolved
    IF NOT EXISTS (SELECT 1 FROM physical_person_groups WHERE id = v_group_id) THEN
        v_group_dissolved := TRUE;
    END IF;

    -- Build result
    IF v_group_dissolved THEN
        v_result := json_build_object(
            'success', true,
            'group_dissolved', true,
            'group_id', NULL::UUID,
            'primary_resource_id', p_primary_resource_id,
            'removed_member_resource_id', p_member_resource_id,
            'member_resource_ids', '[]'::JSON
        );
    ELSE
        SELECT json_build_object(
            'success', true,
            'group_dissolved', false,
            'group_id', v_group_id,
            'primary_resource_id', p_primary_resource_id,
            'removed_member_resource_id', p_member_resource_id,
            'member_resource_ids', (
                SELECT COALESCE(json_agg(m.member_resource_id), '[]'::JSON)
                FROM physical_person_group_members m
                WHERE m.group_id = v_group_id
            )
        ) INTO v_result;
    END IF;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_group_remove_member IS
    'Removes a member from a physical person group. Dissolves group if last member. Admin only.';

-- ============================================================================
-- STEP 13: RPC - rpc_group_get
-- ============================================================================
-- Returns group information for a primary entity.

CREATE OR REPLACE FUNCTION rpc_group_get(
    p_resource_id UUID
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
    -- Get the entity's role
    SELECT role, group_id INTO v_role, v_group_id
    FROM v_entity_canonical
    WHERE entity_id = p_resource_id;

    -- If entity is a member, return info pointing to primary
    IF v_role = 'member' THEN
        SELECT json_build_object(
            'success', true,
            'entity_id', p_resource_id,
            'role', 'member',
            'group_id', v_group_id,
            'primary_resource_id', ppg.primary_resource_id,
            'message', 'This entity is a member. Query via the primary entity.'
        ) INTO v_result
        FROM physical_person_groups ppg
        WHERE ppg.id = v_group_id;

        RETURN v_result;
    END IF;

    -- If entity is a primary, return full group info
    IF v_role = 'primary' THEN
        SELECT json_build_object(
            'success', true,
            'entity_id', p_resource_id,
            'role', 'primary',
            'group_id', v_group_id,
            'primary_resource_id', p_resource_id,
            'members', (
                SELECT COALESCE(
                    json_agg(
                        json_build_object(
                            'member_resource_id', gmd.member_resource_id,
                            'external_label', gmd.member_external_label,
                            'first_name', gmd.member_first_name,
                            'last_name', gmd.member_last_name,
                            'user_id', gmd.member_user_id,
                            'added_at', gmd.member_added_at
                        )
                        ORDER BY gmd.member_external_label
                    ),
                    '[]'::JSON
                )
                FROM v_group_member_details gmd
                WHERE gmd.group_id = v_group_id
            )
        ) INTO v_result;

        RETURN v_result;
    END IF;

    -- Entity is unassociated
    RETURN json_build_object(
        'success', true,
        'entity_id', p_resource_id,
        'role', 'unassociated',
        'group_id', NULL::UUID,
        'primary_resource_id', NULL::UUID,
        'members', '[]'::JSON
    );
END;
$$;

COMMENT ON FUNCTION rpc_group_get IS
    'Returns group information for an entity. Read-only, available to all authenticated users.';

-- ============================================================================
-- STEP 14: RPC - rpc_list_unassociated_entities
-- ============================================================================
-- Returns entities available for grouping (unassociated only).

CREATE OR REPLACE FUNCTION rpc_list_unassociated_entities(
    p_exclude_resource_id UUID DEFAULT NULL
)
RETURNS TABLE (
    resource_id UUID,
    external_label TEXT,
    first_name TEXT,
    last_name TEXT,
    user_id TEXT,
    display_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id AS resource_id,
        r.external_label,
        r.first_name,
        r.last_name,
        r.user_id,
        COALESCE(
            NULLIF(TRIM(CONCAT(r.first_name, ' ', r.last_name)), ''),
            r.external_label
        ) AS display_name
    FROM resources r
    JOIN v_entity_canonical vec ON vec.entity_id = r.id
    WHERE vec.role = 'unassociated'
      AND (p_exclude_resource_id IS NULL OR r.id != p_exclude_resource_id)
    ORDER BY display_name;
END;
$$;

COMMENT ON FUNCTION rpc_list_unassociated_entities IS
    'Lists unassociated entities available for grouping. Used for dropdown population.';

-- ============================================================================
-- STEP 15: RLS Policies for physical_person_groups
-- ============================================================================

ALTER TABLE physical_person_groups ENABLE ROW LEVEL SECURITY;

-- Read: All authenticated users can read groups
DROP POLICY IF EXISTS "Allow authenticated read on physical_person_groups" ON physical_person_groups;
CREATE POLICY "Allow authenticated read on physical_person_groups"
    ON physical_person_groups
    FOR SELECT
    TO authenticated
    USING (true);

-- Insert: Admins only
DROP POLICY IF EXISTS "Allow admin insert on physical_person_groups" ON physical_person_groups;
CREATE POLICY "Allow admin insert on physical_person_groups"
    ON physical_person_groups
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

-- Update: Admins only
DROP POLICY IF EXISTS "Allow admin update on physical_person_groups" ON physical_person_groups;
CREATE POLICY "Allow admin update on physical_person_groups"
    ON physical_person_groups
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- Delete: Admins only
DROP POLICY IF EXISTS "Allow admin delete on physical_person_groups" ON physical_person_groups;
CREATE POLICY "Allow admin delete on physical_person_groups"
    ON physical_person_groups
    FOR DELETE
    TO authenticated
    USING (is_admin());

-- Service role: Full access
DROP POLICY IF EXISTS "Allow service role full access on physical_person_groups" ON physical_person_groups;
CREATE POLICY "Allow service role full access on physical_person_groups"
    ON physical_person_groups
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 16: RLS Policies for physical_person_group_members
-- ============================================================================

ALTER TABLE physical_person_group_members ENABLE ROW LEVEL SECURITY;

-- Read: All authenticated users can read members
DROP POLICY IF EXISTS "Allow authenticated read on physical_person_group_members" ON physical_person_group_members;
CREATE POLICY "Allow authenticated read on physical_person_group_members"
    ON physical_person_group_members
    FOR SELECT
    TO authenticated
    USING (true);

-- Insert: Admins only
DROP POLICY IF EXISTS "Allow admin insert on physical_person_group_members" ON physical_person_group_members;
CREATE POLICY "Allow admin insert on physical_person_group_members"
    ON physical_person_group_members
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

-- Update: Admins only
DROP POLICY IF EXISTS "Allow admin update on physical_person_group_members" ON physical_person_group_members;
CREATE POLICY "Allow admin update on physical_person_group_members"
    ON physical_person_group_members
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- Delete: Admins only
DROP POLICY IF EXISTS "Allow admin delete on physical_person_group_members" ON physical_person_group_members;
CREATE POLICY "Allow admin delete on physical_person_group_members"
    ON physical_person_group_members
    FOR DELETE
    TO authenticated
    USING (is_admin());

-- Service role: Full access
DROP POLICY IF EXISTS "Allow service role full access on physical_person_group_members" ON physical_person_group_members;
CREATE POLICY "Allow service role full access on physical_person_group_members"
    ON physical_person_group_members
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 17: Grant permissions
-- ============================================================================

-- Tables
GRANT SELECT ON physical_person_groups TO authenticated;
GRANT SELECT ON physical_person_group_members TO authenticated;
GRANT ALL ON physical_person_groups TO service_role;
GRANT ALL ON physical_person_group_members TO service_role;

-- Views
GRANT SELECT ON v_entity_canonical TO authenticated;
GRANT SELECT ON v_employee_table_entities TO authenticated;
GRANT SELECT ON v_group_member_details TO authenticated;

-- RPC Functions
GRANT EXECUTE ON FUNCTION rpc_group_create_and_add_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_group_add_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_group_remove_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_group_get(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_list_unassociated_entities(UUID) TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '015 Physical Person Grouping migration complete:';
    RAISE NOTICE '  - physical_person_groups table created';
    RAISE NOTICE '  - physical_person_group_members table created';
    RAISE NOTICE '  - Constraint triggers for business rules';
    RAISE NOTICE '  - v_entity_canonical view for canonical mapping';
    RAISE NOTICE '  - v_employee_table_entities view for Employee table filtering';
    RAISE NOTICE '  - v_group_member_details view for modal display';
    RAISE NOTICE '  - RPC functions for group management';
    RAISE NOTICE '  - RLS policies applied';
    RAISE NOTICE '';
    RAISE NOTICE 'NOTE: The resource_user_associations table is NOT modified.';
    RAISE NOTICE 'It continues to map time tracking system IDs to resources.';
    RAISE NOTICE 'Physical person grouping is a separate concept managed by these new tables.';
END $$;

COMMIT;
