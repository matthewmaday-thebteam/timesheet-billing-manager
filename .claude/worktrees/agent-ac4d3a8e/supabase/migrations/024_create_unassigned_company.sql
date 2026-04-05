-- ============================================================================
-- Migration 024: Create Unassigned Company
-- ============================================================================
-- Purpose: Create a catch-all "Unassigned" company for projects that don't
-- have a client_id from the time tracking system.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create the Unassigned company
-- ============================================================================

INSERT INTO companies (client_id, client_name, display_name)
VALUES (
    '__UNASSIGNED__',
    'Unassigned',
    'Unassigned'
)
ON CONFLICT (client_id) DO NOTHING;

-- ============================================================================
-- STEP 2: Update projects with NULL client_id to use Unassigned
-- ============================================================================

UPDATE projects
SET
    client_id = '__UNASSIGNED__',
    client_name = 'Unassigned',
    company_id = (SELECT id FROM companies WHERE client_id = '__UNASSIGNED__')
WHERE client_id IS NULL;

-- ============================================================================
-- STEP 3: Update trigger to assign Unassigned company for NULL client_ids
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_create_company_from_project()
RETURNS TRIGGER AS $$
DECLARE
    v_unassigned_company_id UUID;
BEGIN
    -- If client_id is null, assign to Unassigned company
    IF NEW.client_id IS NULL THEN
        SELECT id INTO v_unassigned_company_id
        FROM companies
        WHERE client_id = '__UNASSIGNED__';

        NEW.client_id := '__UNASSIGNED__';
        NEW.client_name := 'Unassigned';
        NEW.company_id := v_unassigned_company_id;
    ELSE
        -- Normal flow: upsert company and set company_id
        PERFORM upsert_company_from_project(NEW.client_id, NEW.client_name);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: Update the company_id setter to handle Unassigned
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_set_project_company_id()
RETURNS TRIGGER AS $$
DECLARE
    v_company_id UUID;
BEGIN
    IF NEW.client_id IS NOT NULL THEN
        SELECT id INTO v_company_id
        FROM companies
        WHERE client_id = NEW.client_id;

        NEW.company_id = v_company_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
DECLARE
    v_unassigned_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_unassigned_count
    FROM projects
    WHERE client_id = '__UNASSIGNED__';

    RAISE NOTICE '024 Create Unassigned Company migration complete:';
    RAISE NOTICE '  - Created "Unassigned" company';
    RAISE NOTICE '  - Assigned % projects to Unassigned company', v_unassigned_count;
    RAISE NOTICE '  - Updated triggers to handle NULL client_ids';
END $$;

COMMIT;
