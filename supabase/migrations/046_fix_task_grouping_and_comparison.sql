-- ============================================================================
-- Migration 046: Fix Task Grouping + Add Comparison Function
-- Task: 033 - Frontend Billing Migration (Step 1)
-- ============================================================================
-- Purpose:
--   1. Fix recalculate_project_month() to GROUP BY task_name instead of task_id.
--      TypeScript groups entries by task_name in buildBillingInputs().
--      The SQL was grouping by task_id, which produces different per-task
--      rounding when multiple task_ids share the same task_name.
--
--   2. Add compare_summary_vs_recomputed() function for field-by-field
--      validation of summary table against a fresh recomputation.
--
-- Impact: After deploying, must re-run backfill to update existing summaries.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: FIX recalculate_project_month() - GROUP BY task_name
-- ============================================================================
-- Only STEP 3 (task-level rounding) and the task_count query change.
-- Everything else remains identical. Full CREATE OR REPLACE is required
-- because PL/pgSQL doesn't support partial function updates.

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
        NOW(), 'v1.1'
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
    'v1.1: Groups tasks by task_name (matching TypeScript) instead of task_id. '
    'Idempotent: running twice with same inputs produces identical output.';

-- ============================================================================
-- STEP 2: ADD compare_summary_vs_recomputed() FUNCTION
-- ============================================================================
-- This function recomputes billing from raw data (matching the TypeScript
-- pipeline) and compares field-by-field against project_monthly_summary.
-- Returns only rows with discrepancies.

