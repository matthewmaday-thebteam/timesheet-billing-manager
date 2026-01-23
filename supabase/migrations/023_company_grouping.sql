-- ============================================================================
-- Migration 023: Company Grouping
-- ============================================================================
-- Purpose: Allow admins to group multiple company entities (from different
-- time tracking systems) that represent the same real-world company.
--
-- Key concepts:
--   - Primary company: The anchor company for a group (shown in Companies table)
--   - Member company: A company associated to a group (hidden from Companies table)
--   - Unassociated company: A company not in any group (shown in Companies table)
--   - Canonical company: The Primary company ID for grouped companies, or own ID if unassociated
--
-- Business rules (mirroring employee grouping):
--   BR-1: A company can belong to 0 or 1 group
--   BR-2: A group is created only when an admin adds the first member
--   BR-3: Only unassociated companies can be added as members
--   BR-4: The Primary company never appears in the "Company Associations" list
--   BR-5: The Primary company cannot be removed from its group
--   BR-6: A group is dissolved if it has zero members
--   BR-7: Member companies are hidden from Companies table
--   BR-8: Reports aggregate by canonical company (Primary)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create company_groups table
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The primary company for this group (anchor)
    primary_company_id UUID NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Enforce: each company can be primary of at most one group
    CONSTRAINT uq_company_groups_primary_company
        UNIQUE(primary_company_id),

    -- FK to companies with RESTRICT - cannot delete company if it's a group primary
    CONSTRAINT fk_company_groups_primary_company
        FOREIGN KEY (primary_company_id)
        REFERENCES companies(id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cg_primary_company_id
    ON company_groups(primary_company_id);

COMMENT ON TABLE company_groups IS 'Groups companies. A group is anchored by a primary company.';
COMMENT ON COLUMN company_groups.primary_company_id IS 'The primary/anchor company for this group.';

-- ============================================================================
-- STEP 2: Create company_group_members table
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The group this member belongs to
    group_id UUID NOT NULL,

    -- The member company
    member_company_id UUID NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- BR-1: Company can belong to at most one group
    CONSTRAINT uq_cgm_member_company
        UNIQUE(member_company_id),

    -- FK to group - CASCADE delete: if group is dissolved, members are released
    CONSTRAINT fk_cgm_group
        FOREIGN KEY (group_id)
        REFERENCES company_groups(id)
        ON DELETE CASCADE,

    -- FK to companies - CASCADE delete: if member company is deleted, remove from group
    CONSTRAINT fk_cgm_member_company
        FOREIGN KEY (member_company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cgm_group_id ON company_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_cgm_member_company_id ON company_group_members(member_company_id);

COMMENT ON TABLE company_group_members IS 'Members of a company group. Members are hidden from the companies table.';

-- ============================================================================
-- STEP 3: Updated_at trigger for company_groups
-- ============================================================================

DROP TRIGGER IF EXISTS trg_company_groups_updated_at ON company_groups;
CREATE TRIGGER trg_company_groups_updated_at
    BEFORE UPDATE ON company_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: Trigger - Prevent member from being a primary (BR-3, BR-4)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_prevent_company_member_as_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check 1: New member cannot already be a primary
    IF EXISTS (
        SELECT 1 FROM company_groups
        WHERE primary_company_id = NEW.member_company_id
    ) THEN
        RAISE EXCEPTION 'Company % is already a primary and cannot be added as a member',
            NEW.member_company_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Check 2: New member cannot be the primary of the group being joined
    IF EXISTS (
        SELECT 1 FROM company_groups
        WHERE id = NEW.group_id AND primary_company_id = NEW.member_company_id
    ) THEN
        RAISE EXCEPTION 'Cannot add primary company as a member of its own group'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cgm_prevent_member_as_primary ON company_group_members;
CREATE TRIGGER trg_cgm_prevent_member_as_primary
    BEFORE INSERT ON company_group_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_prevent_company_member_as_primary();

-- ============================================================================
-- STEP 5: Trigger - Prevent primary from being a member
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_prevent_company_primary_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM company_group_members
        WHERE member_company_id = NEW.primary_company_id
    ) THEN
        RAISE EXCEPTION 'Company % is already a member and cannot be a primary',
            NEW.primary_company_id
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cg_prevent_primary_as_member ON company_groups;
CREATE TRIGGER trg_cg_prevent_primary_as_member
    BEFORE INSERT ON company_groups
    FOR EACH ROW
    EXECUTE FUNCTION trg_prevent_company_primary_as_member();

-- ============================================================================
-- STEP 6: Trigger - Auto-dissolve empty groups (BR-6)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_auto_dissolve_empty_company_group()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM company_group_members
        WHERE group_id = OLD.group_id
    ) THEN
        DELETE FROM company_groups WHERE id = OLD.group_id;
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cgm_auto_dissolve ON company_group_members;
CREATE TRIGGER trg_cgm_auto_dissolve
    AFTER DELETE ON company_group_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_auto_dissolve_empty_company_group();

