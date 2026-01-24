-- Migration 026: Create Project Monthly Rounding
-- This migration creates the infrastructure for per-project, per-month rounding increments
-- Follows the same pattern as project_monthly_rates (migration 020)

-- ============================================================================
-- STEP 1: DEFAULT ROUNDING FUNCTION
-- ============================================================================

-- Single source of truth for default rounding increment (15 minutes)
CREATE OR REPLACE FUNCTION get_default_rounding_increment()
RETURNS INTEGER AS $$
BEGIN
    RETURN 15;  -- Change here to update default everywhere
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_default_rounding_increment() IS 'Returns the default rounding increment (15 minutes). Central source of truth.';

-- ============================================================================
-- STEP 2: CREATE PROJECT_MONTHLY_ROUNDING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_monthly_rounding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign key to projects table
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Month this rounding applies to (always first day of month)
    rounding_month DATE NOT NULL,

    -- Rounding increment in minutes (0 = actual/no rounding, 5, 15, 30)
    rounding_increment INTEGER NOT NULL DEFAULT 15,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_monthly_rounding UNIQUE (project_id, rounding_month),
    CONSTRAINT chk_rounding_month_first CHECK (EXTRACT(DAY FROM rounding_month) = 1),
    CONSTRAINT chk_valid_increment CHECK (rounding_increment IN (0, 5, 15, 30))
);

COMMENT ON TABLE project_monthly_rounding IS 'Stores monthly rounding increments per project. One rounding setting per project per month.';
COMMENT ON COLUMN project_monthly_rounding.rounding_month IS 'Always first day of month (e.g., 2026-01-01)';
COMMENT ON COLUMN project_monthly_rounding.rounding_increment IS 'Rounding increment in minutes: 0 (actual), 5, 15, or 30';

-- ============================================================================
-- STEP 3: CREATE INDEXES
-- ============================================================================

-- Primary lookup: get rounding for project in a specific month
CREATE INDEX IF NOT EXISTS idx_pmr_rounding_project_month
    ON project_monthly_rounding (project_id, rounding_month DESC);

-- Support "all roundings in a given month" queries
CREATE INDEX IF NOT EXISTS idx_pmr_rounding_month
    ON project_monthly_rounding (rounding_month);

-- ============================================================================
-- STEP 4: CREATE UPDATED_AT TRIGGER
-- ============================================================================

-- Drop if exists, then create
DROP TRIGGER IF EXISTS trg_pmr_rounding_updated_at ON project_monthly_rounding;

CREATE TRIGGER trg_pmr_rounding_updated_at
    BEFORE UPDATE ON project_monthly_rounding
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 5: CREATE SINGLE ROUNDING LOOKUP FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_project_rounding(
    p_project_id UUID,
    p_month DATE
)
RETURNS TABLE (
    effective_rounding INTEGER,
    source TEXT,
    source_month DATE
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_first_seen_month DATE;
    v_lookup_month DATE;
    v_rounding INTEGER;
    v_rounding_month DATE;
BEGIN
    -- Get first_seen_month for this project
    SELECT first_seen_month INTO v_first_seen_month
    FROM projects WHERE id = p_project_id;

    -- Handle NULL first_seen_month
    IF v_first_seen_month IS NULL THEN
        RAISE WARNING 'Project % has NULL first_seen_month', p_project_id;
        RETURN QUERY SELECT get_default_rounding_increment(), 'default'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    -- Determine which month to look up (backfill if before first_seen)
    v_lookup_month := GREATEST(v_month, v_first_seen_month);

    -- Find most recent rounding <= lookup month
    SELECT pmr.rounding_increment, pmr.rounding_month
    INTO v_rounding, v_rounding_month
    FROM project_monthly_rounding pmr
    WHERE pmr.project_id = p_project_id
      AND pmr.rounding_month <= v_lookup_month
    ORDER BY pmr.rounding_month DESC
    LIMIT 1;

    -- Determine source
    IF v_rounding IS NOT NULL THEN
        IF v_month < v_first_seen_month THEN
            RETURN QUERY SELECT v_rounding, 'backfill'::TEXT, v_rounding_month;
        ELSIF v_rounding_month = v_month THEN
            RETURN QUERY SELECT v_rounding, 'explicit'::TEXT, v_rounding_month;
        ELSE
            RETURN QUERY SELECT v_rounding, 'inherited'::TEXT, v_rounding_month;
        END IF;
    ELSE
        -- No explicit rounding set - use default
        RETURN QUERY SELECT get_default_rounding_increment(), 'default'::TEXT, NULL::DATE;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_effective_project_rounding(UUID, DATE) IS 'Returns effective rounding increment for a project in a given month with source tracking';

-- ============================================================================
-- STEP 6: CREATE BULK ROUNDING LOOKUP FUNCTION (for the Rates page)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_all_project_roundings_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    effective_rounding INTEGER,
    source TEXT,
    source_month DATE
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    RETURN QUERY
    WITH rounding_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pmr.rounding_increment,
            pmr.rounding_month
        FROM projects p
        LEFT JOIN project_monthly_rounding pmr
            ON pmr.project_id = p.id
           AND pmr.rounding_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pmr.rounding_month DESC
    )
    SELECT
        rl.proj_id AS project_id,
        COALESCE(rl.rounding_increment, get_default_rounding_increment()) AS effective_rounding,
        CASE
            WHEN rl.rounding_increment IS NULL THEN 'default'
            WHEN v_month < rl.first_seen_month THEN 'backfill'
            WHEN rl.rounding_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.rounding_month AS source_month
    FROM rounding_lookup rl;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_all_project_roundings_for_month(DATE) IS 'Returns all projects with effective rounding for a given month';

