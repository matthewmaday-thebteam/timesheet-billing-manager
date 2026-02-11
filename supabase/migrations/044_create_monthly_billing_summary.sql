-- ============================================================================
-- Migration 044: Create Monthly Billing Summary (Phase 1)
-- Task: 032 - Monthly Billing Summary Table (Database-Only)
-- ============================================================================
-- Purpose: Create a project_monthly_summary table that stores pre-calculated
-- billing results at the project-month level. The database becomes the single
-- source of truth for billing calculations.
--
-- This migration deploys:
--   1. project_monthly_summary table
--   2. recalculation_queue table
--   3. Billing precision utility functions
--   4. Core recalculation function (recalculate_project_month)
--   5. Batch functions (recalculate_month, drain_recalculation_queue, backfill_summaries)
--   6. Aggregate views (v_monthly_summary_by_company, v_monthly_summary_totals)
--   7. Indexes, RLS policies, and grants
--
-- NOTE: Triggers are deployed separately in migration 045 (Phase 3).
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE project_monthly_summary TABLE
-- ============================================================================

CREATE TABLE project_monthly_summary (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    summary_month               DATE NOT NULL,                      -- Normalized to 1st of month
    project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    company_id                  UUID NOT NULL REFERENCES companies(id),

    -- Hours (from billing engine)
    actual_minutes              INTEGER NOT NULL DEFAULT 0,         -- Raw SUM(total_minutes)
    rounded_minutes             INTEGER NOT NULL DEFAULT 0,         -- After per-task CEIL rounding
    actual_hours                NUMERIC(10,2) NOT NULL DEFAULT 0,   -- actual_minutes / 60
    rounded_hours               NUMERIC(10,2) NOT NULL DEFAULT 0,   -- rounded_minutes / 60
    carryover_in_hours          NUMERIC(10,2) NOT NULL DEFAULT 0,   -- From previous month
    adjusted_hours              NUMERIC(10,2) NOT NULL DEFAULT 0,   -- rounded_hours + carryover_in
    billed_hours                NUMERIC(10,2) NOT NULL DEFAULT 0,   -- After MIN/MAX applied
    unbillable_hours            NUMERIC(10,2) NOT NULL DEFAULT 0,   -- Lost to MAX (no carryover)
    carryover_out_hours         NUMERIC(10,2) NOT NULL DEFAULT 0,   -- Excess -> next month
    minimum_padding_hours       NUMERIC(10,2) NOT NULL DEFAULT 0,   -- Hours added due to MIN

    -- Flags
    minimum_applied             BOOLEAN NOT NULL DEFAULT false,
    maximum_applied             BOOLEAN NOT NULL DEFAULT false,
    has_billing_limits          BOOLEAN NOT NULL DEFAULT false,
    is_active_used              BOOLEAN NOT NULL DEFAULT true,

    -- Revenue (stored as cents - BIGINT)
    base_revenue_cents          BIGINT NOT NULL DEFAULT 0,          -- rounded_hours * rate * 100
    billed_revenue_cents        BIGINT NOT NULL DEFAULT 0,          -- billed_hours * rate * 100
    invoiced_revenue_cents      BIGINT NOT NULL DEFAULT 0,          -- From billing_transactions

    -- Config snapshot (what was in effect when calculated)
    rate_used                   NUMERIC(10,2) NOT NULL,             -- Effective hourly rate
    rate_source                 TEXT NOT NULL DEFAULT 'default',    -- explicit|inherited|backfill|default
    rounding_used               INTEGER NOT NULL DEFAULT 15,        -- 0|5|15|30
    minimum_hours_config        NUMERIC(10,2),                      -- NULL = no minimum
    maximum_hours_config        NUMERIC(10,2),                      -- NULL = no cap
    carryover_enabled_config    BOOLEAN NOT NULL DEFAULT false,

    -- Aggregate metadata
    resource_count              INTEGER NOT NULL DEFAULT 0,         -- Distinct user_ids with entries
    task_count                  INTEGER NOT NULL DEFAULT 0,         -- Distinct task entries
    source_entry_count          INTEGER NOT NULL DEFAULT 0,         -- Total rollup rows contributing

    -- Audit
    calculated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    calculation_version         TEXT NOT NULL DEFAULT 'v1.0',       -- Track engine changes
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_month_summary UNIQUE (project_id, summary_month),
    CONSTRAINT chk_summary_month_first CHECK (EXTRACT(DAY FROM summary_month) = 1),
    CONSTRAINT chk_base_revenue_non_negative CHECK (base_revenue_cents >= 0),
    CONSTRAINT chk_billed_revenue_non_negative CHECK (billed_revenue_cents >= 0),
    CONSTRAINT chk_hours_non_negative CHECK (billed_hours >= 0)
);

