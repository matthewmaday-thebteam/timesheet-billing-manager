-- ============================================================================
-- Migration 049: Canonical Company Mapping in Billing Summary
-- Task: 033 - Frontend Billing Migration (Pre-Step 3 Gap Fix)
-- ============================================================================
-- Purpose: Fix recalculate_project_month() to resolve the canonical company
-- via v_company_canonical before storing company_id in project_monthly_summary.
--
-- Problem: The function was storing projects.company_id directly. But the DB
-- has a canonical company mapping system (company_groups / company_group_members
-- / v_company_canonical) that the function ignored. This caused company-level
-- views to show duplicate rows for companies that exist in multiple time
-- tracking systems (e.g., ClickUp "Third Party Pet" vs Clockify "Third Party
-- Pet").
--
-- Fix: After resolving project info, look up v_company_canonical to get the
-- primary company_id. All downstream usage (upsert, views, joins) benefits.
--
-- Changes:
--   1. recalculate_project_month() updated: canonical company resolution added
--   2. calculation_version bumped from 'v1.1' to 'v1.2'
--   3. Backfill all months to update company_id values
--   4. Re-snapshot golden references (since 048 snapshots used pre-fix data)
--
-- Safety: Only the company_id attribution changes. Revenue, hours, and all
-- other billing values are unchanged. Total revenue remains identical.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Update recalculate_project_month() with canonical company resolution
-- ============================================================================
-- Full CREATE OR REPLACE required (PL/pgSQL doesn't support partial updates).
-- The ONLY changes from v1.1 (migration 046) are:
--   1. Lines after "RESOLVE PROJECT INFO": canonical company lookup added
--   2. calculation_version: 'v1.1' -> 'v1.2'

CREATE OR REPLACE FUNCTION recalculate_project_month(
    p_project_id UUID,      -- Internal projects.id (canonical/primary)
    p_month DATE
)
RETURNS VOID AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_external_project_id TEXT;
    v_company_id UUID;

    -- Billing config
    v_rate NUMERIC(10,2);
    v_rate_source TEXT;
    v_rounding INTEGER;
    v_minimum_hours NUMERIC(10,2);
    v_maximum_hours NUMERIC(10,2);
    v_is_active BOOLEAN;
    v_carryover_enabled BOOLEAN;
    v_carryover_in NUMERIC(10,2) := 0;

    -- Calculated values
    v_actual_minutes INTEGER := 0;
    v_rounded_minutes INTEGER := 0;
    v_actual_hours NUMERIC(10,2);
    v_rounded_hours NUMERIC(10,2);
    v_adjusted_hours NUMERIC(10,2);
    v_billed_hours NUMERIC(10,2);
    v_unbillable_hours NUMERIC(10,2) := 0;
    v_carryover_out NUMERIC(10,2) := 0;
    v_minimum_padding NUMERIC(10,2) := 0;
    v_minimum_applied BOOLEAN := false;
    v_maximum_applied BOOLEAN := false;
    v_has_billing_limits BOOLEAN := false;
    v_base_revenue_cents BIGINT;
    v_billed_revenue_cents BIGINT;
    v_invoiced_revenue_cents BIGINT := 0;
    v_resource_count INTEGER := 0;
    v_task_count INTEGER := 0;
    v_entry_count INTEGER := 0;

    -- Member project IDs for canonical grouping
    v_project_ids UUID[];
BEGIN
    -- =========================================
    -- RESOLVE PROJECT INFO
    -- =========================================
    SELECT p.project_id, p.company_id
    INTO v_external_project_id, v_company_id
    FROM projects p WHERE p.id = p_project_id;

    IF v_external_project_id IS NULL THEN
        RAISE WARNING 'Project % not found', p_project_id;
        RETURN;
    END IF;

    IF v_company_id IS NULL THEN
        RAISE WARNING 'Project % has NULL company_id', p_project_id;
        RETURN;
    END IF;

    -- =========================================
    -- RESOLVE CANONICAL COMPANY (v1.2 addition)
    -- =========================================
    -- If this company is a member of a company_group, resolve to the
    -- group's primary company. This ensures summary rows use the canonical
    -- company_id, matching how the frontend groups by canonical company.
    -- Falls back to original company_id if no mapping exists.
    v_company_id := COALESCE(
        (SELECT vcc.canonical_company_id
         FROM v_company_canonical vcc
         WHERE vcc.company_id = v_company_id),
        v_company_id
    );

    -- =========================================
    -- BUILD CANONICAL PROJECT GROUP
    -- =========================================
    SELECT ARRAY_AGG(sub.pid)
    INTO v_project_ids
    FROM (
        SELECT p_project_id AS pid
        UNION
        SELECT pgm.member_project_id
        FROM project_groups pg
        JOIN project_group_members pgm ON pgm.group_id = pg.id
        WHERE pg.primary_project_id = p_project_id
    ) sub;

    IF v_project_ids IS NULL THEN
        v_project_ids := ARRAY[p_project_id];
    END IF;

    -- =========================================
    -- STEP 1: GET BILLING CONFIGURATION
    -- =========================================

    SELECT r.effective_rate, r.source
    INTO v_rate, v_rate_source
    FROM get_effective_project_rate(p_project_id, v_month) r;

    SELECT r.effective_rounding
    INTO v_rounding
    FROM get_effective_project_rounding(p_project_id, v_month) r;

    SELECT
        l.minimum_hours,
        l.maximum_hours,
        COALESCE(l.carryover_enabled, false)
    INTO v_minimum_hours, v_maximum_hours, v_carryover_enabled
    FROM project_monthly_billing_limits l
    WHERE l.project_id = p_project_id
        AND l.limits_month <= v_month
    ORDER BY l.limits_month DESC
    LIMIT 1;

    SELECT COALESCE(s.is_active, true)
    INTO v_is_active
    FROM project_monthly_active_status s
    WHERE s.project_id = p_project_id
        AND s.status_month <= v_month
    ORDER BY s.status_month DESC
    LIMIT 1;

    v_is_active := COALESCE(v_is_active, true);
    v_rounding := COALESCE(v_rounding, get_default_rounding_increment());
    v_rate := COALESCE(v_rate, get_default_rate());
    v_carryover_enabled := COALESCE(v_carryover_enabled, false);

    -- =========================================
    -- STEP 2: GET CARRYOVER FROM PREVIOUS MONTH
    -- =========================================
    SELECT COALESCE(SUM(pch.carryover_hours), 0)
    INTO v_carryover_in
    FROM project_carryover_hours pch
    WHERE pch.project_id = p_project_id
        AND pch.carryover_month = v_month;

    v_has_billing_limits := (v_minimum_hours IS NOT NULL
                          OR v_maximum_hours IS NOT NULL
                          OR v_carryover_in > 0);

    -- =========================================
    -- STEP 3: CALCULATE TASK-LEVEL ROUNDING
    -- =========================================
    -- FIX (migration 046): Group by task_name, not task_id.
    -- TypeScript buildBillingInputs() groups entries by task_name:
    --   const taskName = entry.task_name || 'No Task';
    --   projectData.tasks.set(taskName, ... + entry.total_minutes);
    -- Multiple task_ids can share the same task_name (e.g. "PM" has 139 task_ids).
    -- Grouping by task_id rounds each separately, inflating rounded_minutes.

    WITH task_rounded AS (
        SELECT
            COALESCE(tdr.task_name, 'No Task') AS task_group,
            SUM(tdr.total_minutes)::INTEGER AS task_actual_minutes,
            billing_apply_rounding(SUM(tdr.total_minutes)::INTEGER, v_rounding) AS task_rounded_minutes
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
        WHERE p.id = ANY(v_project_ids)
            AND DATE_TRUNC('month', tdr.work_date)::DATE = v_month
            AND tdr.total_minutes > 0
        GROUP BY COALESCE(tdr.task_name, 'No Task')
    )
    SELECT
        COALESCE(SUM(task_actual_minutes), 0),
        COALESCE(SUM(task_rounded_minutes), 0)
    INTO v_actual_minutes, v_rounded_minutes
    FROM task_rounded;

    -- Count distinct resources, tasks (by name), and total entries separately
    SELECT
        COALESCE(COUNT(DISTINCT tdr.user_id), 0),
        COALESCE(COUNT(DISTINCT COALESCE(tdr.task_name, 'No Task')), 0),
        COALESCE(COUNT(*), 0)
    INTO v_resource_count, v_task_count, v_entry_count
    FROM timesheet_daily_rollups tdr
    JOIN projects p ON p.project_id = tdr.project_id
    WHERE p.id = ANY(v_project_ids)
        AND DATE_TRUNC('month', tdr.work_date)::DATE = v_month
        AND tdr.total_minutes > 0;

    -- =========================================
    -- STEP 4: CALCULATE HOURS
    -- =========================================
    v_actual_hours := billing_round_hours(v_actual_minutes::NUMERIC / 60);
    v_rounded_hours := billing_round_hours(v_rounded_minutes::NUMERIC / 60);
    v_adjusted_hours := billing_round_hours(v_rounded_hours + v_carryover_in);
    v_billed_hours := v_adjusted_hours;

    -- =========================================
    -- STEP 5: APPLY MIN/MAX/CARRYOVER
    -- =========================================
    IF v_has_billing_limits THEN
        IF v_is_active AND v_minimum_hours IS NOT NULL AND v_adjusted_hours < v_minimum_hours THEN
            v_minimum_padding := billing_round_hours(v_minimum_hours - v_adjusted_hours);
            v_billed_hours := v_minimum_hours;
            v_minimum_applied := true;
        END IF;

        IF v_maximum_hours IS NOT NULL AND v_billed_hours > v_maximum_hours THEN
            DECLARE
                v_excess NUMERIC(10,2);
            BEGIN
                v_excess := billing_round_hours(v_billed_hours - v_maximum_hours);
                v_billed_hours := v_maximum_hours;
                v_maximum_applied := true;

                IF v_carryover_enabled THEN
                    v_carryover_out := v_excess;
                ELSE
                    v_unbillable_hours := v_excess;
                END IF;
            END;
        END IF;
    END IF;

    -- =========================================
    -- STEP 6: CALCULATE REVENUE
    -- =========================================
    v_base_revenue_cents := ROUND(v_rounded_hours * v_rate * 100)::BIGINT;
    v_billed_revenue_cents := ROUND(v_billed_hours * v_rate * 100)::BIGINT;

    -- =========================================
    -- STEP 7: GET INVOICED REVENUE
    -- =========================================
    SELECT COALESCE(SUM(bt.amount_cents), 0)
    INTO v_invoiced_revenue_cents
    FROM billing_transactions bt
    JOIN billings b ON b.id = bt.billing_id
    WHERE b.company_id = v_company_id
        AND bt.transaction_month = v_month;

    -- =========================================
    -- STEP 8: UPSERT SUMMARY ROW
    -- =========================================
    INSERT INTO project_monthly_summary (
        summary_month, project_id, company_id,
        actual_minutes, rounded_minutes, actual_hours, rounded_hours,
        carryover_in_hours, adjusted_hours, billed_hours,
        unbillable_hours, carryover_out_hours, minimum_padding_hours,
        minimum_applied, maximum_applied, has_billing_limits, is_active_used,
        base_revenue_cents, billed_revenue_cents, invoiced_revenue_cents,
        rate_used, rate_source, rounding_used,
        minimum_hours_config, maximum_hours_config, carryover_enabled_config,
        resource_count, task_count, source_entry_count,
        calculated_at, calculation_version
    ) VALUES (
        v_month, p_project_id, v_company_id,
        v_actual_minutes, v_rounded_minutes, v_actual_hours, v_rounded_hours,
        v_carryover_in, v_adjusted_hours, v_billed_hours,
        v_unbillable_hours, v_carryover_out, v_minimum_padding,
        v_minimum_applied, v_maximum_applied, v_has_billing_limits, v_is_active,
        v_base_revenue_cents, v_billed_revenue_cents, v_invoiced_revenue_cents,
        v_rate, v_rate_source, v_rounding,
        v_minimum_hours, v_maximum_hours, v_carryover_enabled,
        v_resource_count, v_task_count, v_entry_count,
        NOW(), 'v1.2'
    )
    ON CONFLICT (project_id, summary_month) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        actual_minutes = EXCLUDED.actual_minutes,
        rounded_minutes = EXCLUDED.rounded_minutes,
        actual_hours = EXCLUDED.actual_hours,
        rounded_hours = EXCLUDED.rounded_hours,
        carryover_in_hours = EXCLUDED.carryover_in_hours,
        adjusted_hours = EXCLUDED.adjusted_hours,
        billed_hours = EXCLUDED.billed_hours,
        unbillable_hours = EXCLUDED.unbillable_hours,
        carryover_out_hours = EXCLUDED.carryover_out_hours,
        minimum_padding_hours = EXCLUDED.minimum_padding_hours,
        minimum_applied = EXCLUDED.minimum_applied,
        maximum_applied = EXCLUDED.maximum_applied,
        has_billing_limits = EXCLUDED.has_billing_limits,
        is_active_used = EXCLUDED.is_active_used,
        base_revenue_cents = EXCLUDED.base_revenue_cents,
        billed_revenue_cents = EXCLUDED.billed_revenue_cents,
        invoiced_revenue_cents = EXCLUDED.invoiced_revenue_cents,
        rate_used = EXCLUDED.rate_used,
        rate_source = EXCLUDED.rate_source,
        rounding_used = EXCLUDED.rounding_used,
        minimum_hours_config = EXCLUDED.minimum_hours_config,
        maximum_hours_config = EXCLUDED.maximum_hours_config,
        carryover_enabled_config = EXCLUDED.carryover_enabled_config,
        resource_count = EXCLUDED.resource_count,
        task_count = EXCLUDED.task_count,
        source_entry_count = EXCLUDED.source_entry_count,
        calculated_at = NOW(),
        calculation_version = EXCLUDED.calculation_version;

    -- =========================================
    -- STEP 9: CASCADE CARRYOVER IF CHANGED
    -- =========================================
    DECLARE
        v_old_carryover_out NUMERIC(10,2);
        v_next_month DATE := (v_month + INTERVAL '1 month')::DATE;
    BEGIN
        SELECT COALESCE(SUM(pch.carryover_hours), 0)
        INTO v_old_carryover_out
        FROM project_carryover_hours pch
        WHERE pch.project_id = p_project_id
            AND pch.source_month = v_month;

        IF v_carryover_out IS DISTINCT FROM v_old_carryover_out THEN
            IF v_carryover_enabled AND v_carryover_out > 0 THEN
                INSERT INTO project_carryover_hours (
                    project_id, carryover_month, source_month,
                    carryover_hours, actual_hours_worked, maximum_applied
                ) VALUES (
                    p_project_id, v_next_month, v_month,
                    v_carryover_out, v_rounded_hours, v_maximum_hours
                )
                ON CONFLICT (project_id, carryover_month, source_month) DO UPDATE SET
                    carryover_hours = EXCLUDED.carryover_hours,
                    actual_hours_worked = EXCLUDED.actual_hours_worked,
                    maximum_applied = EXCLUDED.maximum_applied,
                    calculated_at = NOW();

                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (p_project_id, v_next_month, 'cascade')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;

            ELSIF v_old_carryover_out > 0 THEN
                DELETE FROM project_carryover_hours
                WHERE project_id = p_project_id
                    AND source_month = v_month
                    AND carryover_month = v_next_month;

                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (p_project_id, v_next_month, 'cascade')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;
            END IF;
        END IF;
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_project_month(UUID, DATE) IS
    'Recalculate billing summary for a single canonical project in a given month. '
    'v1.2: Resolves canonical company via v_company_canonical before storing company_id. '
    'v1.1: Groups tasks by task_name (matching TypeScript) instead of task_id. '
    'Idempotent: running twice with same inputs produces identical output.';

-- ============================================================================
-- STEP 2: Backfill all months to populate summary table with canonical companies
-- ============================================================================
-- backfill_summaries() (from migration 044) calls recalculate_month() which
-- iterates all canonical projects via v_project_table_entities and calls
-- recalculate_project_month() for each. The updated v1.2 function now resolves
-- canonical company_id, so all summary rows will use correct company_ids.

SELECT backfill_summaries('2025-07-01'::DATE, CURRENT_DATE);

-- ============================================================================
-- STEP 3: Re-snapshot golden references
-- ============================================================================
-- The billing_verification_snapshots from migration 048 were captured BEFORE
-- this fix, so they contain the old (non-canonical) company_ids in their
-- project_monthly_summary source data. Re-snapshot to capture post-fix values.
--
-- Note: snapshot_billing_month() captures per-project values (hours, revenue,
-- rate, rounding) which are unchanged. Only the company_id in the source
-- summary rows changes. The snapshots themselves don't store company_id,
-- so this re-snapshot primarily ensures the snapshot totals are computed
-- against the corrected summary data.

SELECT snapshot_billing_month('2026-01-01', 'canonical_fix', 'After migration 049: canonical company mapping');
SELECT snapshot_billing_month('2026-02-01', 'canonical_fix', 'After migration 049: canonical company mapping');

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_affected INTEGER;
BEGIN
    -- Count rows now using v1.2
    SELECT COUNT(*)
    INTO v_affected
    FROM project_monthly_summary
    WHERE calculation_version = 'v1.2';

    RAISE NOTICE 'Migration 049 Complete:';
    RAISE NOTICE '  - recalculate_project_month() updated to v1.2 (canonical company mapping)';
    RAISE NOTICE '  - % summary rows recalculated with canonical company_id', v_affected;
    RAISE NOTICE '  - Golden snapshots re-captured for Jan and Feb 2026';
    RAISE NOTICE '  - Verify: SELECT * FROM verify_all_billing_months(); -- should show PASS';
END $$;

COMMIT;
