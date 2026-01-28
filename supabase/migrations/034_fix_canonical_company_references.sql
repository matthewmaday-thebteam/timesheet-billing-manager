-- ============================================================================
-- Migration 034: Fix Canonical Company References
-- ============================================================================
-- Purpose: Ensure all views and functions properly use canonical company
--          mappings for consistent aggregation and display.
--
-- Fixes:
--   1. v_company_table_entities: project_count should aggregate across
--      all companies in a group (primary + members)
--   2. v_project_table_entities: company_display_name should use the
--      canonical (primary) company's display name
--   3. get_all_project_rates_for_month: Return canonical company info
--      instead of raw project client_id/client_name
-- ============================================================================

BEGIN;

-- ============================================================================
-- FIX 1: v_company_table_entities - Aggregate project_count across group
-- ============================================================================
-- The project_count should include projects from:
--   - The company itself (if primary or unassociated)
--   - All member companies (if primary)

-- Must DROP first because CREATE OR REPLACE can't change column structure
DROP VIEW IF EXISTS v_company_table_entities;

CREATE VIEW v_company_table_entities AS
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
    -- Aggregated project count for this company AND all its grouped members
    (
        SELECT COUNT(*)::INTEGER
        FROM projects p
        JOIN companies comp ON comp.id = p.company_id
        JOIN v_company_canonical comp_canonical ON comp_canonical.company_id = comp.id
        WHERE comp_canonical.canonical_company_id = c.id
    ) AS project_count
FROM companies c
LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
WHERE vcc.role IS NULL OR vcc.role != 'member';

COMMENT ON VIEW v_company_table_entities IS 'Returns companies visible in the Companies table (primaries and unassociated, excludes members). project_count aggregates across grouped companies.';

-- Grant permissions
GRANT SELECT ON v_company_table_entities TO authenticated;

-- ============================================================================
-- FIX 2: v_project_table_entities - Use canonical company display name
-- ============================================================================
-- The company_display_name should resolve to the canonical (primary) company's
-- display name when the project belongs to a member company.

-- Must DROP first because CREATE OR REPLACE can't change column structure
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
    -- Company display info (using canonical company mapping)
    -- First get the raw company, then resolve to canonical
    c.id AS company_uuid,
    -- Use canonical company's display name for proper grouping
    COALESCE(
        canonical_c.display_name,
        canonical_c.client_name,
        c.display_name,
        c.client_name,
        p.client_name
    ) AS company_display_name,
    -- Also expose the canonical company ID for reference
    vcc.canonical_company_id AS canonical_company_uuid
FROM projects p
LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
LEFT JOIN companies c ON c.client_id = p.client_id
LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
LEFT JOIN companies canonical_c ON canonical_c.id = vcc.canonical_company_id
WHERE vpc.role IS NULL OR vpc.role != 'member';

COMMENT ON VIEW v_project_table_entities IS 'Returns projects visible in the Projects table (primaries and unassociated, excludes members). company_display_name uses canonical company resolution.';

-- Grant permissions
GRANT SELECT ON v_project_table_entities TO authenticated;

-- ============================================================================
-- FIX 3: get_all_project_rates_for_month - Return canonical company info
-- ============================================================================
-- Add canonical_client_id and canonical_client_name to the return type
-- so consumers don't need to resolve company grouping separately.

DROP FUNCTION IF EXISTS get_all_project_rates_for_month(DATE);