COMMENT ON TABLE project_monthly_summary IS 'Pre-calculated billing results at project-month granularity. Single source of truth for billing calculations.';
COMMENT ON COLUMN project_monthly_summary.summary_month IS 'Always first day of month (e.g., 2026-01-01)';
COMMENT ON COLUMN project_monthly_summary.rate_used IS 'The effective hourly rate used during this calculation';
COMMENT ON COLUMN project_monthly_summary.calculation_version IS 'Version of the billing engine used for this calculation';

-- ============================================================================
-- STEP 2: CREATE recalculation_queue TABLE
-- ============================================================================

CREATE TABLE recalculation_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    queue_month     DATE NOT NULL,                      -- Month needing recalculation
    reason          TEXT NOT NULL DEFAULT 'sync',        -- sync|rate_change|manual|cascade
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,                         -- NULL = pending

    CONSTRAINT chk_queue_month_first CHECK (EXTRACT(DAY FROM queue_month) = 1)
);

COMMENT ON TABLE recalculation_queue IS 'Decouples "what needs recalculation" from "when it happens". Processed by drain_recalculation_queue().';

-- ============================================================================
-- STEP 3: CREATE INDEXES
-- ============================================================================

-- Primary lookup: summary for a project in a month (covered by UNIQUE constraint)
CREATE INDEX idx_pms_month ON project_monthly_summary (summary_month);
CREATE INDEX idx_pms_company_month ON project_monthly_summary (company_id, summary_month);

-- Queue processing: pending items in chronological order
CREATE INDEX idx_recalc_queue_pending ON recalculation_queue (queue_month, queued_at)
    WHERE processed_at IS NULL;

-- Queue dedup: UNIQUE partial index so ON CONFLICT works for pending items
CREATE UNIQUE INDEX idx_recalc_queue_dedup ON recalculation_queue (project_id, queue_month)
    WHERE processed_at IS NULL;

-- ============================================================================
-- STEP 4: UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_pms_updated_at ON project_monthly_summary;
CREATE TRIGGER trg_pms_updated_at
    BEFORE UPDATE ON project_monthly_summary
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 5: BILLING PRECISION UTILITY FUNCTIONS
-- ============================================================================

