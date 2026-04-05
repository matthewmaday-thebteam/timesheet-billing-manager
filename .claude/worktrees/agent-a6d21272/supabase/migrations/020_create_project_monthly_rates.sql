-- Migration 020: Create Project Monthly Rates
-- This migration creates the infrastructure for monthly project rates
-- Task: 027 - Monthly Project Rates

-- ============================================================================
-- STEP 0: BACKUP (Create backup table for rollback)
-- ============================================================================

-- Backup projects table before modifications
CREATE TABLE IF NOT EXISTS projects_backup_task027 AS
SELECT * FROM projects;

-- Log backup count
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM projects_backup_task027;
    RAISE NOTICE 'Backed up % projects to projects_backup_task027', v_count;
END $$;

-- ============================================================================
-- STEP 1: DEFAULT RATE FUNCTION
-- ============================================================================

-- Single source of truth for default rate
CREATE OR REPLACE FUNCTION get_default_rate()
RETURNS NUMERIC AS $$
BEGIN
    RETURN 45.00;  -- Change here to update default everywhere
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_default_rate() IS 'Returns the default hourly rate for new projects. Central source of truth.';

-- ============================================================================
-- STEP 2: ADD COLUMNS TO PROJECTS TABLE
-- ============================================================================

-- Add first_seen_month (populated on detection, should not remain NULL after migration)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS first_seen_month DATE;

-- Add client info columns (if not already present from task 025/026)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name TEXT;

-- ============================================================================
-- STEP 3: POPULATE FIRST_SEEN_MONTH FROM ACTUAL DATA
-- ============================================================================

-- Compute first_seen_month from actual timesheet data (MIN of work_date)
UPDATE projects p
SET first_seen_month = sub.first_month
FROM (
    SELECT
        project_id,
        DATE_TRUNC('month', MIN(work_date))::DATE AS first_month
    FROM timesheet_daily_rollups
    GROUP BY project_id
) sub
WHERE p.project_id = sub.project_id
  AND p.first_seen_month IS NULL;

-- For projects with no rollup data, use created_at as fallback
UPDATE projects
SET first_seen_month = DATE_TRUNC('month', created_at)::DATE
WHERE first_seen_month IS NULL;

-- Log results
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM projects WHERE first_seen_month IS NOT NULL;
    RAISE NOTICE 'Set first_seen_month for % projects', v_count;
END $$;

-- ============================================================================
-- STEP 4: POPULATE CLIENT INFO FROM ROLLUPS
-- ============================================================================

-- Populate client info from rollups (use most recent)
UPDATE projects p
SET client_id = sub.client_id,
    client_name = sub.client_name
FROM (
    SELECT DISTINCT ON (project_id)
        project_id,
        client_id,
        client_name
    FROM timesheet_daily_rollups
    WHERE client_id IS NOT NULL
    ORDER BY project_id, synced_at DESC
) sub
WHERE p.project_id = sub.project_id
  AND p.client_id IS NULL;

-- ============================================================================
-- STEP 5: ADD CONSTRAINTS
-- ============================================================================

-- Constraint ensures first_seen_month is always first of month (if not null)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_first_seen_first_of_month'
    ) THEN
        ALTER TABLE projects ADD CONSTRAINT chk_first_seen_first_of_month
            CHECK (first_seen_month IS NULL OR EXTRACT(DAY FROM first_seen_month) = 1);
    END IF;
END $$;

-- ============================================================================
-- STEP 6: CREATE PROJECT_MONTHLY_RATES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_monthly_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign key to projects table
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Month this rate applies to (always first day of month)
    rate_month DATE NOT NULL,

    -- Hourly rate for this month
    rate NUMERIC(10, 2) NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_monthly_rate UNIQUE (project_id, rate_month),
    CONSTRAINT chk_rate_month_first_of_month CHECK (EXTRACT(DAY FROM rate_month) = 1),
    CONSTRAINT chk_rate_non_negative CHECK (rate >= 0)
);