CREATE OR REPLACE FUNCTION compare_summary_vs_recomputed(
    p_month DATE DEFAULT NULL
)
RETURNS TABLE (
    project_id UUID,
    project_name TEXT,
    summary_month DATE,

    -- Actual minutes
    summary_actual_minutes INTEGER,
    recomputed_actual_minutes INTEGER,
    diff_actual_minutes INTEGER,

    -- Rounded minutes
    summary_rounded_minutes INTEGER,
    recomputed_rounded_minutes INTEGER,
    diff_rounded_minutes INTEGER,

    -- Rounded hours
    summary_rounded_hours NUMERIC(10,2),
    recomputed_rounded_hours NUMERIC(10,2),
    diff_rounded_hours NUMERIC(10,2),

    -- Carryover in
    summary_carryover_in NUMERIC(10,2),
    recomputed_carryover_in NUMERIC(10,2),
    diff_carryover_in NUMERIC(10,2),

    -- Adjusted hours
    summary_adjusted_hours NUMERIC(10,2),
    recomputed_adjusted_hours NUMERIC(10,2),
    diff_adjusted_hours NUMERIC(10,2),

    -- Billed hours
    summary_billed_hours NUMERIC(10,2),
    recomputed_billed_hours NUMERIC(10,2),
    diff_billed_hours NUMERIC(10,2),

    -- Unbillable hours
    summary_unbillable_hours NUMERIC(10,2),
    recomputed_unbillable_hours NUMERIC(10,2),
    diff_unbillable_hours NUMERIC(10,2),

    -- Carryover out
    summary_carryover_out NUMERIC(10,2),
    recomputed_carryover_out NUMERIC(10,2),
    diff_carryover_out NUMERIC(10,2),

    -- Minimum padding
    summary_min_padding NUMERIC(10,2),
    recomputed_min_padding NUMERIC(10,2),
    diff_min_padding NUMERIC(10,2),

    -- Flags
    summary_min_applied BOOLEAN,
    recomputed_min_applied BOOLEAN,
    flag_min_applied_mismatch BOOLEAN,

    summary_max_applied BOOLEAN,
    recomputed_max_applied BOOLEAN,
    flag_max_applied_mismatch BOOLEAN,

    -- Rate
    summary_rate NUMERIC(10,2),
    recomputed_rate NUMERIC(10,2),
    diff_rate NUMERIC(10,2),

    -- Rounding
    summary_rounding INTEGER,
    recomputed_rounding INTEGER,
    diff_rounding INTEGER,

    -- Base revenue (cents)
    summary_base_rev_cents BIGINT,
    recomputed_base_rev_cents BIGINT,
    diff_base_rev_cents BIGINT,

    -- Billed revenue (cents)
    summary_billed_rev_cents BIGINT,
    recomputed_billed_rev_cents BIGINT,
    diff_billed_rev_cents BIGINT,

    -- Overall flag
    has_discrepancy BOOLEAN
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rec RECORD;
    -- Recomputed values
    r_actual_minutes INTEGER;
    r_rounded_minutes INTEGER;
    r_rounded_hours NUMERIC(10,2);
    r_carryover_in NUMERIC(10,2);
    r_adjusted_hours NUMERIC(10,2);
    r_billed_hours NUMERIC(10,2);
    r_unbillable_hours NUMERIC(10,2);
    r_carryover_out NUMERIC(10,2);
    r_min_padding NUMERIC(10,2);
    r_min_applied BOOLEAN;
    r_max_applied BOOLEAN;
    r_rate NUMERIC(10,2);
    r_rate_source TEXT;
    r_rounding INTEGER;
    r_base_rev_cents BIGINT;
    r_billed_rev_cents BIGINT;
    -- Config
    r_minimum_hours NUMERIC(10,2);
    r_maximum_hours NUMERIC(10,2);
    r_carryover_enabled BOOLEAN;
    r_is_active BOOLEAN;
    r_has_limits BOOLEAN;
    -- Canonical grouping
    r_project_ids UUID[];
BEGIN
    -- Loop over every summary row (optionally filtered to one month)
    FOR v_rec IN
        SELECT pms.*, p.project_name AS p_name
        FROM project_monthly_summary pms
        JOIN projects p ON p.id = pms.project_id
        WHERE (p_month IS NULL OR pms.summary_month = DATE_TRUNC('month', p_month)::DATE)
        ORDER BY pms.summary_month, p.project_name
    LOOP
        -- Build canonical project group
        SELECT ARRAY_AGG(sub.pid)
        INTO r_project_ids
        FROM (
            SELECT v_rec.project_id AS pid
            UNION
            SELECT pgm.member_project_id
            FROM project_groups pg
            JOIN project_group_members pgm ON pgm.group_id = pg.id
            WHERE pg.primary_project_id = v_rec.project_id
        ) sub;

        IF r_project_ids IS NULL THEN
            r_project_ids := ARRAY[v_rec.project_id];
        END IF;

        -- Get billing config
        SELECT r.effective_rate, r.source
        INTO r_rate, r_rate_source
        FROM get_effective_project_rate(v_rec.project_id, v_rec.summary_month) r;

        SELECT r.effective_rounding
        INTO r_rounding
        FROM get_effective_project_rounding(v_rec.project_id, v_rec.summary_month) r;

        SELECT l.minimum_hours, l.maximum_hours, COALESCE(l.carryover_enabled, false)
        INTO r_minimum_hours, r_maximum_hours, r_carryover_enabled
        FROM project_monthly_billing_limits l
        WHERE l.project_id = v_rec.project_id
            AND l.limits_month <= v_rec.summary_month
        ORDER BY l.limits_month DESC
        LIMIT 1;

        SELECT COALESCE(s.is_active, true)
        INTO r_is_active
        FROM project_monthly_active_status s
        WHERE s.project_id = v_rec.project_id
            AND s.status_month <= v_rec.summary_month
        ORDER BY s.status_month DESC
        LIMIT 1;

        r_is_active := COALESCE(r_is_active, true);
        r_rounding := COALESCE(r_rounding, get_default_rounding_increment());
        r_rate := COALESCE(r_rate, get_default_rate());
        r_carryover_enabled := COALESCE(r_carryover_enabled, false);

        -- Get carryover
        SELECT COALESCE(SUM(pch.carryover_hours), 0)
        INTO r_carryover_in
        FROM project_carryover_hours pch
        WHERE pch.project_id = v_rec.project_id
            AND pch.carryover_month = v_rec.summary_month;

        r_has_limits := (r_minimum_hours IS NOT NULL
                      OR r_maximum_hours IS NOT NULL
                      OR r_carryover_in > 0);

        -- Recompute task rounding (GROUP BY task_name — matching TypeScript)
        SELECT
            COALESCE(SUM(t.task_actual_minutes), 0),
            COALESCE(SUM(billing_apply_rounding(t.task_actual_minutes, r_rounding)), 0)
        INTO r_actual_minutes, r_rounded_minutes
        FROM (
            SELECT
                COALESCE(tdr.task_name, 'No Task') AS task_group,
                SUM(tdr.total_minutes)::INTEGER AS task_actual_minutes
            FROM timesheet_daily_rollups tdr
            JOIN projects p ON p.project_id = tdr.project_id
            WHERE p.id = ANY(r_project_ids)
                AND DATE_TRUNC('month', tdr.work_date)::DATE = v_rec.summary_month
                AND tdr.total_minutes > 0
            GROUP BY COALESCE(tdr.task_name, 'No Task')
        ) t;

        -- Calculate hours
        r_rounded_hours := billing_round_hours(r_rounded_minutes::NUMERIC / 60);
        r_adjusted_hours := billing_round_hours(r_rounded_hours + r_carryover_in);
        r_billed_hours := r_adjusted_hours;
        r_unbillable_hours := 0;
        r_carryover_out := 0;
        r_min_padding := 0;
        r_min_applied := false;
        r_max_applied := false;

        -- Apply MIN/MAX
        IF r_has_limits THEN
            IF r_is_active AND r_minimum_hours IS NOT NULL AND r_adjusted_hours < r_minimum_hours THEN
                r_min_padding := billing_round_hours(r_minimum_hours - r_adjusted_hours);
                r_billed_hours := r_minimum_hours;
                r_min_applied := true;
            END IF;

            IF r_maximum_hours IS NOT NULL AND r_billed_hours > r_maximum_hours THEN
                DECLARE
                    r_excess NUMERIC(10,2);
                BEGIN
                    r_excess := billing_round_hours(r_billed_hours - r_maximum_hours);
                    r_billed_hours := r_maximum_hours;
                    r_max_applied := true;

                    IF r_carryover_enabled THEN
                        r_carryover_out := r_excess;
                    ELSE
                        r_unbillable_hours := r_excess;
                    END IF;
                END;
            END IF;
        END IF;

        -- Calculate revenue
        r_base_rev_cents := ROUND(r_rounded_hours * r_rate * 100)::BIGINT;
        r_billed_rev_cents := ROUND(r_billed_hours * r_rate * 100)::BIGINT;

        -- Return row with comparison
        project_id := v_rec.project_id;
        project_name := v_rec.p_name;
        summary_month := v_rec.summary_month;

        summary_actual_minutes := v_rec.actual_minutes;
        recomputed_actual_minutes := r_actual_minutes;
        diff_actual_minutes := v_rec.actual_minutes - r_actual_minutes;

        summary_rounded_minutes := v_rec.rounded_minutes;
        recomputed_rounded_minutes := r_rounded_minutes;
        diff_rounded_minutes := v_rec.rounded_minutes - r_rounded_minutes;

        summary_rounded_hours := v_rec.rounded_hours;
        recomputed_rounded_hours := r_rounded_hours;
        diff_rounded_hours := v_rec.rounded_hours - r_rounded_hours;

        summary_carryover_in := v_rec.carryover_in_hours;
        recomputed_carryover_in := r_carryover_in;
        diff_carryover_in := v_rec.carryover_in_hours - r_carryover_in;

        summary_adjusted_hours := v_rec.adjusted_hours;
        recomputed_adjusted_hours := r_adjusted_hours;
        diff_adjusted_hours := v_rec.adjusted_hours - r_adjusted_hours;

        summary_billed_hours := v_rec.billed_hours;
        recomputed_billed_hours := r_billed_hours;
        diff_billed_hours := v_rec.billed_hours - r_billed_hours;

        summary_unbillable_hours := v_rec.unbillable_hours;
        recomputed_unbillable_hours := r_unbillable_hours;
        diff_unbillable_hours := v_rec.unbillable_hours - r_unbillable_hours;

        summary_carryover_out := v_rec.carryover_out_hours;
        recomputed_carryover_out := r_carryover_out;
        diff_carryover_out := v_rec.carryover_out_hours - r_carryover_out;

        summary_min_padding := v_rec.minimum_padding_hours;
        recomputed_min_padding := r_min_padding;
        diff_min_padding := v_rec.minimum_padding_hours - r_min_padding;

        summary_min_applied := v_rec.minimum_applied;
        recomputed_min_applied := r_min_applied;
        flag_min_applied_mismatch := v_rec.minimum_applied IS DISTINCT FROM r_min_applied;

        summary_max_applied := v_rec.maximum_applied;
        recomputed_max_applied := r_max_applied;
        flag_max_applied_mismatch := v_rec.maximum_applied IS DISTINCT FROM r_max_applied;

        summary_rate := v_rec.rate_used;
        recomputed_rate := r_rate;
        diff_rate := v_rec.rate_used - r_rate;

        summary_rounding := v_rec.rounding_used;
        recomputed_rounding := r_rounding;
        diff_rounding := v_rec.rounding_used - r_rounding;

        summary_base_rev_cents := v_rec.base_revenue_cents;
        recomputed_base_rev_cents := r_base_rev_cents;
        diff_base_rev_cents := v_rec.base_revenue_cents - r_base_rev_cents;

        summary_billed_rev_cents := v_rec.billed_revenue_cents;
        recomputed_billed_rev_cents := r_billed_rev_cents;
        diff_billed_rev_cents := v_rec.billed_revenue_cents - r_billed_rev_cents;

        -- Overall discrepancy flag
        has_discrepancy := (
            diff_actual_minutes != 0 OR
            diff_rounded_minutes != 0 OR
            diff_rounded_hours != 0 OR
            diff_carryover_in != 0 OR
            diff_adjusted_hours != 0 OR
            diff_billed_hours != 0 OR
            diff_unbillable_hours != 0 OR
            diff_carryover_out != 0 OR
            diff_min_padding != 0 OR
            flag_min_applied_mismatch OR
            flag_max_applied_mismatch OR
            diff_rate != 0 OR
            diff_rounding != 0 OR
            diff_base_rev_cents != 0 OR
            diff_billed_rev_cents != 0
        );

        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compare_summary_vs_recomputed(DATE) IS
    'Recomputes billing from raw data and compares field-by-field against '
    'project_monthly_summary. Returns all rows with a has_discrepancy flag. '
    'Pass NULL to check all months, or a specific date for one month.';

-- Grants
GRANT EXECUTE ON FUNCTION compare_summary_vs_recomputed(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION compare_summary_vs_recomputed(DATE) TO authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Migration 046 Complete:';
    RAISE NOTICE '  - recalculate_project_month() updated to GROUP BY task_name (v1.1)';
    RAISE NOTICE '  - compare_summary_vs_recomputed() function created';
    RAISE NOTICE '  - IMPORTANT: Re-run backfill to update existing summaries';
    RAISE NOTICE '    SELECT backfill_summaries(''2026-01-01'', ''2026-02-01'');';
END $$;

COMMIT;