-- ============================================================================
-- STEP 7: View - v_company_canonical (Canonical Company Mapping)
-- ============================================================================

CREATE OR REPLACE VIEW v_company_canonical AS
WITH company_roles AS (
    SELECT
        c.id AS company_id,
        g_primary.id AS group_id_as_primary,
        g_member.id AS group_id_as_member,
        g_member.primary_company_id AS member_canonical
    FROM companies c
    LEFT JOIN company_groups g_primary
        ON g_primary.primary_company_id = c.id
    LEFT JOIN company_group_members m
        ON m.member_company_id = c.id
    LEFT JOIN company_groups g_member
        ON g_member.id = m.group_id
)
SELECT
    company_id,
    COALESCE(member_canonical, company_id) AS canonical_company_id,
    COALESCE(group_id_as_primary, group_id_as_member) AS group_id,
    CASE
        WHEN group_id_as_primary IS NOT NULL THEN 'primary'::TEXT
        WHEN group_id_as_member IS NOT NULL THEN 'member'::TEXT
        ELSE 'unassociated'::TEXT
    END AS role
FROM company_roles;

COMMENT ON VIEW v_company_canonical IS 'Maps each company to its canonical company ID. Used for reporting aggregation.';

-- ============================================================================
-- STEP 8: View - v_company_table_entities (Companies Table Filter)
-- ============================================================================

CREATE OR REPLACE VIEW v_company_table_entities AS
SELECT
    c.*,
    vcc.role AS grouping_role,
    vcc.group_id,
    COALESCE(
        (
            SELECT COUNT(*)::INTEGER
            FROM company_group_members m
            WHERE m.group_id = vcc.group_id
        ),
        0
    ) AS member_count,
    -- Aggregated project count for this company
    (
        SELECT COUNT(*)::INTEGER
        FROM projects p
        WHERE p.company_id = c.id
    ) AS project_count
FROM companies c
LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
WHERE vcc.role IS NULL OR vcc.role != 'member';

COMMENT ON VIEW v_company_table_entities IS 'Returns companies visible in the Companies table (primaries and unassociated, excludes members).';

-- ============================================================================
-- STEP 9: View - v_company_group_member_details
-- ============================================================================

CREATE OR REPLACE VIEW v_company_group_member_details AS
SELECT
    cg.id AS group_id,
    cg.primary_company_id,
    cgm.member_company_id,
    c.client_id AS member_client_id,
    c.client_name AS member_client_name,
    c.display_name AS member_display_name,
    cgm.created_at AS member_added_at
FROM company_groups cg
JOIN company_group_members cgm ON cgm.group_id = cg.id
JOIN companies c ON c.id = cgm.member_company_id;

COMMENT ON VIEW v_company_group_member_details IS 'Returns member details for each company group. Used for Edit Company modal.';

