-- ============================================================================
-- Migration 045: Enable Summary Triggers (Phase 3)
-- Task: 032 - Monthly Billing Summary Table (Database-Only)
-- ============================================================================
-- Purpose: Deploy triggers that automatically enqueue recalculation when
-- data changes. This migration should be applied AFTER backfill and
-- validation (Phase 2) are complete.
--
-- Triggers:
--   1. STATEMENT-level trigger on timesheet_daily_rollups (enqueue on sync)
--   2. ROW-level triggers on billing config tables (enqueue on config change)
--
-- NOTE: These triggers only ENQUEUE work into recalculation_queue.
-- The actual recalculation is performed by drain_recalculation_queue(),
-- called by n8n after sync or manually.
--
-- IMPORTANT: Config-change trigger functions use SECURITY DEFINER because
-- they fire as the authenticated user but need to INSERT into
-- recalculation_queue (which only has SELECT RLS for authenticated).
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: TRIGGER ON timesheet_daily_rollups (Primary - fires on sync)
-- ============================================================================
-- STATEMENT-level trigger with transition tables: fires once per INSERT batch,
-- not per row. Uses the NEW TABLE (new_rows) to find affected (project, month)
-- pairs and enqueue them for recalculation.
--
-- NOTE: Only fires on INSERT. The sync pattern is DELETE+INSERT, not UPDATE.

CREATE OR REPLACE FUNCTION enqueue_affected_months()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO recalculation_queue (project_id, queue_month, reason)
    SELECT DISTINCT
        p.id,
        DATE_TRUNC('month', n.work_date)::DATE,
        'sync'
    FROM new_rows n
    JOIN projects p ON p.project_id = n.project_id
    WHERE n.work_date IS NOT NULL
        AND n.total_minutes > 0
    ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
    DO NOTHING;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_affected_months() IS
    'STATEMENT-level trigger function: enqueues affected (project, month) pairs '
    'into recalculation_queue when new timesheet data is synced.';

DROP TRIGGER IF EXISTS trg_enqueue_recalc_on_sync ON timesheet_daily_rollups;
CREATE TRIGGER trg_enqueue_recalc_on_sync
    AFTER INSERT ON timesheet_daily_rollups
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION enqueue_affected_months();

-- ============================================================================
-- STEP 2: TRIGGER ON project_monthly_rates (enqueue on rate change)
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_on_rate_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (OLD.project_id, OLD.rate_month, 'rate_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN OLD;
    ELSE
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (NEW.project_id, NEW.rate_month, 'rate_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_on_rate_change() IS
    'Enqueue recalculation when a project rate is inserted, updated, or deleted.';

DROP TRIGGER IF EXISTS trg_enqueue_on_rate_change ON project_monthly_rates;
CREATE TRIGGER trg_enqueue_on_rate_change
    AFTER INSERT OR UPDATE OR DELETE ON project_monthly_rates
    FOR EACH ROW EXECUTE FUNCTION enqueue_on_rate_change();

-- ============================================================================
-- STEP 3: TRIGGER ON project_monthly_rounding (enqueue on rounding change)
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_on_rounding_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (OLD.project_id, OLD.rounding_month, 'rounding_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN OLD;
    ELSE
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (NEW.project_id, NEW.rounding_month, 'rounding_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_on_rounding_change() IS
    'Enqueue recalculation when a project rounding increment is inserted, updated, or deleted.';

DROP TRIGGER IF EXISTS trg_enqueue_on_rounding_change ON project_monthly_rounding;
CREATE TRIGGER trg_enqueue_on_rounding_change
    AFTER INSERT OR UPDATE OR DELETE ON project_monthly_rounding
    FOR EACH ROW EXECUTE FUNCTION enqueue_on_rounding_change();

-- ============================================================================
-- STEP 4: TRIGGER ON project_monthly_billing_limits (enqueue on limit change)
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_on_limits_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (OLD.project_id, OLD.limits_month, 'limits_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN OLD;
    ELSE
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (NEW.project_id, NEW.limits_month, 'limits_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_on_limits_change() IS
    'Enqueue recalculation when project billing limits are inserted, updated, or deleted.';

DROP TRIGGER IF EXISTS trg_enqueue_on_limits_change ON project_monthly_billing_limits;
CREATE TRIGGER trg_enqueue_on_limits_change
    AFTER INSERT OR UPDATE OR DELETE ON project_monthly_billing_limits
    FOR EACH ROW EXECUTE FUNCTION enqueue_on_limits_change();

-- ============================================================================
-- STEP 5: TRIGGER ON project_monthly_active_status (enqueue on status change)
-- ============================================================================

CREATE OR REPLACE FUNCTION enqueue_on_active_status_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (OLD.project_id, OLD.status_month, 'status_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN OLD;
    ELSE
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        VALUES (NEW.project_id, NEW.status_month, 'status_change')
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_on_active_status_change() IS
    'Enqueue recalculation when project active status is inserted, updated, or deleted.';

DROP TRIGGER IF EXISTS trg_enqueue_on_active_status_change ON project_monthly_active_status;
CREATE TRIGGER trg_enqueue_on_active_status_change
    AFTER INSERT OR UPDATE OR DELETE ON project_monthly_active_status
    FOR EACH ROW EXECUTE FUNCTION enqueue_on_active_status_change();

-- ============================================================================
-- STEP 6: GRANTS
-- ============================================================================

-- SECURITY DEFINER functions run as the function owner (typically postgres/supabase_admin),
-- so EXECUTE grants control who can CALL these functions, not what they can do inside.
-- Trigger functions are invoked automatically by the trigger, not called directly.

GRANT EXECUTE ON FUNCTION enqueue_affected_months() TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_on_rate_change() TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_on_rounding_change() TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_on_limits_change() TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_on_active_status_change() TO service_role;

GRANT EXECUTE ON FUNCTION enqueue_on_rate_change() TO authenticated;
GRANT EXECUTE ON FUNCTION enqueue_on_rounding_change() TO authenticated;
GRANT EXECUTE ON FUNCTION enqueue_on_limits_change() TO authenticated;
GRANT EXECUTE ON FUNCTION enqueue_on_active_status_change() TO authenticated;

-- ============================================================================
-- STEP 7: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_trigger_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_trigger_count
    FROM information_schema.triggers
    WHERE trigger_name IN (
        'trg_enqueue_recalc_on_sync',
        'trg_enqueue_on_rate_change',
        'trg_enqueue_on_rounding_change',
        'trg_enqueue_on_limits_change',
        'trg_enqueue_on_active_status_change'
    );

    RAISE NOTICE 'Migration 045 Complete:';
    RAISE NOTICE '  - % triggers deployed', v_trigger_count;
    RAISE NOTICE '  - trg_enqueue_recalc_on_sync on timesheet_daily_rollups (STATEMENT-level, INSERT only)';
    RAISE NOTICE '  - trg_enqueue_on_rate_change on project_monthly_rates (INSERT/UPDATE/DELETE)';
    RAISE NOTICE '  - trg_enqueue_on_rounding_change on project_monthly_rounding (INSERT/UPDATE/DELETE)';
    RAISE NOTICE '  - trg_enqueue_on_limits_change on project_monthly_billing_limits (INSERT/UPDATE/DELETE)';
    RAISE NOTICE '  - trg_enqueue_on_active_status_change on project_monthly_active_status (INSERT/UPDATE/DELETE)';
    RAISE NOTICE '  - All config-change functions use SECURITY DEFINER for RLS bypass';
    RAISE NOTICE '  - Triggers enqueue work only; drain_recalculation_queue() does the actual recalculation';
END $$;

COMMIT;
