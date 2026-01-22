-- Rollback for Migrations 020 and 021
-- Task: 027 - Monthly Project Rates
--
-- CAUTION: This will remove all monthly rate data!
-- Only run this if you need to completely revert the feature.

-- ============================================================================
-- STEP 1: DROP RLS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated read monthly rates" ON project_monthly_rates;
DROP POLICY IF EXISTS "Allow authenticated insert monthly rates" ON project_monthly_rates;
DROP POLICY IF EXISTS "Allow authenticated update monthly rates" ON project_monthly_rates;
DROP POLICY IF EXISTS "Allow service role full access monthly rates" ON project_monthly_rates;

-- ============================================================================
-- STEP 2: DROP FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS set_project_rate_for_month(UUID, DATE, NUMERIC);
DROP FUNCTION IF EXISTS get_all_project_rates_for_month(DATE);
DROP FUNCTION IF EXISTS get_effective_rates_for_range(DATE, DATE);
DROP FUNCTION IF EXISTS get_effective_project_rate(UUID, DATE);
DROP FUNCTION IF EXISTS get_default_rate();

-- ============================================================================
-- STEP 3: DROP TRIGGER (but keep the function for now as it may be needed)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_auto_create_project ON timesheet_daily_rollups;

-- Restore original trigger function (from migration 019)
CREATE OR REPLACE FUNCTION auto_create_project_from_rollup()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id UUID;
BEGIN
    -- Skip if no project info
    IF NEW.project_id IS NULL OR NEW.project_name IS NULL THEN
        RETURN NEW;
    END IF;

    -- Try to insert new project, or update existing
    INSERT INTO projects (project_id, project_name, client_id, client_name)
    VALUES (NEW.project_id, NEW.project_name, NEW.client_id, NEW.client_name)
    ON CONFLICT (project_id) DO UPDATE
        SET project_name = EXCLUDED.project_name,
            client_id = COALESCE(projects.client_id, EXCLUDED.client_id),
            client_name = COALESCE(projects.client_name, EXCLUDED.client_name)
        WHERE projects.project_name != EXCLUDED.project_name
           OR (projects.client_id IS NULL AND EXCLUDED.client_id IS NOT NULL)
    RETURNING id INTO v_project_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate original trigger
CREATE TRIGGER trg_auto_create_project
    AFTER INSERT OR UPDATE ON timesheet_daily_rollups
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_project_from_rollup();

-- ============================================================================
-- STEP 4: DROP project_monthly_rates TABLE
-- ============================================================================

DROP TABLE IF EXISTS project_monthly_rates CASCADE;

-- ============================================================================
-- STEP 5: DROP INDEXES ON PROJECTS (if they exist)
-- ============================================================================

DROP INDEX IF EXISTS idx_projects_first_seen;

-- ============================================================================
-- STEP 6: DROP CONSTRAINT ON PROJECTS
-- ============================================================================

ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_first_seen_first_of_month;

-- ============================================================================
-- STEP 7: RESTORE PROJECTS FROM BACKUP (if backup exists)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects_backup_task027') THEN
        -- Restore only the columns that existed before
        -- Note: This preserves client_id and client_name if they were added by an earlier task

        -- Drop the new columns
        ALTER TABLE projects DROP COLUMN IF EXISTS first_seen_month;

        RAISE NOTICE 'Removed first_seen_month column from projects';
        RAISE NOTICE 'Backup table preserved: projects_backup_task027';
        RAISE NOTICE 'You can manually restore from backup if needed.';
    ELSE
        -- No backup, just remove the column
        ALTER TABLE projects DROP COLUMN IF EXISTS first_seen_month;
        RAISE NOTICE 'Removed first_seen_month column. No backup found.';
    END IF;
END $$;

-- ============================================================================
-- STEP 8: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_function_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'project_monthly_rates'
    ) INTO v_table_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_name = 'get_default_rate'
    ) INTO v_function_exists;

    RAISE NOTICE '==== Rollback Verification ====';
    RAISE NOTICE '  project_monthly_rates table exists: %', v_table_exists;
    RAISE NOTICE '  get_default_rate function exists: %', v_function_exists;

    IF NOT v_table_exists AND NOT v_function_exists THEN
        RAISE NOTICE '  Rollback: SUCCESS';
    ELSE
        RAISE WARNING '  Rollback: PARTIAL (some objects still exist)';
    END IF;
END $$;

-- ============================================================================
-- OPTIONAL: DROP BACKUP TABLE (uncomment when confident)
-- ============================================================================

-- DROP TABLE IF EXISTS projects_backup_task027;
