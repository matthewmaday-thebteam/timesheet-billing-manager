-- Fix: recalculate_project_month() writes raw company_id from projects table.
-- Projects from different sync sources (Clockify vs ClickUp) have different
-- company_id values for the same canonical company, causing duplicate company
-- rows on the Revenue page.
--
-- Fix 1: Update existing project_monthly_summary rows to canonical company_id
-- Fix 2: Patch recalculate_project_month() to resolve canonical company

-- ============================================================================
-- STEP 1: Fix existing data — update company_id to canonical
-- ============================================================================

DO $$
DECLARE
    v_fixed INTEGER := 0;
BEGIN
    WITH canonical_fix AS (
        UPDATE project_monthly_summary pms
        SET company_id = vcc.canonical_company_id
        FROM v_company_canonical vcc
        WHERE vcc.company_id = pms.company_id
          AND vcc.canonical_company_id != pms.company_id
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_fixed FROM canonical_fix;

    RAISE NOTICE 'Fixed % project_monthly_summary rows with canonical company_id', v_fixed;
END $$;

-- ============================================================================
-- STEP 2: Patch recalculate_project_month() to resolve canonical company_id
-- ============================================================================
-- We cannot easily CREATE OR REPLACE the entire function just to change 1 line.
-- Instead, we create a helper function and a trigger-like wrapper.
--
-- Actually, the simplest approach: after the function runs and writes to
-- project_monthly_summary, a trigger can fix the company_id. But that's
-- complex. The cleanest fix is to add canonical company resolution inline.
--
-- Since the function is already large and has been replaced multiple times,
-- let's just add a post-write UPDATE inside the function by replacing it.
-- But that requires reproducing the entire function again.
--
-- SIMPLER APPROACH: Create a trigger on project_monthly_summary that
-- resolves company_id to canonical on INSERT or UPDATE.

CREATE OR REPLACE FUNCTION trg_fix_canonical_company_id()
RETURNS TRIGGER AS $$
DECLARE
    v_canonical UUID;
BEGIN
    -- Look up canonical company for the company_id being written
    SELECT vcc.canonical_company_id INTO v_canonical
    FROM v_company_canonical vcc
    WHERE vcc.company_id = NEW.company_id;

    IF v_canonical IS NOT NULL AND v_canonical != NEW.company_id THEN
        NEW.company_id := v_canonical;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that fires BEFORE INSERT OR UPDATE on project_monthly_summary
DROP TRIGGER IF EXISTS trg_canonical_company_on_summary ON project_monthly_summary;
CREATE TRIGGER trg_canonical_company_on_summary
    BEFORE INSERT OR UPDATE ON project_monthly_summary
    FOR EACH ROW
    EXECUTE FUNCTION trg_fix_canonical_company_id();

-- ============================================================================
-- STEP 3: Verify
-- ============================================================================

DO $$
DECLARE
    v_non_canonical INTEGER := 0;
BEGIN
    SELECT COUNT(*) INTO v_non_canonical
    FROM project_monthly_summary pms
    JOIN v_company_canonical vcc ON vcc.company_id = pms.company_id
    WHERE vcc.canonical_company_id != pms.company_id;

    RAISE NOTICE 'Migration 099 Complete:';
    RAISE NOTICE '  - Trigger trg_canonical_company_on_summary: CREATED';
    RAISE NOTICE '  - Non-canonical company_id rows remaining: %', v_non_canonical;

    IF v_non_canonical > 0 THEN
        RAISE WARNING 'Some rows still have non-canonical company_id!';
    END IF;
END $$;