CREATE OR REPLACE FUNCTION get_all_project_rates_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    external_project_id TEXT,
    project_name TEXT,
    client_id TEXT,
    client_name TEXT,
    -- NEW: Canonical company info for proper grouping
    canonical_client_id TEXT,
    canonical_client_name TEXT,
    first_seen_month DATE,
    -- Rate fields
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE,
    existed_in_month BOOLEAN,
    -- Rounding fields
    effective_rounding INTEGER,
    rounding_source TEXT,
    rounding_source_month DATE,
    -- Billing limits fields
    minimum_hours NUMERIC,
    maximum_hours NUMERIC,
    carryover_enabled BOOLEAN,
    carryover_max_hours NUMERIC,
    carryover_expiry_months INTEGER,
    limits_source TEXT,
    limits_source_month DATE,
    -- Active status fields
    is_active BOOLEAN,
    active_source TEXT,
    active_source_month DATE,
    -- Carryover available
    carryover_hours_in NUMERIC
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    RETURN QUERY
    WITH rate_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.project_id AS ext_id,
            p.project_name,
            p.client_id,
            p.client_name,
            -- Get canonical company info
            COALESCE(canonical_c.client_id, c.client_id, p.client_id) AS canonical_client_id,
            COALESCE(canonical_c.display_name, canonical_c.client_name, c.display_name, c.client_name, p.client_name) AS canonical_client_name,
            p.first_seen_month,
            pmr.rate,
            pmr.rate_month
        FROM projects p
        -- Join with v_project_canonical to filter out member projects
        LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
        -- Join to get raw company
        LEFT JOIN companies c ON c.client_id = p.client_id
        -- Join to get canonical company mapping
        LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
        -- Join to get canonical company details
        LEFT JOIN companies canonical_c ON canonical_c.id = vcc.canonical_company_id
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = p.id
           AND pmr.rate_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
          -- Only include primaries and unassociated (exclude members)
          AND (vpc.role IS NULL OR vpc.role != 'member')
        ORDER BY p.id, pmr.rate_month DESC
    ),
    rounding_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pround.rounding_increment,
            pround.rounding_month
        FROM projects p
        -- Join with v_project_canonical to filter out member projects
        LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
        LEFT JOIN project_monthly_rounding pround
            ON pround.project_id = p.id
           AND pround.rounding_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
          AND (vpc.role IS NULL OR vpc.role != 'member')
        ORDER BY p.id, pround.rounding_month DESC
    ),
    limits_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pbl.minimum_hours,
            pbl.maximum_hours,
            pbl.carryover_enabled,
            pbl.carryover_max_hours,
            pbl.carryover_expiry_months,
            pbl.limits_month
        FROM projects p
        -- Join with v_project_canonical to filter out member projects
        LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
        LEFT JOIN project_monthly_billing_limits pbl
            ON pbl.project_id = p.id
           AND pbl.limits_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
          AND (vpc.role IS NULL OR vpc.role != 'member')
        ORDER BY p.id, pbl.limits_month DESC
    ),
    status_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pas.is_active,
            pas.status_month
        FROM projects p
        -- Join with v_project_canonical to filter out member projects
        LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
        LEFT JOIN project_monthly_active_status pas
            ON pas.project_id = p.id
           AND pas.status_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
          AND (vpc.role IS NULL OR vpc.role != 'member')
        ORDER BY p.id, pas.status_month DESC
    ),
    carryover_lookup AS (
        SELECT
            pch.project_id AS proj_id,
            SUM(pch.carryover_hours) AS total_carryover
        FROM project_carryover_hours pch
        WHERE pch.carryover_month = v_month
        GROUP BY pch.project_id
    )
    SELECT
        rl.proj_id AS project_id,
        rl.ext_id AS external_project_id,
        rl.project_name,
        rl.client_id,
        rl.client_name,
        -- Canonical company info
        rl.canonical_client_id,
        rl.canonical_client_name,
        rl.first_seen_month,
        -- Rate
        COALESCE(rl.rate, get_default_rate()) AS effective_rate,
        CASE
            WHEN rl.rate IS NULL THEN 'default'
            WHEN v_month < rl.first_seen_month THEN 'backfill'
            WHEN rl.rate_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.rate_month AS source_month,
        (v_month >= rl.first_seen_month) AS existed_in_month,
        -- Rounding
        COALESCE(rndl.rounding_increment, get_default_rounding_increment()) AS effective_rounding,
        CASE
            WHEN rndl.rounding_increment IS NULL THEN 'default'
            WHEN v_month < rndl.first_seen_month THEN 'backfill'
            WHEN rndl.rounding_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS rounding_source,
        rndl.rounding_month AS rounding_source_month,
        -- Billing limits
        ll.minimum_hours,
        ll.maximum_hours,
        COALESCE(ll.carryover_enabled, false) AS carryover_enabled,
        ll.carryover_max_hours,
        ll.carryover_expiry_months,
        CASE
            WHEN ll.limits_month IS NULL THEN 'default'
            WHEN v_month < ll.first_seen_month THEN 'backfill'
            WHEN ll.limits_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS limits_source,
        ll.limits_month AS limits_source_month,
        -- Active status
        COALESCE(sl.is_active, true) AS is_active,
        CASE
            WHEN sl.status_month IS NULL THEN 'default'
            WHEN v_month < sl.first_seen_month THEN 'backfill'
            WHEN sl.status_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS active_source,
        sl.status_month AS active_source_month,
        -- Carryover
        COALESCE(cl.total_carryover, 0) AS carryover_hours_in
    FROM rate_lookup rl
    LEFT JOIN rounding_lookup rndl ON rndl.proj_id = rl.proj_id
    LEFT JOIN limits_lookup ll ON ll.proj_id = rl.proj_id
    LEFT JOIN status_lookup sl ON sl.proj_id = rl.proj_id
    LEFT JOIN carryover_lookup cl ON cl.proj_id = rl.proj_id
    ORDER BY rl.canonical_client_name NULLS LAST, rl.project_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_all_project_rates_for_month(DATE) IS 'Returns canonical projects with effective rates, rounding, billing limits, active status, and carryover. Includes canonical_client_id and canonical_client_name for proper company grouping.';

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '034 Fix canonical company references migration complete:';
    RAISE NOTICE '  - v_company_table_entities: project_count now aggregates across grouped companies';
    RAISE NOTICE '  - v_project_table_entities: company_display_name now uses canonical company';
    RAISE NOTICE '  - get_all_project_rates_for_month: Now returns canonical_client_id and canonical_client_name';
END $$;

COMMIT;