-- Match TypeScript roundHours(): Math.round(value * 100) / 100
CREATE OR REPLACE FUNCTION billing_round_hours(p_value NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    RETURN ROUND(p_value, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION billing_round_hours(NUMERIC) IS 'Round hours to 2 decimal places. Matches TypeScript roundHours().';

-- Match TypeScript roundCurrency(): Math.round(value * 100) / 100
CREATE OR REPLACE FUNCTION billing_round_currency(p_value NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    RETURN ROUND(p_value, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION billing_round_currency(NUMERIC) IS 'Round currency to 2 decimal places. Matches TypeScript roundCurrency().';

-- Match TypeScript applyRounding(): Math.ceil(minutes / increment) * increment
CREATE OR REPLACE FUNCTION billing_apply_rounding(p_minutes INTEGER, p_increment INTEGER)
RETURNS INTEGER AS $$
BEGIN
    IF p_increment = 0 OR p_increment IS NULL THEN
        RETURN p_minutes;
    END IF;
    RETURN CEIL(p_minutes::NUMERIC / p_increment) * p_increment;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION billing_apply_rounding(INTEGER, INTEGER) IS 'Apply ceiling rounding to minutes. Matches TypeScript applyRounding().';

-- ============================================================================
-- STEP 6: CORE RECALCULATION FUNCTION
-- ============================================================================

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
    -- Array of project UUIDs (primary + members) for canonical grouping.
    -- Member projects' entries are aggregated under the primary, using
    -- the primary's billing config. Matches frontend useUnifiedBilling behavior.
    SELECT ARRAY_AGG(sub.pid)
    INTO v_project_ids
    FROM (
        -- The primary itself
        SELECT p_project_id AS pid
        UNION
        -- Any group members where this project is primary
        SELECT pgm.member_project_id
        FROM project_groups pg
        JOIN project_group_members pgm ON pgm.group_id = pg.id
        WHERE pg.primary_project_id = p_project_id
    ) sub;

    -- Fallback (should not happen, but safe)
    IF v_project_ids IS NULL THEN
        v_project_ids := ARRAY[p_project_id];
    END IF;

    -- =========================================
    -- STEP 1: GET BILLING CONFIGURATION
    -- =========================================

    -- Get effective rate (uses inheritance/backfill logic)
    SELECT r.effective_rate, r.source
    INTO v_rate, v_rate_source
    FROM get_effective_project_rate(p_project_id, v_month) r;

    -- Get effective rounding
    SELECT r.effective_rounding
    INTO v_rounding
    FROM get_effective_project_rounding(p_project_id, v_month) r;

    -- Get billing limits (most recent config <= this month)
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

    -- Get active status (most recent status <= this month)
    SELECT COALESCE(s.is_active, true)
    INTO v_is_active
    FROM project_monthly_active_status s
    WHERE s.project_id = p_project_id
        AND s.status_month <= v_month
    ORDER BY s.status_month DESC
    LIMIT 1;

    -- Apply defaults for NULL values
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

    -- Determine if billing limits are in effect
    v_has_billing_limits := (v_minimum_hours IS NOT NULL
                          OR v_maximum_hours IS NOT NULL
                          OR v_carryover_in > 0);

    -- =========================================
    -- STEP 3: CALCULATE TASK-LEVEL ROUNDING
    -- =========================================
    -- Per-task rounding: each task is rounded individually, then summed.
    -- Matches TypeScript: tasks.map(t => applyRounding(t.totalMinutes, rounding))
    -- then reduce((sum, t) => sum + t.roundedMinutes, 0)

    WITH task_rounded AS (
        SELECT
            tdr.task_id,
            SUM(tdr.total_minutes)::INTEGER AS task_actual_minutes,
            billing_apply_rounding(SUM(tdr.total_minutes)::INTEGER, v_rounding) AS task_rounded_minutes
        FROM timesheet_daily_rollups tdr
        JOIN projects p ON p.project_id = tdr.project_id
        WHERE p.id = ANY(v_project_ids)
            AND DATE_TRUNC('month', tdr.work_date)::DATE = v_month
            AND tdr.total_minutes > 0
        GROUP BY tdr.task_id
    )
    SELECT
        COALESCE(SUM(task_actual_minutes), 0),
        COALESCE(SUM(task_rounded_minutes), 0)
    INTO v_actual_minutes, v_rounded_minutes
    FROM task_rounded;

    -- Count distinct resources, tasks, and total entries separately
    SELECT
        COALESCE(COUNT(DISTINCT tdr.user_id), 0),
        COALESCE(COUNT(DISTINCT tdr.task_id), 0),
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
    -- Matches TypeScript calculateBilledHours() from billing.ts:
    -- 1. Apply minimum (if active and below minimum)
    -- 2. Apply maximum (cap billed hours)
    -- 3. Excess goes to carryover (if enabled) or unbillable

    IF v_has_billing_limits THEN
        -- Apply minimum (if active and below minimum)
        IF v_is_active AND v_minimum_hours IS NOT NULL AND v_adjusted_hours < v_minimum_hours THEN
            v_minimum_padding := billing_round_hours(v_minimum_hours - v_adjusted_hours);
            v_billed_hours := v_minimum_hours;
            v_minimum_applied := true;
        END IF;

        -- Apply maximum (cap billed hours)
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
    -- Stored as BIGINT cents (never float for money storage)
    v_base_revenue_cents := ROUND(v_rounded_hours * v_rate * 100)::BIGINT;
    v_billed_revenue_cents := ROUND(v_billed_hours * v_rate * 100)::BIGINT;

    -- =========================================
    -- STEP 7: GET INVOICED REVENUE
    -- =========================================
    -- Invoiced revenue from billing_transactions for this company+month.
    -- NOTE: This is company-level, not project-level. The company view
    -- handles proper aggregation without double-counting.
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
        NOW(), 'v1.0'
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
    -- NOTE: updated_at is handled by the trg_pms_updated_at trigger

    -- =========================================
    -- STEP 9: CASCADE CARRYOVER IF CHANGED
    -- =========================================
    -- If carryover_out changed from what was previously stored,
    -- the next month must be recalculated.
    DECLARE
        v_old_carryover_out NUMERIC(10,2);
        v_next_month DATE := (v_month + INTERVAL '1 month')::DATE;
    BEGIN
        -- Get what was previously carried from this month to the next
        SELECT COALESCE(SUM(pch.carryover_hours), 0)
        INTO v_old_carryover_out
        FROM project_carryover_hours pch
        WHERE pch.project_id = p_project_id
            AND pch.source_month = v_month;

        -- If carryover changed, update and queue next month
        IF v_carryover_out IS DISTINCT FROM v_old_carryover_out THEN
            IF v_carryover_enabled AND v_carryover_out > 0 THEN
                -- Upsert carryover record for next month
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

                -- Queue next month for recalculation
                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (p_project_id, v_next_month, 'cascade')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;

            ELSIF v_old_carryover_out > 0 THEN
                -- Carryover was previously stored but is now zero (disabled or no excess).
                -- Remove stale carryover record and queue next month.
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
    'Idempotent: running twice with same inputs produces identical output.';

-- ============================================================================
-- STEP 7: BATCH RECALCULATION FUNCTIONS
-- ============================================================================

-- Recalculate ALL canonical projects for a given month
CREATE OR REPLACE FUNCTION recalculate_month(p_month DATE)
RETURNS INTEGER AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_project RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Only recalculate primary/unassociated projects (canonical).
    -- v_project_table_entities filters out member projects.
    FOR v_project IN
        SELECT vte.id AS project_id
        FROM v_project_table_entities vte
    LOOP
        PERFORM recalculate_project_month(v_project.project_id, v_month);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_month(DATE) IS
    'Recalculate billing summaries for all canonical projects in a given month.';

-- Process the recalculation queue (called by n8n after sync)
CREATE OR REPLACE FUNCTION drain_recalculation_queue(p_max_depth INTEGER DEFAULT 12)
RETURNS INTEGER AS $$
DECLARE
    v_item RECORD;
    v_processed INTEGER := 0;
    v_cascade_depth INTEGER := 0;
BEGIN
    -- Process in chronological order (oldest month first - critical for carryover)
    LOOP
        -- Get next unprocessed item, ordered by month (oldest first for carryover).
        -- The partial unique index guarantees at most one pending row per (project, month).
        SELECT id, project_id, queue_month, reason
        INTO v_item
        FROM recalculation_queue
        WHERE processed_at IS NULL
        ORDER BY queue_month ASC, queued_at ASC
        LIMIT 1;

        EXIT WHEN v_item IS NULL;

        -- Safety: prevent runaway cascades
        IF v_item.reason = 'cascade' THEN
            v_cascade_depth := v_cascade_depth + 1;
            IF v_cascade_depth > p_max_depth THEN
                RAISE WARNING 'Cascade depth limit reached (%) for project %',
                    p_max_depth, v_item.project_id;
                EXIT;
            END IF;
        ELSE
            v_cascade_depth := 0;
        END IF;

        -- Recalculate
        PERFORM recalculate_project_month(v_item.project_id, v_item.queue_month);

        -- Mark ALL pending items for this project+month as processed
        UPDATE recalculation_queue
        SET processed_at = NOW()
        WHERE project_id = v_item.project_id
            AND queue_month = v_item.queue_month
            AND processed_at IS NULL;

        v_processed := v_processed + 1;
    END LOOP;

    RETURN v_processed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION drain_recalculation_queue(INTEGER) IS
    'Process all pending items in the recalculation queue. Called by n8n after sync. '
    'p_max_depth limits cascade depth to prevent runaway chains.';

-- Historical backfill: calculate all months from start to end
CREATE OR REPLACE FUNCTION backfill_summaries(
    p_start_month DATE,
    p_end_month DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER AS $$
DECLARE
    v_month DATE;
    v_total INTEGER := 0;
    v_count INTEGER;
BEGIN
    v_month := DATE_TRUNC('month', p_start_month)::DATE;

    WHILE v_month <= DATE_TRUNC('month', p_end_month)::DATE LOOP
        v_count := recalculate_month(v_month);
        v_total := v_total + v_count;
        RAISE NOTICE 'Backfilled % for % projects', v_month, v_count;
        v_month := (v_month + INTERVAL '1 month')::DATE;
    END LOOP;

    RETURN v_total;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_summaries(DATE, DATE) IS
    'Backfill billing summaries for all canonical projects across a date range. '
    'Processes months in chronological order (critical for carryover chain integrity).';

-- ============================================================================
-- STEP 8: AGGREGATE VIEWS
-- ============================================================================

-- 8a: Company-Month Summary
CREATE OR REPLACE VIEW v_monthly_summary_by_company AS
SELECT
    pms.summary_month,
    pms.company_id,
    c.client_name,
    COALESCE(c.display_name, c.client_name) AS company_display_name,

    -- Hours
    SUM(pms.actual_hours) AS total_actual_hours,
    SUM(pms.rounded_hours) AS total_rounded_hours,
    SUM(pms.billed_hours) AS total_billed_hours,
    SUM(pms.unbillable_hours) AS total_unbillable_hours,

    -- Revenue (from summary)
    SUM(pms.base_revenue_cents) AS total_base_revenue_cents,
    SUM(pms.billed_revenue_cents) AS total_billed_revenue_cents,

    -- Invoiced revenue: aggregate from billing_transactions directly
    -- (not from summary rows, to avoid duplication across projects)
    COALESCE(bt_agg.total_invoiced_cents, 0) AS total_invoiced_revenue_cents,

    -- Counts
    COUNT(*) AS project_count,
    SUM(pms.resource_count) AS total_resource_entries,

    -- Weighted average rate
    CASE WHEN SUM(pms.billed_hours) > 0
        THEN ROUND(SUM(pms.billed_revenue_cents)::NUMERIC / SUM(pms.billed_hours) / 100, 2)
        ELSE 0
    END AS weighted_avg_rate

FROM project_monthly_summary pms
JOIN companies c ON c.id = pms.company_id
LEFT JOIN (
    SELECT
        b.company_id,
        bt.transaction_month,
        SUM(bt.amount_cents) AS total_invoiced_cents
    FROM billing_transactions bt
    JOIN billings b ON b.id = bt.billing_id
    GROUP BY b.company_id, bt.transaction_month
) bt_agg ON bt_agg.company_id = pms.company_id
        AND bt_agg.transaction_month = pms.summary_month
GROUP BY pms.summary_month, pms.company_id, c.client_name, c.display_name,
         bt_agg.total_invoiced_cents;

COMMENT ON VIEW v_monthly_summary_by_company IS
    'Aggregated billing summary by company and month. Invoiced revenue from billing_transactions (not duplicated).';

-- 8b: Monthly Totals (with Utilization + Invoiced Revenue)
CREATE OR REPLACE VIEW v_monthly_summary_totals AS
WITH month_data AS (
    SELECT
        pms.summary_month,
        SUM(pms.actual_hours) AS total_actual_hours,
        SUM(pms.rounded_hours) AS total_rounded_hours,
        SUM(pms.billed_hours) AS total_billed_hours,
        SUM(pms.unbillable_hours) AS total_unbillable_hours,
        SUM(pms.base_revenue_cents) AS total_base_revenue_cents,
        SUM(pms.billed_revenue_cents) AS total_billed_revenue_cents,
        COUNT(DISTINCT pms.company_id) AS company_count,
        COUNT(DISTINCT pms.project_id) AS project_count
    FROM project_monthly_summary pms
    GROUP BY pms.summary_month
),
-- Count distinct resources from raw data (accurate cross-project)
resource_data AS (
    SELECT
        DATE_TRUNC('month', tdr.work_date)::DATE AS summary_month,
        COUNT(DISTINCT tdr.user_id) AS distinct_resource_count
    FROM timesheet_daily_rollups tdr
    WHERE tdr.total_minutes > 0
    GROUP BY DATE_TRUNC('month', tdr.work_date)::DATE
),
-- Working days (weekdays minus holidays)
working_days AS (
    SELECT
        DATE_TRUNC('month', d.day)::DATE AS summary_month,
        COUNT(*) FILTER (
            WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
                AND NOT EXISTS (
                    SELECT 1 FROM bulgarian_holidays bh
                    WHERE bh.holiday_date = d.day
                )
        ) AS working_day_count
    FROM generate_series(
        (SELECT MIN(summary_month) FROM project_monthly_summary),
        (SELECT MAX(summary_month) + INTERVAL '1 month - 1 day' FROM project_monthly_summary),
        '1 day'
    ) d(day)
    GROUP BY DATE_TRUNC('month', d.day)::DATE
),
-- Invoiced revenue (all billing transactions)
invoiced AS (
    SELECT
        bt.transaction_month AS summary_month,
        SUM(bt.amount_cents) AS total_invoiced_cents
    FROM billing_transactions bt
    GROUP BY bt.transaction_month
)
SELECT
    md.summary_month,

    -- Hours
    md.total_actual_hours,
    md.total_rounded_hours,
    md.total_billed_hours,
    md.total_unbillable_hours,

    -- Revenue
    md.total_base_revenue_cents,
    md.total_billed_revenue_cents,
    COALESCE(inv.total_invoiced_cents, 0) AS total_invoiced_revenue_cents,
    md.total_billed_revenue_cents + COALESCE(inv.total_invoiced_cents, 0)
        AS total_combined_revenue_cents,

    -- Counts
    md.company_count,
    md.project_count,
    COALESCE(rd.distinct_resource_count, 0) AS resource_count,

    -- Utilization
    COALESCE(wd.working_day_count, 0) AS working_days,
    COALESCE(rd.distinct_resource_count, 0) * COALESCE(wd.working_day_count, 0) * 8
        AS total_available_hours,
    CASE
        WHEN COALESCE(rd.distinct_resource_count, 0) * COALESCE(wd.working_day_count, 0) * 8 > 0
        THEN ROUND(
            md.total_actual_hours * 100.0 /
            (rd.distinct_resource_count * wd.working_day_count * 8),
            1
        )
        ELSE 0
    END AS utilization_percent,

    -- Weighted average rate
    CASE WHEN md.total_billed_hours > 0
        THEN ROUND(md.total_billed_revenue_cents::NUMERIC / md.total_billed_hours / 100, 2)
        ELSE 0
    END AS weighted_avg_rate

FROM month_data md
LEFT JOIN resource_data rd ON rd.summary_month = md.summary_month
LEFT JOIN working_days wd ON wd.summary_month = md.summary_month
LEFT JOIN invoiced inv ON inv.summary_month = md.summary_month
ORDER BY md.summary_month;

COMMENT ON VIEW v_monthly_summary_totals IS
    'Global monthly billing totals with utilization %, resource count, and invoiced revenue.';

-- 8c: Carryover Chain View (audit trail)
CREATE OR REPLACE VIEW v_carryover_chain AS
SELECT
    pms.project_id,
    p.project_name,
    pms.summary_month,
    pms.carryover_in_hours,
    pms.rounded_hours,
    pms.adjusted_hours,
    pms.billed_hours,
    pms.carryover_out_hours,
    pms.unbillable_hours,
    pms.maximum_hours_config,
    pms.carryover_enabled_config,
    pms.maximum_applied
FROM project_monthly_summary pms
JOIN projects p ON p.id = pms.project_id
WHERE pms.has_billing_limits = true
ORDER BY pms.project_id, pms.summary_month;

COMMENT ON VIEW v_carryover_chain IS
    'Audit trail for carryover flow across months for projects with billing limits.';

-- ============================================================================
-- STEP 9: RLS POLICIES
-- ============================================================================

ALTER TABLE project_monthly_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE recalculation_queue ENABLE ROW LEVEL SECURITY;

-- Summary: read-only for authenticated users
DROP POLICY IF EXISTS "Allow authenticated read summaries" ON project_monthly_summary;
CREATE POLICY "Allow authenticated read summaries"
    ON project_monthly_summary FOR SELECT TO authenticated USING (true);

-- Summary: service_role can write (for recalculation functions)
DROP POLICY IF EXISTS "Allow service role full access summaries" ON project_monthly_summary;
CREATE POLICY "Allow service role full access summaries"
    ON project_monthly_summary FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Queue: service_role only (internal mechanism)
DROP POLICY IF EXISTS "Allow service role full access queue" ON recalculation_queue;
CREATE POLICY "Allow service role full access queue"
    ON recalculation_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Queue: authenticated can read (for monitoring/debugging)
DROP POLICY IF EXISTS "Allow authenticated read queue" ON recalculation_queue;
CREATE POLICY "Allow authenticated read queue"
    ON recalculation_queue FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- STEP 10: GRANTS
-- ============================================================================

GRANT SELECT ON project_monthly_summary TO authenticated;
GRANT ALL ON project_monthly_summary TO service_role;

GRANT SELECT ON recalculation_queue TO authenticated;
GRANT ALL ON recalculation_queue TO service_role;

GRANT SELECT ON v_monthly_summary_by_company TO authenticated;
GRANT SELECT ON v_monthly_summary_totals TO authenticated;
GRANT SELECT ON v_carryover_chain TO authenticated;

GRANT EXECUTE ON FUNCTION billing_round_hours(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_round_hours(NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION billing_round_currency(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_round_currency(NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION billing_apply_rounding(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_apply_rounding(INTEGER, INTEGER) TO service_role;

GRANT EXECUTE ON FUNCTION recalculate_project_month(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION recalculate_month(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION drain_recalculation_queue(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION backfill_summaries(DATE, DATE) TO service_role;

-- ============================================================================
-- STEP 11: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_summary_exists BOOLEAN;
    v_queue_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'project_monthly_summary'
    ) INTO v_summary_exists;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'recalculation_queue'
    ) INTO v_queue_exists;

    IF v_summary_exists AND v_queue_exists THEN
        RAISE NOTICE 'Migration 044 Complete:';
        RAISE NOTICE '  - project_monthly_summary table created';
        RAISE NOTICE '  - recalculation_queue table created';
        RAISE NOTICE '  - Billing utility functions created';
        RAISE NOTICE '  - recalculate_project_month() function created';
        RAISE NOTICE '  - Batch functions created (recalculate_month, drain_recalculation_queue, backfill_summaries)';
        RAISE NOTICE '  - Aggregate views created (v_monthly_summary_by_company, v_monthly_summary_totals, v_carryover_chain)';
        RAISE NOTICE '  - RLS policies and grants applied';
        RAISE NOTICE '  - NOTE: Triggers deployed separately in migration 045';
    ELSE
        RAISE EXCEPTION 'Migration 044 Failed: tables were not created';
    END IF;
END $$;

COMMIT;
