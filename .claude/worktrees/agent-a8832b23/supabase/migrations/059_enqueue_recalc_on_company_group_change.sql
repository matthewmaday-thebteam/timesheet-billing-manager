-- ============================================================================
-- Migration 059: Enqueue recalculation on company group changes
-- ============================================================================
-- When a company is added to or removed from a company group, all projects
-- belonging to that member company need their billing summaries recalculated.
-- The recalculate_project_month() function resolves canonical company via
-- v_company_canonical (migration 049), so re-running it after a group change
-- updates the company_id stored in project_monthly_summary.
--
-- Pattern: Same as triggers in migration 045 (rate/rounding/limits changes).
-- The trigger enqueues work; drain_recalculation_queue() does the actual
-- recalculation (called by n8n or frontend).
-- ============================================================================

-- ============================================================================
-- STEP 1: Trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_on_company_group_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_company_id UUID;
    v_project RECORD;
BEGIN
    -- Determine which member company was affected
    IF TG_OP = 'DELETE' THEN
        v_member_company_id := OLD.member_company_id;
    ELSE
        v_member_company_id := NEW.member_company_id;
    END IF;

    -- Find all projects belonging to this member company and enqueue
    -- recalculation for every month that has summary data for them
    FOR v_project IN
        SELECT p.id AS project_id, pms.summary_month
        FROM projects p
        JOIN project_monthly_summary pms ON pms.project_id = p.id
        WHERE p.company_id = v_member_company_id
    LOOP
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (v_project.project_id, v_project.summary_month, 'company_group_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_on_company_group_change() IS
    'Enqueue recalculation for all projects of a member company when company '
    'group membership changes. Ensures billing summaries use the correct '
    'canonical company_id.';

-- ============================================================================
-- STEP 2: Create trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trg_enqueue_on_company_group_change ON company_group_members;
CREATE TRIGGER trg_enqueue_on_company_group_change
    AFTER INSERT OR DELETE ON company_group_members
    FOR EACH ROW EXECUTE FUNCTION enqueue_on_company_group_change();

-- ============================================================================
-- STEP 3: Grants
-- ============================================================================

GRANT EXECUTE ON FUNCTION enqueue_on_company_group_change() TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_on_company_group_change() TO authenticated;

-- ============================================================================
-- STEP 4: Backfill - recalculate all months to fix existing stale data
-- ============================================================================

SELECT backfill_summaries('2025-07-01'::DATE, CURRENT_DATE);

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    v_trigger_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.triggers
        WHERE trigger_name = 'trg_enqueue_on_company_group_change'
    ) INTO v_trigger_exists;

    RAISE NOTICE 'Migration 059 Complete:';
    RAISE NOTICE '  - Trigger deployed: %', v_trigger_exists;
    RAISE NOTICE '  - enqueue_on_company_group_change() fires on INSERT/DELETE of company_group_members';
    RAISE NOTICE '  - Enqueues all projects of affected member company for recalculation';
    RAISE NOTICE '  - Backfill run to fix existing stale company_id values';
END $$;
