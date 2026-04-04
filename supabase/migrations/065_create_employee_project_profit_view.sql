-- ============================================================================
-- Migration 065: Employee Project Profit View
-- ============================================================================
-- Purpose: Create a database view that computes per-employee, per-canonical-
-- project, per-month profit by combining:
--   - Employee's actual time worked (raw & rounded minutes)
--   - Proportional share of project billed revenue (based on raw minutes)
--   - Employee cost (from resource billing configuration)
--   - Profit = proportional revenue - cost
--
-- This view supports the EmployeePerformance component's profit-per-employee-
-- per-project feature, moving the calculation from the frontend to the database
-- for consistency and auditability.
--
-- Dependencies:
--   - timesheet_daily_rollups (raw time data)
--   - resource_user_associations (user_id -> resource_id mapping)
--   - v_entity_canonical (resource_id -> canonical_entity_id mapping)
--   - resources (billing_mode, hourly_rate, monthly_cost, expected_hours)
--   - projects (project_id text -> id UUID mapping)
--   - v_project_canonical (project_id -> canonical_project_id mapping)
--   - v_canonical_project_monthly_summary (billed_revenue_cents, rounding_used)
--   - billing_apply_rounding() from migration 044
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART A: Function get_employee_effective_cost_rate
-- ============================================================================
-- Replicates getEffectiveHourlyRate() from src/utils/billing.ts (lines 22-38):
--   - hourly mode: return hourly_rate
--   - monthly mode: return monthly_cost / COALESCE(expected_hours, 160)
--   - Guards: NULL monthly_cost or zero/negative expected_hours -> NULL

