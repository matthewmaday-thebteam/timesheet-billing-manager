-- ============================================================================
-- Migration 050: Fix Member Project Double-Counting in Billing Summary
-- Task: 036 - Fix Revenue Trend Chart / Audit February Revenue
-- ============================================================================
-- Problem: The sync trigger (enqueue_affected_months) enqueues member projects
-- directly into recalculation_queue. When recalculate_project_month() runs for
-- a member, the canonical group lookup fails (member isn't a primary), so the
-- member gets its own standalone summary row with:
--   a) Only its own hours (not aggregated with the group)
--   b) Its own rate (which may differ from the primary's rate)
--
-- The primary project ALSO gets recalculated correctly (with all members
-- included). The view v_combined_revenue_by_company_month sums ALL rows,
-- causing double-counting of member hours at the wrong rate.
--
-- Fix (3 layers of defense):
--   1. Fix trigger: resolve member projects to their primary before enqueuing
--   2. Fix view: exclude member project rows as a safety net
--   3. Cleanup: delete stale member summary rows and re-backfill affected months
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Fix the sync trigger to resolve members → primary
-- ============================================================================
-- The trigger fires on INSERT to timesheet_daily_rollups. It must enqueue the
-- PRIMARY project (not the member) so that recalculate_project_month() builds
-- the correct canonical group.

CREATE OR REPLACE FUNCTION enqueue_affected_months()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO recalculation_queue (project_id, queue_month, reason)
    SELECT DISTINCT
        -- Resolve member projects to their primary; standalone projects stay as-is
        COALESCE(pg.primary_project_id, p.id),
        DATE_TRUNC('month', n.work_date)::DATE,
        'sync'
    FROM new_rows n
    JOIN projects p ON p.project_id = n.project_id
    LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
    LEFT JOIN project_groups pg ON pg.id = pgm.group_id
    WHERE n.work_date IS NOT NULL
        AND n.total_minutes > 0
    ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
    DO NOTHING;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION enqueue_affected_months() IS
    'STATEMENT-level trigger function: enqueues affected (project, month) pairs '
    'into recalculation_queue when new timesheet data is synced. '
    'Resolves member projects to their primary to prevent orphaned summary rows.';

-- ============================================================================
-- STEP 2: Fix the combined revenue view to exclude member project rows
-- ============================================================================
-- Safety net: even if a stale member row exists, the view won't count it.

CREATE OR REPLACE VIEW v_combined_revenue_by_company_month AS
SELECT
  pms.summary_month,
  pms.company_id,
  c.client_id,
  COALESCE(c.display_name, c.client_name) AS company_name,

  -- Timesheet revenue (from project_monthly_summary)
  SUM(pms.billed_revenue_cents) AS timesheet_revenue_cents,

  -- Effective revenue: milestone overrides replace timesheet revenue per-project
  SUM(COALESCE(pms.milestone_override_cents, pms.billed_revenue_cents)) AS effective_revenue_cents,

  -- Fixed billings (from monthly_fixed_billing_summary)
  COALESCE(fbs.fixed_billing_cents, 0) AS fixed_billing_cents,

  -- Combined total: effective + fixed
  SUM(COALESCE(pms.milestone_override_cents, pms.billed_revenue_cents))
    + COALESCE(fbs.fixed_billing_cents, 0) AS combined_revenue_cents,

  -- Hours (unchanged by fixed billing integration)
  SUM(pms.billed_hours) AS total_billed_hours,
  SUM(pms.actual_hours) AS total_actual_hours

FROM project_monthly_summary pms
JOIN companies c ON c.id = pms.company_id
-- Exclude member projects: they should not have their own summary rows.
-- Only primary/standalone projects should be included.
LEFT JOIN project_group_members pgm ON pgm.member_project_id = pms.project_id
LEFT JOIN monthly_fixed_billing_summary fbs
  ON fbs.company_id = pms.company_id
  AND fbs.summary_month = pms.summary_month
WHERE pgm.member_project_id IS NULL  -- Exclude member projects
GROUP BY
  pms.summary_month,
  pms.company_id,
  c.client_id,
  c.display_name,
  c.client_name,
  fbs.fixed_billing_cents;

COMMENT ON VIEW v_combined_revenue_by_company_month IS
  'Combined revenue per company-month: timesheet (with milestone overrides) + fixed billings. '
  'Excludes member project rows (only primary/standalone projects are counted). '
  'Mirrors the Dashboard combinedTotalRevenue formula.';

-- ============================================================================
-- STEP 3: Fix v_monthly_summary_by_company to also exclude members
-- ============================================================================

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
-- Exclude member projects
LEFT JOIN project_group_members pgm ON pgm.member_project_id = pms.project_id
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
WHERE pgm.member_project_id IS NULL  -- Exclude member projects
GROUP BY pms.summary_month, pms.company_id, c.client_name, c.display_name,
         bt_agg.total_invoiced_cents;

COMMENT ON VIEW v_monthly_summary_by_company IS
    'Aggregated billing summary by company and month. '
    'Excludes member project rows (only primary/standalone projects counted). '
    'Invoiced revenue from billing_transactions (not duplicated).';

-- ============================================================================
-- STEP 4: Fix v_monthly_summary_totals to also exclude members
-- ============================================================================

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
    -- Exclude member projects
    LEFT JOIN project_group_members pgm ON pgm.member_project_id = pms.project_id
    WHERE pgm.member_project_id IS NULL
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
    'Global monthly billing totals with utilization %, resource count, and invoiced revenue. '
    'Excludes member project rows (only primary/standalone projects counted).';

-- ============================================================================
-- STEP 5: Delete stale member project summary rows
-- ============================================================================
-- These rows were created by the buggy trigger. They're now excluded from
-- views (Step 2-4) and won't be recreated (Step 1).

DELETE FROM project_monthly_summary
WHERE project_id IN (
    SELECT pgm.member_project_id
    FROM project_group_members pgm
);

-- ============================================================================
-- STEP 6: Re-backfill all months to ensure correct data
-- ============================================================================
-- The backfill function uses v_project_table_entities (canonical only),
-- so it will only create rows for primary/standalone projects.

SELECT backfill_summaries('2026-01-01'::DATE, CURRENT_DATE);

-- Also re-run fixed billing recalculation for all months with billing data
DO $$
DECLARE
  v_month DATE;
BEGIN
  FOR v_month IN
    SELECT DISTINCT DATE_TRUNC('month', transaction_month)::DATE
    FROM billing_transactions
    WHERE transaction_month >= '2026-01-01'
    ORDER BY 1
  LOOP
    PERFORM recalculate_fixed_billing_month(v_month);
  END LOOP;
END $$;

-- ============================================================================
-- STEP 7: Create filtered view for useSummaryBilling (frontend safety net)
-- ============================================================================
-- The frontend hook reads project_monthly_summary directly. This view
-- provides the same data but excludes member project rows, so the frontend
-- gets correct totals even if stale rows somehow reappear.

CREATE OR REPLACE VIEW v_canonical_project_monthly_summary AS
SELECT pms.*
FROM project_monthly_summary pms
LEFT JOIN project_group_members pgm ON pgm.member_project_id = pms.project_id
WHERE pgm.member_project_id IS NULL;

COMMENT ON VIEW v_canonical_project_monthly_summary IS
    'Filtered view of project_monthly_summary that excludes member project rows. '
    'Use this instead of the raw table when aggregating to avoid double-counting.';

GRANT SELECT ON v_canonical_project_monthly_summary TO authenticated;
GRANT SELECT ON v_canonical_project_monthly_summary TO service_role;

-- ============================================================================
-- STEP 8: Verification
-- ============================================================================

DO $$
DECLARE
  v_member_count INTEGER;
  v_feb_food_count INTEGER;
BEGIN
  -- Verify no member project rows remain
  SELECT COUNT(*)
  INTO v_member_count
  FROM project_monthly_summary pms
  JOIN project_group_members pgm ON pgm.member_project_id = pms.project_id;

  -- Verify FoodCycle Science Feb has correct project count
  SELECT COUNT(*)
  INTO v_feb_food_count
  FROM project_monthly_summary pms
  WHERE pms.summary_month = '2026-02-01'
    AND pms.company_id = 'd3f439de-51b2-4a1e-8ae3-4763b9eebd10';

  RAISE NOTICE 'Migration 050 Complete:';
  RAISE NOTICE '  - Trigger enqueue_affected_months() updated (resolves members to primary)';
  RAISE NOTICE '  - v_combined_revenue_by_company_month updated (excludes member rows)';
  RAISE NOTICE '  - v_monthly_summary_by_company updated (excludes member rows)';
  RAISE NOTICE '  - v_monthly_summary_totals updated (excludes member rows)';
  RAISE NOTICE '  - Stale member summary rows deleted (% remaining)', v_member_count;
  RAISE NOTICE '  - FoodCycle Science Feb project count: % (expected: 1-2 canonical)', v_feb_food_count;
  RAISE NOTICE '  - Backfill re-run for 2026 data';

  IF v_member_count > 0 THEN
    RAISE WARNING 'WARNING: % member project rows still exist in project_monthly_summary', v_member_count;
  END IF;
END $$;

COMMIT;