COMMENT ON TABLE project_monthly_rates IS 'Stores monthly billing rates per project. One rate per project per month.';
COMMENT ON COLUMN project_monthly_rates.rate_month IS 'Always first day of month (e.g., 2026-01-01)';
COMMENT ON COLUMN project_monthly_rates.rate IS 'Hourly billing rate for this project in this month';

-- ============================================================================
-- STEP 7: CREATE INDEXES
-- ============================================================================

-- Primary lookup: get rate for project in a specific month
CREATE INDEX IF NOT EXISTS idx_pmr_project_month
    ON project_monthly_rates (project_id, rate_month DESC);

-- Support "all rates in a given month" queries (rates page)
CREATE INDEX IF NOT EXISTS idx_pmr_month
    ON project_monthly_rates (rate_month);

-- Projects first_seen_month for range queries
CREATE INDEX IF NOT EXISTS idx_projects_first_seen
    ON projects (first_seen_month);

-- ============================================================================
-- STEP 8: CREATE UPDATED_AT TRIGGER
-- ============================================================================

-- Drop if exists, then create
DROP TRIGGER IF EXISTS trg_pmr_updated_at ON project_monthly_rates;

CREATE TRIGGER trg_pmr_updated_at
    BEFORE UPDATE ON project_monthly_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 9: CREATE SINGLE RATE LOOKUP FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_project_rate(
    p_project_id UUID,
    p_month DATE
)
RETURNS TABLE (
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_first_seen_month DATE;
    v_lookup_month DATE;
    v_rate NUMERIC;
    v_rate_month DATE;
BEGIN
    -- Get first_seen_month for this project
    SELECT first_seen_month INTO v_first_seen_month
    FROM projects WHERE id = p_project_id;

    -- Handle NULL first_seen_month (should not happen after migration)
    IF v_first_seen_month IS NULL THEN
        RAISE WARNING 'Project % has NULL first_seen_month', p_project_id;
        RETURN QUERY SELECT get_default_rate(), 'default'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    -- Determine which month to look up (backfill if before first_seen)
    v_lookup_month := GREATEST(v_month, v_first_seen_month);

    -- Find most recent rate <= lookup month
    SELECT pmr.rate, pmr.rate_month
    INTO v_rate, v_rate_month
    FROM project_monthly_rates pmr
    WHERE pmr.project_id = p_project_id
      AND pmr.rate_month <= v_lookup_month
    ORDER BY pmr.rate_month DESC
    LIMIT 1;

    -- Determine source
    IF v_rate IS NOT NULL THEN
        IF v_month < v_first_seen_month THEN
            RETURN QUERY SELECT v_rate, 'backfill'::TEXT, v_rate_month;
        ELSIF v_rate_month = v_month THEN
            RETURN QUERY SELECT v_rate, 'explicit'::TEXT, v_rate_month;
        ELSE
            RETURN QUERY SELECT v_rate, 'inherited'::TEXT, v_rate_month;
        END IF;
    ELSE
        -- Data integrity issue - should not happen
        RAISE WARNING 'No rate found for project % month %', p_project_id, v_month;
        RETURN QUERY SELECT get_default_rate(), 'default'::TEXT, NULL::DATE;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_effective_project_rate(UUID, DATE) IS 'Returns effective rate for a project in a given month with source tracking';

-- ============================================================================
-- STEP 10: CREATE BULK RATE LOOKUP FUNCTION (for reports)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_rates_for_range(
    p_start_month DATE,
    p_end_month DATE
)
RETURNS TABLE (
    project_id UUID,
    rate_month DATE,
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE
) AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Generate all months in range
    months AS (
        SELECT generate_series(
            DATE_TRUNC('month', p_start_month)::DATE,
            DATE_TRUNC('month', p_end_month)::DATE,
            '1 month'::INTERVAL
        )::DATE AS month
    ),
    -- Cross join projects with months
    project_months AS (
        SELECT p.id AS proj_id, p.first_seen_month, m.month
        FROM projects p
        CROSS JOIN months m
        WHERE p.first_seen_month IS NOT NULL
    ),
    -- Find effective rate for each project-month
    rates_lookup AS (
        SELECT DISTINCT ON (pm.proj_id, pm.month)
            pm.proj_id,
            pm.month,
            pm.first_seen_month,
            pmr.rate AS eff_rate,
            pmr.rate_month AS src_month
        FROM project_months pm
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = pm.proj_id
           AND pmr.rate_month <= GREATEST(pm.month, pm.first_seen_month)
        ORDER BY pm.proj_id, pm.month, pmr.rate_month DESC
    )
    SELECT
        rl.proj_id AS project_id,
        rl.month AS rate_month,
        COALESCE(rl.eff_rate, get_default_rate()) AS effective_rate,
        CASE
            WHEN rl.eff_rate IS NULL THEN 'default'
            WHEN rl.month < rl.first_seen_month THEN 'backfill'
            WHEN rl.src_month = rl.month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.src_month AS source_month
    FROM rates_lookup rl;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_effective_rates_for_range(DATE, DATE) IS 'Returns effective rates for all projects across a date range (for reports)';

-- ============================================================================
-- STEP 11: CREATE RATES PAGE QUERY FUNCTION
-- ============================================================================

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
    existed_in_month BOOLEAN
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
        (v_month >= rl.first_seen_month) AS existed_in_month
    FROM rate_lookup rl
    ORDER BY rl.client_name NULLS LAST, rl.project_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_all_project_rates_for_month(DATE) IS 'Returns all projects with effective rates for a given month (for Rates page)';

-- ============================================================================
-- STEP 12: CREATE ADMIN RATE UPDATE FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION set_project_rate_for_month(
    p_project_id UUID,
    p_month DATE,
    p_rate NUMERIC
)
RETURNS BOOLEAN AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    -- Validate rate
    IF p_rate < 0 THEN
        RAISE EXCEPTION 'Rate cannot be negative';
    END IF;

    -- Upsert: last write wins
    INSERT INTO project_monthly_rates (project_id, rate_month, rate)
    VALUES (p_project_id, v_month, p_rate)
    ON CONFLICT (project_id, rate_month) DO UPDATE
    SET rate = EXCLUDED.rate, updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_project_rate_for_month(UUID, DATE, NUMERIC) IS 'Sets or updates rate for a project in a specific month (admin function)';

-- ============================================================================
-- STEP 13: UPDATE AUTO-DETECTION TRIGGER (Guarded, Concurrent-Safe)
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_create_project_from_rollup()
RETURNS TRIGGER AS $$
DECLARE
    v_project_uuid UUID;
    v_work_month DATE;
    v_current_first_seen DATE;
    v_existing_rate NUMERIC;
BEGIN
    -- Guard: only process if relevant columns changed (or INSERT)
    IF TG_OP = 'UPDATE' AND NOT (
        OLD.project_id IS DISTINCT FROM NEW.project_id OR
        OLD.project_name IS DISTINCT FROM NEW.project_name OR
        OLD.work_date IS DISTINCT FROM NEW.work_date
    ) THEN
        RETURN NEW;
    END IF;

    -- Skip if no project info
    IF NEW.project_id IS NULL OR NEW.project_name IS NULL THEN
        RETURN NEW;
    END IF;

    v_work_month := DATE_TRUNC('month', NEW.work_date)::DATE;

    -- Try to insert new project, or get existing
    INSERT INTO projects (project_id, project_name, first_seen_month, client_id, client_name)
    VALUES (NEW.project_id, NEW.project_name, v_work_month, NEW.client_id, NEW.client_name)
    ON CONFLICT (project_id) DO UPDATE
        SET project_name = EXCLUDED.project_name,
            client_id = COALESCE(projects.client_id, EXCLUDED.client_id),
            client_name = COALESCE(projects.client_name, EXCLUDED.client_name)
        WHERE projects.project_name != EXCLUDED.project_name
           OR (projects.client_id IS NULL AND EXCLUDED.client_id IS NOT NULL)
    RETURNING id, first_seen_month INTO v_project_uuid, v_current_first_seen;

    -- Get ID if no insert/update happened
    IF v_project_uuid IS NULL THEN
        SELECT id, first_seen_month
        INTO v_project_uuid, v_current_first_seen
        FROM projects WHERE project_id = NEW.project_id;
    END IF;

    -- Handle first_seen_month logic
    IF v_current_first_seen IS NULL THEN
        -- First detection: set first_seen_month and create rate record
        UPDATE projects
        SET first_seen_month = v_work_month
        WHERE id = v_project_uuid;

        INSERT INTO project_monthly_rates (project_id, rate_month, rate)
        VALUES (v_project_uuid, v_work_month, get_default_rate())
        ON CONFLICT (project_id, rate_month) DO NOTHING;

    ELSIF v_work_month < v_current_first_seen THEN
        -- Earlier month discovered: copy rate from current first_seen_month
        SELECT rate INTO v_existing_rate
        FROM project_monthly_rates
        WHERE project_id = v_project_uuid
          AND rate_month = v_current_first_seen;

        -- Update first_seen_month to earlier month
        UPDATE projects
        SET first_seen_month = v_work_month
        WHERE id = v_project_uuid
          AND first_seen_month > v_work_month;

        -- Insert rate for earlier month (copy existing or use default)
        INSERT INTO project_monthly_rates (project_id, rate_month, rate)
        VALUES (v_project_uuid, v_work_month, COALESCE(v_existing_rate, get_default_rate()))
        ON CONFLICT (project_id, rate_month) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_create_project_from_rollup() IS 'Auto-creates projects and initial rates when timesheet data is synced';

-- Recreate trigger (drop existing first)
DROP TRIGGER IF EXISTS trg_auto_create_project ON timesheet_daily_rollups;
CREATE TRIGGER trg_auto_create_project
    AFTER INSERT OR UPDATE ON timesheet_daily_rollups
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_project_from_rollup();

-- ============================================================================
-- STEP 14: ENABLE RLS AND CREATE POLICIES
-- ============================================================================

ALTER TABLE project_monthly_rates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow authenticated read monthly rates" ON project_monthly_rates;
DROP POLICY IF EXISTS "Allow authenticated insert monthly rates" ON project_monthly_rates;
DROP POLICY IF EXISTS "Allow authenticated update monthly rates" ON project_monthly_rates;
DROP POLICY IF EXISTS "Allow service role full access monthly rates" ON project_monthly_rates;

-- Create policies
CREATE POLICY "Allow authenticated read monthly rates"
    ON project_monthly_rates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert monthly rates"
    ON project_monthly_rates FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update monthly rates"
    ON project_monthly_rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow service role full access monthly rates"
    ON project_monthly_rates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- STEP 15: GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON project_monthly_rates TO authenticated;
GRANT ALL ON project_monthly_rates TO service_role;
GRANT EXECUTE ON FUNCTION get_default_rate() TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_project_rate(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_rates_for_range(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_project_rates_for_month(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION set_project_rate_for_month(UUID, DATE, NUMERIC) TO authenticated;

-- ============================================================================
-- STEP 16: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_projects_with_first_seen INTEGER;
    v_projects_total INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_projects_total FROM projects;
    SELECT COUNT(*) INTO v_projects_with_first_seen FROM projects WHERE first_seen_month IS NOT NULL;

    RAISE NOTICE 'Migration 020 Complete:';
    RAISE NOTICE '  - Total projects: %', v_projects_total;
    RAISE NOTICE '  - Projects with first_seen_month: %', v_projects_with_first_seen;

    IF v_projects_with_first_seen != v_projects_total THEN
        RAISE WARNING 'Some projects still have NULL first_seen_month: %', v_projects_total - v_projects_with_first_seen;
    END IF;
END $$;