CREATE OR REPLACE FUNCTION get_employee_effective_cost_rate(p_resource_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_billing_mode TEXT;
    v_hourly_rate NUMERIC(10,2);
    v_monthly_cost NUMERIC(10,2);
    v_expected_hours NUMERIC(5,2);
    v_effective_hours NUMERIC(5,2);
BEGIN
    SELECT
        r.billing_mode,
        r.hourly_rate,
        r.monthly_cost,
        r.expected_hours
    INTO
        v_billing_mode,
        v_hourly_rate,
        v_monthly_cost,
        v_expected_hours
    FROM resources r
    WHERE r.id = p_resource_id;

    -- Resource not found
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Hourly mode: return hourly_rate directly
    IF v_billing_mode = 'hourly' THEN
        RETURN ROUND(v_hourly_rate, 4);
    END IF;

    -- Monthly mode: calculate from monthly_cost / expected_hours
    -- Guard: if monthly_cost is NULL, cannot compute
    IF v_monthly_cost IS NULL THEN
        RETURN NULL;
    END IF;

    -- Default expected_hours to 160 (full-time), matching DEFAULT_EXPECTED_HOURS in TS
    v_effective_hours := COALESCE(v_expected_hours, 160);

    -- Guard: if effective hours <= 0, cannot compute
    IF v_effective_hours <= 0 THEN
        RETURN NULL;
    END IF;

    RETURN ROUND(v_monthly_cost / v_effective_hours, 4);
END;
$$;

COMMENT ON FUNCTION get_employee_effective_cost_rate(UUID) IS
    'Returns the effective hourly cost rate for a resource. '
    'Hourly mode: returns hourly_rate. Monthly mode: monthly_cost / COALESCE(expected_hours, 160). '
    'Returns NULL if cost cannot be computed. Matches getEffectiveHourlyRate() in billing.ts.';

-- ============================================================================
-- PART B: View v_employee_project_profit
-- ============================================================================
-- Computes per canonical employee, per canonical project, per month:
--   - employee_raw_minutes: actual minutes worked (SUM of total_minutes)
--   - employee_rounded_minutes: per-task rounded using billing_apply_rounding()
--   - proportional_revenue: billed_revenue_cents * (employee_raw / total_project_raw)
--   - employee_cost_cents: ROUND((raw_minutes / 60.0) * cost_rate * 100, 0)
--   - employee_profit_cents: proportional_revenue - employee_cost_cents
--
-- Join chain:
--   tdr -> projects (external project_id -> UUID)
--        -> v_project_canonical (project UUID -> canonical project UUID)
--        -> v_canonical_project_monthly_summary (canonical project + month -> billing data)
--   tdr -> resource_user_associations (user_id text -> resource_id UUID)
--        -> v_entity_canonical (resource_id -> canonical_entity_id)
--        -> resources (canonical entity -> billing config for cost rate)

CREATE OR REPLACE VIEW v_employee_project_profit AS
WITH employee_task_minutes AS (
    -- Aggregate raw minutes by canonical employee, canonical project, month, and task
    -- so we can apply per-task rounding (matching the billing engine's approach)
    SELECT
        vec.canonical_entity_id,
        vpc.canonical_project_id,
        DATE_TRUNC('month', tdr.work_date)::DATE AS month,
        tdr.task_id,
        SUM(tdr.total_minutes)::INTEGER AS task_raw_minutes
    FROM timesheet_daily_rollups tdr
    -- Map external project_id to internal UUID, then to canonical project
    JOIN projects p ON p.project_id = tdr.project_id
    JOIN v_project_canonical vpc ON vpc.project_id = p.id
    -- Map user_id to resource_id, then to canonical entity
    LEFT JOIN resource_user_associations rua ON rua.user_id = tdr.user_id
    LEFT JOIN v_entity_canonical vec ON vec.entity_id = rua.resource_id
    WHERE tdr.total_minutes > 0
    GROUP BY
        vec.canonical_entity_id,
        vpc.canonical_project_id,
        DATE_TRUNC('month', tdr.work_date)::DATE,
        tdr.task_id
),
employee_project_aggregates AS (
    -- Sum raw minutes and apply per-task rounding, then aggregate per employee-project-month
    SELECT
        etm.canonical_entity_id,
        etm.canonical_project_id,
        etm.month,
        SUM(etm.task_raw_minutes)::INTEGER AS employee_raw_minutes,
        SUM(
            billing_apply_rounding(
                etm.task_raw_minutes,
                cpms.rounding_used
            )
        )::INTEGER AS employee_rounded_minutes,
        cpms.billed_revenue_cents,
        cpms.rounding_used
    FROM employee_task_minutes etm
    JOIN v_canonical_project_monthly_summary cpms
        ON cpms.project_id = etm.canonical_project_id
        AND cpms.summary_month = etm.month
    GROUP BY
        etm.canonical_entity_id,
        etm.canonical_project_id,
        etm.month,
        cpms.billed_revenue_cents,
        cpms.rounding_used
),
with_project_totals AS (
    -- Add total project raw minutes (all employees) using a window function
    -- This is used for proportional revenue distribution
    SELECT
        epa.*,
        SUM(epa.employee_raw_minutes) OVER (
            PARTITION BY epa.canonical_project_id, epa.month
        ) AS total_project_raw_minutes,
        get_employee_effective_cost_rate(epa.canonical_entity_id) AS effective_cost_rate
    FROM employee_project_aggregates epa
)
SELECT
    wpt.canonical_entity_id,
    wpt.canonical_project_id,
    wpt.month,
    wpt.employee_raw_minutes,
    wpt.employee_rounded_minutes,
    wpt.billed_revenue_cents,
    wpt.effective_cost_rate,
    -- Proportional revenue: use RAW minutes for the share (matching EmployeePerformance.tsx)
    ROUND(
        wpt.billed_revenue_cents
        * (wpt.employee_raw_minutes::NUMERIC / NULLIF(wpt.total_project_raw_minutes, 0)),
        0
    )::BIGINT AS proportional_revenue_cents,
    -- Employee cost: (raw_minutes / 60) * cost_rate * 100, stored as cents
    CASE
        WHEN wpt.effective_cost_rate IS NOT NULL THEN
            ROUND(
                (wpt.employee_raw_minutes / 60.0) * wpt.effective_cost_rate * 100,
                0
            )::BIGINT
        ELSE NULL
    END AS employee_cost_cents,
    -- Employee profit: revenue - cost
    CASE
        WHEN wpt.effective_cost_rate IS NOT NULL THEN
            ROUND(
                wpt.billed_revenue_cents
                * (wpt.employee_raw_minutes::NUMERIC / NULLIF(wpt.total_project_raw_minutes, 0)),
                0
            )::BIGINT
            -
            ROUND(
                (wpt.employee_raw_minutes / 60.0) * wpt.effective_cost_rate * 100,
                0
            )::BIGINT
        ELSE NULL
    END AS employee_profit_cents
FROM with_project_totals wpt
-- Only include rows where canonical_entity_id is resolved
-- (entries without a resource_user_association will have NULL canonical_entity_id)
WHERE wpt.canonical_entity_id IS NOT NULL;

COMMENT ON VIEW v_employee_project_profit IS
    'Per-employee, per-canonical-project, per-month profit view. '
    'Revenue is distributed proportionally by raw minutes (matching EmployeePerformance.tsx). '
    'Cost is calculated from employee effective cost rate * raw hours. '
    'Profit = proportional revenue - cost. All monetary values in cents (BIGINT).';

-- ============================================================================
-- PART C: Grants
-- ============================================================================

GRANT SELECT ON v_employee_project_profit TO authenticated;
GRANT SELECT ON v_employee_project_profit TO service_role;

GRANT EXECUTE ON FUNCTION get_employee_effective_cost_rate(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_employee_effective_cost_rate(UUID) TO service_role;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Migration 065 Complete:';
    RAISE NOTICE '  - get_employee_effective_cost_rate() function created';
    RAISE NOTICE '  - v_employee_project_profit view created';
    RAISE NOTICE '  - Grants applied for authenticated and service_role';
END $$;

COMMIT;