-- ============================================================================
-- STEP 7: CREATE ADMIN ROUNDING UPDATE FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION set_project_rounding_for_month(
    p_project_id UUID,
    p_month DATE,
    p_increment INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    -- Validate increment
    IF p_increment NOT IN (0, 5, 15, 30) THEN
        RAISE EXCEPTION 'Invalid rounding increment. Must be 0, 5, 15, or 30';
    END IF;

    -- Upsert: last write wins
    INSERT INTO project_monthly_rounding (project_id, rounding_month, rounding_increment)
    VALUES (p_project_id, v_month, p_increment)
    ON CONFLICT (project_id, rounding_month) DO UPDATE
    SET rounding_increment = EXCLUDED.rounding_increment, updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_project_rounding_for_month(UUID, DATE, INTEGER) IS 'Sets or updates rounding for a project in a specific month (admin function)';

-- ============================================================================
-- STEP 8: UPDATE get_all_project_rates_for_month TO INCLUDE ROUNDING
-- ============================================================================

-- Drop and recreate to add rounding columns
DROP FUNCTION IF EXISTS get_all_project_rates_for_month(DATE);

CREATE OR REPLACE FUNCTION get_all_project_rates_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    external_project_id TEXT,
    project_name TEXT,
    client_id TEXT,
    client_name TEXT,
    first_seen_month DATE,
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE,
    existed_in_month BOOLEAN,
    -- New rounding columns
    effective_rounding INTEGER,
    rounding_source TEXT,
    rounding_source_month DATE
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
            p.first_seen_month,
            pmr.rate,
            pmr.rate_month
        FROM projects p
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = p.id
           AND pmr.rate_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pmr.rate_month DESC
    ),
    rounding_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pround.rounding_increment,
            pround.rounding_month
        FROM projects p
        LEFT JOIN project_monthly_rounding pround
            ON pround.project_id = p.id
           AND pround.rounding_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pround.rounding_month DESC
    )
    SELECT
        rl.proj_id AS project_id,
        rl.ext_id AS external_project_id,
        rl.project_name,
        rl.client_id,
        rl.client_name,
        rl.first_seen_month,
        COALESCE(rl.rate, get_default_rate()) AS effective_rate,
        CASE
            WHEN rl.rate IS NULL THEN 'default'
            WHEN v_month < rl.first_seen_month THEN 'backfill'
            WHEN rl.rate_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.rate_month AS source_month,
        (v_month >= rl.first_seen_month) AS existed_in_month,
        -- Rounding columns
        COALESCE(rndl.rounding_increment, get_default_rounding_increment()) AS effective_rounding,
        CASE
            WHEN rndl.rounding_increment IS NULL THEN 'default'
            WHEN v_month < rndl.first_seen_month THEN 'backfill'
            WHEN rndl.rounding_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS rounding_source,
        rndl.rounding_month AS rounding_source_month
    FROM rate_lookup rl
    LEFT JOIN rounding_lookup rndl ON rndl.proj_id = rl.proj_id
    ORDER BY rl.client_name NULLS LAST, rl.project_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_all_project_rates_for_month(DATE) IS 'Returns all projects with effective rates and rounding for a given month (for Rates page)';

-- ============================================================================
-- STEP 9: ENABLE RLS AND CREATE POLICIES
-- ============================================================================

ALTER TABLE project_monthly_rounding ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated read monthly rounding" ON project_monthly_rounding;
DROP POLICY IF EXISTS "Allow authenticated insert monthly rounding" ON project_monthly_rounding;
DROP POLICY IF EXISTS "Allow authenticated update monthly rounding" ON project_monthly_rounding;
DROP POLICY IF EXISTS "Allow service role full access monthly rounding" ON project_monthly_rounding;

-- Create policies
CREATE POLICY "Allow authenticated read monthly rounding"
    ON project_monthly_rounding FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert monthly rounding"
    ON project_monthly_rounding FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update monthly rounding"
    ON project_monthly_rounding FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow service role full access monthly rounding"
    ON project_monthly_rounding FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- STEP 10: GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON project_monthly_rounding TO authenticated;
GRANT ALL ON project_monthly_rounding TO service_role;
GRANT EXECUTE ON FUNCTION get_default_rounding_increment() TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_project_rounding(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_project_roundings_for_month(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION set_project_rounding_for_month(UUID, DATE, INTEGER) TO authenticated;

-- ============================================================================
-- STEP 11: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_table_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'project_monthly_rounding'
    ) INTO v_table_exists;

    IF v_table_exists THEN
        RAISE NOTICE 'Migration 026 Complete: project_monthly_rounding table created successfully';
    ELSE
        RAISE EXCEPTION 'Migration 026 Failed: project_monthly_rounding table was not created';
    END IF;
END $$;