-- ============================================================================
-- STEP 10: RPC - rpc_company_group_create_and_add_member
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_company_group_create_and_add_member(
    p_primary_company_id UUID,
    p_member_company_id UUID
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

    IF p_primary_company_id = p_member_company_id THEN
        RAISE EXCEPTION 'Primary and member cannot be the same company'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_primary_company_id) THEN
        RAISE EXCEPTION 'Primary company not found: %', p_primary_company_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_member_company_id) THEN
        RAISE EXCEPTION 'Member company not found: %', p_member_company_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT role INTO v_primary_role
    FROM v_company_canonical
    WHERE company_id = p_primary_company_id;

    IF v_primary_role IS NOT NULL AND v_primary_role != 'unassociated' THEN
        RAISE EXCEPTION 'Primary company must be unassociated. Current role: %', v_primary_role
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT role INTO v_member_role
    FROM v_company_canonical
    WHERE company_id = p_member_company_id;

    IF v_member_role IS NOT NULL AND v_member_role != 'unassociated' THEN
        RAISE EXCEPTION 'Member company must be unassociated. Current role: %', v_member_role
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO company_groups (primary_company_id, created_by)
    VALUES (p_primary_company_id, auth.uid())
    RETURNING id INTO v_group_id;

    INSERT INTO company_group_members (group_id, member_company_id)
    VALUES (v_group_id, p_member_company_id);

    SELECT json_build_object(
        'success', true,
        'group_id', v_group_id,
        'primary_company_id', p_primary_company_id,
        'member_company_ids', (
            SELECT COALESCE(json_agg(m.member_company_id), '[]'::JSON)
            FROM company_group_members m
            WHERE m.group_id = v_group_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_company_group_create_and_add_member IS
    'Creates a new company group with a primary company and adds the first member. Admin only.';

-- ============================================================================
-- STEP 11: RPC - rpc_company_group_add_member
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_company_group_add_member(
    p_primary_company_id UUID,
    p_member_company_id UUID
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

    IF p_primary_company_id = p_member_company_id THEN
        RAISE EXCEPTION 'Primary and member cannot be the same company'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT id INTO v_group_id
    FROM company_groups
    WHERE primary_company_id = p_primary_company_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'No group exists for primary company: %. Use rpc_company_group_create_and_add_member instead.', p_primary_company_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_member_company_id) THEN
        RAISE EXCEPTION 'Member company not found: %', p_member_company_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT role INTO v_member_role
    FROM v_company_canonical
    WHERE company_id = p_member_company_id;

    IF v_member_role IS NOT NULL AND v_member_role != 'unassociated' THEN
        RAISE EXCEPTION 'Member company must be unassociated. Current role: %', v_member_role
            USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO company_group_members (group_id, member_company_id)
    VALUES (v_group_id, p_member_company_id);

    SELECT json_build_object(
        'success', true,
        'group_id', v_group_id,
        'primary_company_id', p_primary_company_id,
        'member_company_ids', (
            SELECT COALESCE(json_agg(m.member_company_id), '[]'::JSON)
            FROM company_group_members m
            WHERE m.group_id = v_group_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_company_group_add_member IS
    'Adds a member to an existing company group. Admin only.';

-- ============================================================================
-- STEP 12: RPC - rpc_company_group_remove_member
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_company_group_remove_member(
    p_primary_company_id UUID,
    p_member_company_id UUID
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
    FROM company_groups
    WHERE primary_company_id = p_primary_company_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'No group exists for primary company: %', p_primary_company_id
            USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM company_group_members
        WHERE group_id = v_group_id AND member_company_id = p_member_company_id
    ) THEN
        RAISE EXCEPTION 'Company % is not a member of the group for primary %',
            p_member_company_id, p_primary_company_id
            USING ERRCODE = 'no_data_found';
    END IF;

    DELETE FROM company_group_members
    WHERE group_id = v_group_id AND member_company_id = p_member_company_id;

    IF NOT EXISTS (SELECT 1 FROM company_groups WHERE id = v_group_id) THEN
        v_group_dissolved := TRUE;
    END IF;

    IF v_group_dissolved THEN
        v_result := json_build_object(
            'success', true,
            'group_dissolved', true,
            'group_id', NULL::UUID,
            'primary_company_id', p_primary_company_id,
            'removed_member_company_id', p_member_company_id,
            'member_company_ids', '[]'::JSON
        );
    ELSE
        SELECT json_build_object(
            'success', true,
            'group_dissolved', false,
            'group_id', v_group_id,
            'primary_company_id', p_primary_company_id,
            'removed_member_company_id', p_member_company_id,
            'member_company_ids', (
                SELECT COALESCE(json_agg(m.member_company_id), '[]'::JSON)
                FROM company_group_members m
                WHERE m.group_id = v_group_id
            )
        ) INTO v_result;
    END IF;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION rpc_company_group_remove_member IS
    'Removes a member from a company group. Dissolves group if last member. Admin only.';

-- ============================================================================
-- STEP 13: RPC - rpc_company_group_get
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_company_group_get(
    p_company_id UUID
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
    FROM v_company_canonical
    WHERE company_id = p_company_id;

    IF v_role = 'member' THEN
        SELECT json_build_object(
            'success', true,
            'company_id', p_company_id,
            'role', 'member',
            'group_id', v_group_id,
            'primary_company_id', cg.primary_company_id,
            'message', 'This company is a member. Query via the primary company.'
        ) INTO v_result
        FROM company_groups cg
        WHERE cg.id = v_group_id;

        RETURN v_result;
    END IF;

    IF v_role = 'primary' THEN
        SELECT json_build_object(
            'success', true,
            'company_id', p_company_id,
            'role', 'primary',
            'group_id', v_group_id,
            'primary_company_id', p_company_id,
            'members', (
                SELECT COALESCE(
                    json_agg(
                        json_build_object(
                            'member_company_id', gmd.member_company_id,
                            'client_id', gmd.member_client_id,
                            'client_name', gmd.member_client_name,
                            'display_name', gmd.member_display_name,
                            'added_at', gmd.member_added_at
                        )
                        ORDER BY COALESCE(gmd.member_display_name, gmd.member_client_name)
                    ),
                    '[]'::JSON
                )
                FROM v_company_group_member_details gmd
                WHERE gmd.group_id = v_group_id
            )
        ) INTO v_result;

        RETURN v_result;
    END IF;

    RETURN json_build_object(
        'success', true,
        'company_id', p_company_id,
        'role', 'unassociated',
        'group_id', NULL::UUID,
        'primary_company_id', NULL::UUID,
        'members', '[]'::JSON
    );
END;
$$;

COMMENT ON FUNCTION rpc_company_group_get IS
    'Returns group information for a company. Read-only, available to all authenticated users.';

-- ============================================================================
-- STEP 14: RPC - rpc_list_unassociated_companies
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_list_unassociated_companies(
    p_exclude_company_id UUID DEFAULT NULL
)
RETURNS TABLE (
    company_id UUID,
    client_id TEXT,
    client_name TEXT,
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
        c.id AS company_id,
        c.client_id,
        c.client_name,
        COALESCE(c.display_name, c.client_name) AS display_name
    FROM companies c
    JOIN v_company_canonical vcc ON vcc.company_id = c.id
    WHERE vcc.role = 'unassociated'
      AND (p_exclude_company_id IS NULL OR c.id != p_exclude_company_id)
    ORDER BY display_name;
END;
$$;

COMMENT ON FUNCTION rpc_list_unassociated_companies IS
    'Lists unassociated companies available for grouping. Used for dropdown population.';

-- ============================================================================
-- STEP 15: RLS Policies for company_groups
-- ============================================================================

ALTER TABLE company_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on company_groups" ON company_groups;
CREATE POLICY "Allow authenticated read on company_groups"
    ON company_groups
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow admin insert on company_groups" ON company_groups;
CREATE POLICY "Allow admin insert on company_groups"
    ON company_groups
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update on company_groups" ON company_groups;
CREATE POLICY "Allow admin update on company_groups"
    ON company_groups
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete on company_groups" ON company_groups;
CREATE POLICY "Allow admin delete on company_groups"
    ON company_groups
    FOR DELETE
    TO authenticated
    USING (is_admin());

DROP POLICY IF EXISTS "Allow service role full access on company_groups" ON company_groups;
CREATE POLICY "Allow service role full access on company_groups"
    ON company_groups
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 16: RLS Policies for company_group_members
-- ============================================================================

ALTER TABLE company_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on company_group_members" ON company_group_members;
CREATE POLICY "Allow authenticated read on company_group_members"
    ON company_group_members
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow admin insert on company_group_members" ON company_group_members;
CREATE POLICY "Allow admin insert on company_group_members"
    ON company_group_members
    FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update on company_group_members" ON company_group_members;
CREATE POLICY "Allow admin update on company_group_members"
    ON company_group_members
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete on company_group_members" ON company_group_members;
CREATE POLICY "Allow admin delete on company_group_members"
    ON company_group_members
    FOR DELETE
    TO authenticated
    USING (is_admin());

DROP POLICY IF EXISTS "Allow service role full access on company_group_members" ON company_group_members;
CREATE POLICY "Allow service role full access on company_group_members"
    ON company_group_members
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 17: Grant permissions
-- ============================================================================

GRANT SELECT ON company_groups TO authenticated;
GRANT SELECT ON company_group_members TO authenticated;
GRANT ALL ON company_groups TO service_role;
GRANT ALL ON company_group_members TO service_role;

GRANT SELECT ON v_company_canonical TO authenticated;
GRANT SELECT ON v_company_table_entities TO authenticated;
GRANT SELECT ON v_company_group_member_details TO authenticated;

GRANT EXECUTE ON FUNCTION rpc_company_group_create_and_add_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_company_group_add_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_company_group_remove_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_company_group_get(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_list_unassociated_companies(UUID) TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '023 Company Grouping migration complete:';
    RAISE NOTICE '  - company_groups table created';
    RAISE NOTICE '  - company_group_members table created';
    RAISE NOTICE '  - Constraint triggers for business rules';
    RAISE NOTICE '  - v_company_canonical view for canonical mapping';
    RAISE NOTICE '  - v_company_table_entities view for Companies table filtering';
    RAISE NOTICE '  - v_company_group_member_details view for modal display';
    RAISE NOTICE '  - RPC functions for group management';
    RAISE NOTICE '  - RLS policies applied';
END $$;

COMMIT;
