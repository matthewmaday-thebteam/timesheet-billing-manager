-- ============================================================================
-- Migration 060: Fix auto-create trigger to also create resource_user_associations
-- ============================================================================
-- The auto_create_resource_on_timesheet_insert trigger (migration 007) creates
-- a resources record when a new user appears in timesheet data, but does NOT
-- create a corresponding resource_user_associations record. Without the
-- association, userIdToDisplayNameLookup cannot resolve the Clockify user_id
-- to the resource's first_name/last_name, so pages fall back to the raw
-- user_name from the timesheet entry.
--
-- This migration:
--   1. Updates the trigger to also insert into resource_user_associations
--   2. Backfills missing associations for any resources created after migration 014
-- ============================================================================

-- ============================================================================
-- STEP 1: Update the auto-create trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_create_resource_on_timesheet_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_default_employment_type_id UUID;
    v_resource_id UUID;
BEGIN
    -- Skip if user_id is NULL or empty
    IF NEW.user_id IS NULL OR NEW.user_id = '' THEN
        RETURN NEW;
    END IF;

    -- Get the default employment type (Full-time)
    SELECT id INTO v_default_employment_type_id
    FROM employment_types
    WHERE name = 'Full-time';

    -- Insert resource if it doesn't exist (using ON CONFLICT to handle races)
    INSERT INTO resources (user_id, external_label, employment_type_id)
    VALUES (NEW.user_id, COALESCE(NEW.user_name, 'Unknown User'), v_default_employment_type_id)
    ON CONFLICT DO NOTHING;

    -- Get the resource_id (whether just created or already existing)
    SELECT id INTO v_resource_id
    FROM resources
    WHERE user_id = NEW.user_id;

    -- Create association if it doesn't exist
    IF v_resource_id IS NOT NULL THEN
        INSERT INTO resource_user_associations (resource_id, user_id, source, user_name)
        VALUES (v_resource_id, NEW.user_id, 'clockify', COALESCE(NEW.user_name, 'Unknown User'))
        ON CONFLICT (user_id, source) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================================================
-- STEP 2: Backfill missing associations
-- ============================================================================
-- Find resources that have a user_id but no corresponding association record.

INSERT INTO resource_user_associations (resource_id, user_id, source, user_name)
SELECT
    r.id AS resource_id,
    r.user_id,
    'clockify' AS source,
    r.external_label AS user_name
FROM resources r
WHERE r.user_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM resource_user_associations rua
      WHERE rua.resource_id = r.id
        AND rua.user_id = r.user_id
  )
ON CONFLICT (user_id, source) DO NOTHING;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    v_backfilled INTEGER;
    v_total_resources INTEGER;
    v_total_associations INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_resources
    FROM resources WHERE user_id IS NOT NULL;

    SELECT COUNT(*) INTO v_total_associations
    FROM resource_user_associations;

    RAISE NOTICE 'Migration 060 Complete:';
    RAISE NOTICE '  - auto_create_resource_on_timesheet_insert() updated to create associations';
    RAISE NOTICE '  - Resources with user_id: %', v_total_resources;
    RAISE NOTICE '  - Total associations: %', v_total_associations;
    RAISE NOTICE '  - Missing associations backfilled';
END $$;
