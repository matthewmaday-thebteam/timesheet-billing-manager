-- ============================================================================
-- Migration 022: Create Companies Table
-- ============================================================================
-- Purpose: Create a dedicated companies table to track companies as first-class
-- entities, similar to how resources tracks employees.
--
-- Key concepts:
--   - Companies are auto-provisioned from projects table (client_id/client_name)
--   - Each unique client_id gets one company record
--   - Companies can later be grouped (in migration 023)
--   - NO changes to timesheet_daily_rollups table
--
-- Business rules:
--   - company.client_id is unique (like resources.user_id)
--   - Companies are auto-created when projects reference new client_ids
--   - Company names can be enriched (display_name vs external client_name)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create companies table
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- External identifier from time tracking system
    client_id TEXT NOT NULL,

    -- Name from time tracking system (may differ across systems)
    client_name TEXT NOT NULL,

    -- User-defined display name (enrichment, like resources.first_name/last_name)
    display_name TEXT,

    -- Optional notes/description
    notes TEXT,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure one company per client_id
    CONSTRAINT uq_companies_client_id UNIQUE(client_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_companies_client_name ON companies(client_name);
CREATE INDEX IF NOT EXISTS idx_companies_display_name ON companies(display_name);

COMMENT ON TABLE companies IS 'Companies/clients extracted from time tracking systems. Auto-provisioned from projects.';
COMMENT ON COLUMN companies.client_id IS 'External client ID from time tracking system (Clockify clientId, ClickUp space_id, etc.)';
COMMENT ON COLUMN companies.client_name IS 'Original name from time tracking system';
COMMENT ON COLUMN companies.display_name IS 'User-defined display name for enrichment. Falls back to client_name if NULL.';

-- ============================================================================
-- STEP 2: Updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_companies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION update_companies_updated_at();

-- ============================================================================
-- STEP 3: Upsert function for auto-provisioning
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_company_from_project(
    p_client_id TEXT,
    p_client_name TEXT
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Skip if client_id is null
    IF p_client_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Try to insert, on conflict update name if different
    INSERT INTO companies (client_id, client_name)
    VALUES (p_client_id, p_client_name)
    ON CONFLICT (client_id) DO UPDATE
        SET client_name = EXCLUDED.client_name,
            updated_at = NOW()
        WHERE companies.client_name != EXCLUDED.client_name
    RETURNING id INTO v_id;

    -- If no insert/update happened, get the existing id
    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM companies WHERE client_id = p_client_id;
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_company_from_project IS
    'Creates or updates a company record from project client data. Used for auto-provisioning.';

-- ============================================================================
-- STEP 4: Trigger to auto-create companies from projects
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_create_company_from_project()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process if client_id is not null
    IF NEW.client_id IS NOT NULL THEN
        PERFORM upsert_company_from_project(NEW.client_id, NEW.client_name);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_create_company ON projects;
CREATE TRIGGER trg_auto_create_company
    AFTER INSERT OR UPDATE OF client_id, client_name ON projects
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_company_from_project();

-- ============================================================================
-- STEP 5: Backfill companies from existing projects
-- ============================================================================

INSERT INTO companies (client_id, client_name)
SELECT DISTINCT client_id, client_name
FROM projects
WHERE client_id IS NOT NULL
ON CONFLICT (client_id) DO NOTHING;

-- ============================================================================
-- STEP 6: Add company_id FK to projects table
-- ============================================================================

-- Add nullable FK column
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- Index for FK lookups
CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);

-- Populate company_id for existing projects
UPDATE projects p
SET company_id = c.id
FROM companies c
WHERE p.client_id = c.client_id
  AND p.company_id IS NULL;

-- Update trigger to set company_id
CREATE OR REPLACE FUNCTION auto_set_project_company_id()
RETURNS TRIGGER AS $$
DECLARE
    v_company_id UUID;
BEGIN
    -- Look up or create company
    IF NEW.client_id IS NOT NULL THEN
        SELECT id INTO v_company_id
        FROM companies
        WHERE client_id = NEW.client_id;

        NEW.company_id = v_company_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_project_company_id ON projects;
CREATE TRIGGER trg_set_project_company_id
    BEFORE INSERT OR UPDATE OF client_id ON projects
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_project_company_id();

-- ============================================================================
-- STEP 7: RLS Policies
-- ============================================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Read: All authenticated users
DROP POLICY IF EXISTS "Allow authenticated read on companies" ON companies;
CREATE POLICY "Allow authenticated read on companies"
    ON companies
    FOR SELECT
    TO authenticated
    USING (true);

-- Update: Admins only (for enrichment)
DROP POLICY IF EXISTS "Allow admin update on companies" ON companies;
CREATE POLICY "Allow admin update on companies"
    ON companies
    FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- Insert: Service role only (auto-provisioning)
DROP POLICY IF EXISTS "Allow service role insert on companies" ON companies;
CREATE POLICY "Allow service role insert on companies"
    ON companies
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Service role: Full access
DROP POLICY IF EXISTS "Allow service role full access on companies" ON companies;
CREATE POLICY "Allow service role full access on companies"
    ON companies
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 8: Grant permissions
-- ============================================================================

GRANT SELECT ON companies TO authenticated;
GRANT UPDATE ON companies TO authenticated;
GRANT ALL ON companies TO service_role;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM companies;

    RAISE NOTICE '022 Create Companies Table migration complete:';
    RAISE NOTICE '  - companies table created';
    RAISE NOTICE '  - Auto-provisioning trigger on projects table';
    RAISE NOTICE '  - company_id FK added to projects table';
    RAISE NOTICE '  - Backfilled % companies from existing projects', v_count;
    RAISE NOTICE '  - RLS policies applied';
    RAISE NOTICE '';
    RAISE NOTICE 'NOTE: timesheet_daily_rollups table was NOT modified.';
END $$;

COMMIT;
