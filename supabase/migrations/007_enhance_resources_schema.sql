-- ============================================================================
-- 007: Enhance Resources Table Schema
-- - Add user_id column for Clockify user ID
-- - Convert employment_type from ENUM to lookup table with UUID FK
-- - Create auto-insert trigger on timesheet_daily_rollups
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create employment_types lookup table
-- ============================================================================

CREATE TABLE IF NOT EXISTS employment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert the two employment types
INSERT INTO employment_types (name) VALUES ('Full-time'), ('Part-time')
ON CONFLICT (name) DO NOTHING;

-- Enable RLS on employment_types
ALTER TABLE employment_types ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read employment types
CREATE POLICY "Allow authenticated read employment_types"
    ON employment_types FOR SELECT
    TO authenticated
    USING (true);

-- Allow anonymous users to read employment types
CREATE POLICY "Allow anon read employment_types"
    ON employment_types FOR SELECT
    TO anon
    USING (true);

-- ============================================================================
-- STEP 2: Add user_id column to resources (initially nullable for migration)
-- ============================================================================

ALTER TABLE resources ADD COLUMN IF NOT EXISTS user_id TEXT;

-- ============================================================================
-- STEP 3: Backfill user_id from timesheet_daily_rollups
-- Match on external_label = user_name
-- ============================================================================

UPDATE resources r
SET user_id = tdr.user_id
FROM (
    SELECT DISTINCT user_name, user_id
    FROM timesheet_daily_rollups
    WHERE user_id IS NOT NULL AND user_id != ''
) tdr
WHERE r.external_label = tdr.user_name
  AND r.user_id IS NULL;

-- ============================================================================
-- STEP 4: Add employment_type_id column (FK to employment_types)
-- ============================================================================

ALTER TABLE resources ADD COLUMN IF NOT EXISTS employment_type_id UUID;

-- ============================================================================
-- STEP 5: Backfill employment_type_id from current employment_type enum
-- ============================================================================

UPDATE resources r
SET employment_type_id = et.id
FROM employment_types et
WHERE (r.employment_type::TEXT = 'full-time' AND et.name = 'Full-time')
   OR (r.employment_type::TEXT = 'part-time' AND et.name = 'Part-time');

-- Handle any NULL employment_type by defaulting to Full-time
UPDATE resources r
SET employment_type_id = (SELECT id FROM employment_types WHERE name = 'Full-time')
WHERE r.employment_type_id IS NULL;

-- ============================================================================
-- STEP 6: Add constraints and make columns NOT NULL
-- ============================================================================

-- Make employment_type_id NOT NULL and add FK constraint
ALTER TABLE resources
    ALTER COLUMN employment_type_id SET NOT NULL,
    ADD CONSTRAINT fk_resources_employment_type
        FOREIGN KEY (employment_type_id) REFERENCES employment_types(id);

