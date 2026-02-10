-- ============================================================================
-- Rollback: Migrations 044 + 045 + 046
-- Tasks: 032 - Monthly Billing Summary Table, 033 - Frontend Billing Migration
-- ============================================================================
-- Safely removes all objects created by migrations 044, 045, and 046.
-- This has ZERO impact on the existing application since no frontend
-- code reads from these tables/views yet.
--
-- Order: comparison function -> triggers -> views -> functions -> tables
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 0: DROP COMPARISON FUNCTION (from migration 046)
-- ============================================================================

DROP FUNCTION IF EXISTS compare_summary_vs_recomputed(DATE);

-- ============================================================================
-- STEP 1: DROP TRIGGERS (from migration 045)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_enqueue_recalc_on_sync ON timesheet_daily_rollups;
DROP TRIGGER IF EXISTS trg_enqueue_on_rate_change ON project_monthly_rates;
DROP TRIGGER IF EXISTS trg_enqueue_on_rounding_change ON project_monthly_rounding;
DROP TRIGGER IF EXISTS trg_enqueue_on_limits_change ON project_monthly_billing_limits;
DROP TRIGGER IF EXISTS trg_enqueue_on_active_status_change ON project_monthly_active_status;

-- ============================================================================
-- STEP 2: DROP TRIGGER FUNCTIONS (from migration 045)
-- ============================================================================

DROP FUNCTION IF EXISTS enqueue_affected_months();
DROP FUNCTION IF EXISTS enqueue_on_rate_change();
DROP FUNCTION IF EXISTS enqueue_on_rounding_change();
DROP FUNCTION IF EXISTS enqueue_on_limits_change();
DROP FUNCTION IF EXISTS enqueue_on_active_status_change();

-- ============================================================================
-- STEP 3: DROP VIEWS (from migration 044)
-- ============================================================================

DROP VIEW IF EXISTS v_carryover_chain;
DROP VIEW IF EXISTS v_monthly_summary_totals;
DROP VIEW IF EXISTS v_monthly_summary_by_company;

-- ============================================================================
-- STEP 4: DROP BATCH FUNCTIONS (from migration 044)
-- ============================================================================

DROP FUNCTION IF EXISTS backfill_summaries(DATE, DATE);
DROP FUNCTION IF EXISTS drain_recalculation_queue(INTEGER);
DROP FUNCTION IF EXISTS recalculate_month(DATE);

-- ============================================================================
-- STEP 5: DROP CORE RECALCULATION FUNCTION (from migration 044)
-- ============================================================================

DROP FUNCTION IF EXISTS recalculate_project_month(UUID, DATE);

-- ============================================================================
-- STEP 6: DROP UTILITY FUNCTIONS (from migration 044)
-- ============================================================================

DROP FUNCTION IF EXISTS billing_apply_rounding(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS billing_round_currency(NUMERIC);
DROP FUNCTION IF EXISTS billing_round_hours(NUMERIC);

-- ============================================================================
-- STEP 7: DROP TABLES (from migration 044)
-- ============================================================================

-- Drop updated_at trigger first
DROP TRIGGER IF EXISTS trg_pms_updated_at ON project_monthly_summary;

DROP TABLE IF EXISTS recalculation_queue;
DROP TABLE IF EXISTS project_monthly_summary;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_remaining INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_remaining
    FROM information_schema.tables
    WHERE table_name IN ('project_monthly_summary', 'recalculation_queue');

    IF v_remaining = 0 THEN
        RAISE NOTICE 'Rollback 044+045+046 Complete: all objects removed cleanly';
    ELSE
        RAISE EXCEPTION 'Rollback incomplete: % tables still exist', v_remaining;
    END IF;
END $$;

COMMIT;
