-- Migration 027: Fix Rounding Trigger and Constraints
-- 1. Add NOT NULL constraints to audit columns in project_monthly_rounding
-- 2. Update auto_create_project_from_rollup to also create default rounding records

-- ============================================================================
-- STEP 1: ADD NOT NULL CONSTRAINTS TO AUDIT COLUMNS
-- ============================================================================

-- First, ensure no NULL values exist (they shouldn't, but be safe)
UPDATE project_monthly_rounding
SET created_at = NOW()
WHERE created_at IS NULL;

UPDATE project_monthly_rounding
SET updated_at = NOW()
WHERE updated_at IS NULL;

-- Now add NOT NULL constraints
ALTER TABLE project_monthly_rounding
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL;

-- ============================================================================
-- STEP 2: UPDATE TRIGGER TO CREATE DEFAULT ROUNDING RECORDS
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_create_project_from_rollup()
RETURNS TRIGGER AS $$
DECLARE
    v_project_uuid UUID;
    v_work_month DATE;
    v_current_first_seen DATE;
    v_existing_rate NUMERIC;
    v_existing_rounding INTEGER;
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
        -- First detection: set first_seen_month and create rate + rounding records
        UPDATE projects
        SET first_seen_month = v_work_month
        WHERE id = v_project_uuid;

        -- Create default rate record
        INSERT INTO project_monthly_rates (project_id, rate_month, rate)
        VALUES (v_project_uuid, v_work_month, get_default_rate())
        ON CONFLICT (project_id, rate_month) DO NOTHING;

        -- Create default rounding record
        INSERT INTO project_monthly_rounding (project_id, rounding_month, rounding_increment)
        VALUES (v_project_uuid, v_work_month, get_default_rounding_increment())
        ON CONFLICT (project_id, rounding_month) DO NOTHING;

    ELSIF v_work_month < v_current_first_seen THEN
        -- Earlier month discovered: copy rate and rounding from current first_seen_month
        SELECT rate INTO v_existing_rate
        FROM project_monthly_rates
        WHERE project_id = v_project_uuid
          AND rate_month = v_current_first_seen;

        SELECT rounding_increment INTO v_existing_rounding
        FROM project_monthly_rounding
        WHERE project_id = v_project_uuid
          AND rounding_month = v_current_first_seen;

        -- Update first_seen_month to earlier month
        UPDATE projects
        SET first_seen_month = v_work_month
        WHERE id = v_project_uuid
          AND first_seen_month > v_work_month;

        -- Insert rate for earlier month (copy existing or use default)
        INSERT INTO project_monthly_rates (project_id, rate_month, rate)
        VALUES (v_project_uuid, v_work_month, COALESCE(v_existing_rate, get_default_rate()))
        ON CONFLICT (project_id, rate_month) DO NOTHING;

        -- Insert rounding for earlier month (copy existing or use default)
        INSERT INTO project_monthly_rounding (project_id, rounding_month, rounding_increment)
        VALUES (v_project_uuid, v_work_month, COALESCE(v_existing_rounding, get_default_rounding_increment()))
        ON CONFLICT (project_id, rounding_month) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_create_project_from_rollup() IS 'Auto-creates projects with initial rates and rounding when timesheet data is synced';

-- ============================================================================
-- STEP 3: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_not_null_count INTEGER;
BEGIN
    -- Verify NOT NULL constraints
    SELECT COUNT(*)
    INTO v_not_null_count
    FROM information_schema.columns
    WHERE table_name = 'project_monthly_rounding'
      AND column_name IN ('created_at', 'updated_at')
      AND is_nullable = 'NO';

    IF v_not_null_count = 2 THEN
        RAISE NOTICE 'Migration 027 Complete: NOT NULL constraints added to audit columns';
    ELSE
        RAISE WARNING 'Migration 027: NOT NULL constraints may not have been applied correctly';
    END IF;

    RAISE NOTICE 'Migration 027 Complete: Trigger updated to create default rounding records';
END $$;