-- Create unique index on user_id (partial - only where NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_user_id_unique
    ON resources (user_id)
    WHERE user_id IS NOT NULL;

-- ============================================================================
-- STEP 7: Drop old employment_type enum column
-- ============================================================================

ALTER TABLE resources DROP COLUMN IF EXISTS employment_type;

-- Drop the old enum type (if no other tables use it)
DROP TYPE IF EXISTS employment_type;

-- ============================================================================
-- STEP 8: Create index on employment_type_id for filtering
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_resources_employment_type_id
    ON resources(employment_type_id);

-- Drop old index on the dropped column
DROP INDEX IF EXISTS idx_resources_employment_type;

-- ============================================================================
-- STEP 9: Update upsert_resource_from_clockify function
-- Now takes both user_id and user_name
-- ============================================================================

DROP FUNCTION IF EXISTS upsert_resource_from_clockify(TEXT);

CREATE OR REPLACE FUNCTION upsert_resource_from_clockify(
    p_user_id TEXT,
    p_user_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_resource_id UUID;
    v_default_employment_type_id UUID;
BEGIN
    -- Get the default employment type (Full-time)
    SELECT id INTO v_default_employment_type_id
    FROM employment_types
    WHERE name = 'Full-time';

    -- Try to find existing resource by user_id first, then by external_label
    SELECT id INTO v_resource_id
    FROM resources
    WHERE user_id = p_user_id
       OR (user_id IS NULL AND external_label = p_user_name);

    -- If found by external_label but missing user_id, update it
    IF v_resource_id IS NOT NULL THEN
        UPDATE resources
        SET user_id = p_user_id,
            updated_at = NOW()
        WHERE id = v_resource_id
          AND user_id IS NULL;
        RETURN v_resource_id;
    END IF;

    -- If not found, create new resource with defaults
    INSERT INTO resources (user_id, external_label, employment_type_id)
    VALUES (p_user_id, p_user_name, v_default_employment_type_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_resource_id;

    -- If insert failed due to conflict, fetch the existing one
    IF v_resource_id IS NULL THEN
        SELECT id INTO v_resource_id FROM resources WHERE user_id = p_user_id;
    END IF;

    RETURN v_resource_id;
END;
$$;

-- ============================================================================
-- STEP 10: Update sync_resources_from_clockify function
-- ============================================================================

DROP FUNCTION IF EXISTS sync_resources_from_clockify(TEXT[]);

CREATE OR REPLACE FUNCTION sync_resources_from_clockify(
    p_user_ids TEXT[],
    p_user_names TEXT[]
)
RETURNS TABLE (
    user_id TEXT,
    external_label TEXT,
    resource_id UUID,
    is_new BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_default_employment_type_id UUID;
BEGIN
    -- Get the default employment type (Full-time)
    SELECT id INTO v_default_employment_type_id
    FROM employment_types
    WHERE name = 'Full-time';

    RETURN QUERY
    WITH input_data AS (
        SELECT
            unnest(p_user_ids) AS input_user_id,
            unnest(p_user_names) AS input_user_name
    ),
    existing AS (
        SELECT
            i.input_user_id,
            r.external_label,
            r.id,
            FALSE AS is_new
        FROM input_data i
        JOIN resources r ON r.user_id = i.input_user_id
    ),
    to_insert AS (
        SELECT input_user_id, input_user_name
        FROM input_data i
        WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.input_user_id = i.input_user_id)
    ),
    inserted AS (
        INSERT INTO resources (user_id, external_label, employment_type_id)
        SELECT input_user_id, input_user_name, v_default_employment_type_id
        FROM to_insert
        ON CONFLICT DO NOTHING
        RETURNING resources.user_id, resources.external_label, resources.id, TRUE AS is_new
    )
    SELECT e.input_user_id, e.external_label, e.id, e.is_new FROM existing e
    UNION ALL
    SELECT ins.user_id, ins.external_label, ins.id, ins.is_new FROM inserted ins;
END;
$$;

-- ============================================================================
-- STEP 11: Create trigger for auto-creating resources on timesheet insert
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_create_resource_on_timesheet_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_default_employment_type_id UUID;
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

    RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_auto_create_resource ON timesheet_daily_rollups;
CREATE TRIGGER trg_auto_create_resource
    AFTER INSERT ON timesheet_daily_rollups
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_resource_on_timesheet_insert();

-- ============================================================================
-- STEP 12: Grant permissions
-- ============================================================================

GRANT SELECT ON employment_types TO authenticated;
GRANT SELECT ON employment_types TO anon;
GRANT ALL ON employment_types TO service_role;

-- Update function permissions
GRANT EXECUTE ON FUNCTION upsert_resource_from_clockify(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION sync_resources_from_clockify(TEXT[], TEXT[]) TO service_role;

-- ============================================================================
-- Report migration results
-- ============================================================================

DO $$
DECLARE
    v_resources_count INTEGER;
    v_resources_with_user_id INTEGER;
    v_resources_without_user_id INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_resources_count FROM resources;
    SELECT COUNT(*) INTO v_resources_with_user_id FROM resources WHERE user_id IS NOT NULL;
    SELECT COUNT(*) INTO v_resources_without_user_id FROM resources WHERE user_id IS NULL;

    RAISE NOTICE '007 migration complete:';
    RAISE NOTICE '  - Total resources: %', v_resources_count;
    RAISE NOTICE '  - Resources with user_id: %', v_resources_with_user_id;
    RAISE NOTICE '  - Resources without user_id (need manual backfill): %', v_resources_without_user_id;
    RAISE NOTICE '  - employment_types lookup table created';
    RAISE NOTICE '  - Auto-create trigger installed on timesheet_daily_rollups';
END $$;

COMMIT;
