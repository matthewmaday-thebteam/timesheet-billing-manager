-- ============================================================================
-- Migration 043: Fix company_id Race Condition on Projects
-- ============================================================================
-- PROBLEM:
--   When a new project is inserted, two triggers fire:
--     1. trg_set_project_company_id (BEFORE INSERT) - looks up company, sets company_id
--     2. trg_auto_create_company (AFTER INSERT) - creates company if missing
--
--   On the first insert, the BEFORE trigger can't find the company (it doesn't
--   exist yet), so company_id stays NULL. The AFTER trigger then creates the
--   company, but the project is already committed with NULL company_id.
--
--   On subsequent syncs, the ON CONFLICT DO UPDATE in auto_create_project_from_rollup
--   doesn't fire if nothing changed (same name, client_id already set), so the
--   BEFORE trigger never gets another chance.
--
-- FIX:
--   Update the AFTER trigger (auto_create_company_from_project) to also set
--   company_id on the project after creating/finding the company.
--
-- AFFECTED ROWS (at time of writing): 0 (already patched via REST API)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Update the AFTER trigger function to also link project -> company
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_create_company_from_project()
RETURNS TRIGGER AS $$
DECLARE
    v_company_id UUID;
BEGIN
    -- Only process if client_id is not null
    IF NEW.client_id IS NOT NULL THEN
        -- Create or get the company
        v_company_id := upsert_company_from_project(NEW.client_id, NEW.client_name);

        -- Fix race condition: if the project's company_id is NULL,
        -- set it now that the company exists
        IF v_company_id IS NOT NULL AND NEW.company_id IS NULL THEN
            UPDATE projects
            SET company_id = v_company_id
            WHERE id = NEW.id
              AND company_id IS NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 2: Safety backfill - link any orphaned projects to their companies
-- ============================================================================

UPDATE projects p
SET company_id = c.id
FROM companies c
WHERE p.client_id = c.client_id
  AND p.company_id IS NULL;

-- ============================================================================
-- Report results
-- ============================================================================

DO $$
DECLARE
    v_orphaned INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_orphaned
    FROM projects p
    WHERE p.company_id IS NULL
      AND p.client_id IS NOT NULL
      AND p.client_id != '__UNASSIGNED__';

    RAISE NOTICE '043 Fix company_id race condition - complete';
    RAISE NOTICE '  - Updated auto_create_company_from_project() to set company_id after company creation';
    RAISE NOTICE '  - Backfilled any orphaned projects';
    RAISE NOTICE '  - Remaining orphaned projects: %', v_orphaned;
END $$;

COMMIT;
