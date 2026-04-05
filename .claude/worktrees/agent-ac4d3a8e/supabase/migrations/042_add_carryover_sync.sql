-- Migration 042: Add carryover sync function
-- This migration adds the missing write function for project_carryover_hours.
-- Previously, carryover was calculated in-memory but never persisted to the
-- database, so the next month could never read it.

-- ============================================================================
-- STEP 1: CREATE SYNC FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_project_carryover(
    p_project_id UUID,
    p_source_month DATE,
    p_carryover_hours NUMERIC,
    p_actual_hours_worked NUMERIC,
    p_maximum_applied NUMERIC
)
RETURNS VOID AS $$
DECLARE
    v_source_month DATE := DATE_TRUNC('month', p_source_month)::DATE;
    v_carryover_month DATE := (v_source_month + INTERVAL '1 month')::DATE;
BEGIN
    IF p_carryover_hours > 0 THEN
        -- Upsert carryover into next month
        INSERT INTO project_carryover_hours (
            project_id,
            carryover_month,
            source_month,
            carryover_hours,
            actual_hours_worked,
            maximum_applied,
            calculated_at
        ) VALUES (
            p_project_id,
            v_carryover_month,
            v_source_month,
            p_carryover_hours,
            p_actual_hours_worked,
            p_maximum_applied,
            NOW()
        )
        ON CONFLICT (project_id, carryover_month, source_month)
        DO UPDATE SET
            carryover_hours = EXCLUDED.carryover_hours,
            actual_hours_worked = EXCLUDED.actual_hours_worked,
            maximum_applied = EXCLUDED.maximum_applied,
            calculated_at = NOW(),
            updated_at = NOW();
    ELSE
        -- Remove stale carryover if hours dropped to zero (e.g., time corrections)
        DELETE FROM project_carryover_hours
        WHERE project_id = p_project_id
          AND carryover_month = v_carryover_month
          AND source_month = v_source_month;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION sync_project_carryover(UUID, DATE, NUMERIC, NUMERIC, NUMERIC)
    IS 'Persists or clears carryover hours from a source month into the next month. Called by the frontend after billing calculation.';

-- ============================================================================
-- STEP 2: GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION sync_project_carryover(UUID, DATE, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

-- ============================================================================
-- STEP 3: VERIFICATION
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'sync_project_carryover'
    ) THEN
        RAISE NOTICE 'Migration 042 Complete: sync_project_carryover function created successfully';
    ELSE
        RAISE EXCEPTION 'Migration 042 Failed: sync_project_carryover function not found';
    END IF;
END $$;
