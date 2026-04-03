-- ============================================================================
-- Migration 075: Investor Dashboard Metrics RPC
-- ============================================================================
-- Purpose: Create a single RPC function that returns all pre-calculated
-- metrics needed by the Investor Dashboard for a given month, replacing
-- frontend-side workday counting and revenue calculations.
--
-- Returns: combined (billed) revenue, earned revenue, daily averages,
-- workday counts, holiday count, and projected revenues.
--
-- Data sources:
--   - v_combined_revenue_by_company_month (combined/billed revenue)
--   - v_canonical_project_monthly_summary (earned revenue via rollover/unbillable)
--   - bulgarian_holidays (holiday exclusions)
--   - generate_series (workday counting)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_investor_dashboard_metrics(p_month DATE)
RETURNS TABLE (
  combined_total_revenue_cents   BIGINT,
  earned_total_revenue_cents     BIGINT,
  avg_daily_earned_revenue_cents BIGINT,
  avg_daily_billed_revenue_cents BIGINT,
  total_workdays                 INTEGER,
  completed_workdays             INTEGER,
  remaining_workdays             INTEGER,
  company_holiday_count          INTEGER,
  projected_earned_revenue_cents BIGINT,
  projected_billed_revenue_cents BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_month_start DATE;
  v_month_end   DATE;
  v_today       DATE := CURRENT_DATE;

  v_combined_cents     BIGINT;
  v_earned_extra_cents BIGINT;
  v_earned_cents       BIGINT;

  v_total_wd      INTEGER;
  v_completed_wd  INTEGER;
  v_remaining_wd  INTEGER;
  v_holiday_count INTEGER;

  v_avg_daily_earned BIGINT;
  v_avg_daily_billed BIGINT;
BEGIN
  -- Normalize to first of month
  v_month_start := DATE_TRUNC('month', p_month)::DATE;
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  -- ========================================================================
  -- 1. Combined (billed) revenue from v_combined_revenue_by_company_month
  -- ========================================================================
  SELECT COALESCE(SUM(cr.combined_revenue_cents), 0)
  INTO v_combined_cents
  FROM v_combined_revenue_by_company_month cr
  WHERE cr.summary_month = v_month_start;

  -- ========================================================================
  -- 2. Earned revenue = combined + rolled-over/unbillable value for
  --    non-milestone projects (those without milestone_override_cents)
  -- ========================================================================
  SELECT COALESCE(SUM(
    ROUND((pms.carryover_out_hours + pms.unbillable_hours) * pms.rate_used * 100)::BIGINT
  ), 0)
  INTO v_earned_extra_cents
  FROM v_canonical_project_monthly_summary pms
  WHERE pms.summary_month = v_month_start
    AND pms.milestone_override_cents IS NULL;

  v_earned_cents := v_combined_cents + v_earned_extra_cents;

  -- ========================================================================
  -- 3. Company holidays (weekday holidays in this month)
  -- ========================================================================
  SELECT COUNT(*)::INTEGER
  INTO v_holiday_count
  FROM bulgarian_holidays bh
  WHERE bh.holiday_date >= v_month_start
    AND bh.holiday_date <= v_month_end
    AND EXTRACT(DOW FROM bh.holiday_date) NOT IN (0, 6);

  -- ========================================================================
  -- 4. Total workdays in month (weekdays minus holidays)
  -- ========================================================================
  SELECT COUNT(*)::INTEGER
  INTO v_total_wd
  FROM generate_series(v_month_start, v_month_end, '1 day'::INTERVAL) d(day)
  WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
    AND NOT EXISTS (
      SELECT 1 FROM bulgarian_holidays bh
      WHERE bh.holiday_date = d.day::DATE
    );

  -- ========================================================================
  -- 5. Completed workdays (month start through yesterday)
  --    - Future month: 0
  --    - Past month: total_workdays
  --    - Current month: workdays from month start to (today - 1)
  -- ========================================================================
  IF v_today <= v_month_start THEN
    -- Future month (or today is first day of month = no completed days yet)
    v_completed_wd := 0;
  ELSIF v_today > v_month_end THEN
    -- Past month — fully completed
    v_completed_wd := v_total_wd;
  ELSE
    -- Current month — count workdays from month start through yesterday
    SELECT COUNT(*)::INTEGER
    INTO v_completed_wd
    FROM generate_series(v_month_start, (v_today - INTERVAL '1 day')::DATE, '1 day'::INTERVAL) d(day)
    WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
      AND NOT EXISTS (
        SELECT 1 FROM bulgarian_holidays bh
        WHERE bh.holiday_date = d.day::DATE
      );
  END IF;

  -- ========================================================================
  -- 6. Remaining workdays (today through month end)
  --    - Past month: 0
  --    - Future month: total_workdays
  --    - Current month: workdays from today through month end
  -- ========================================================================
  IF v_today > v_month_end THEN
    v_remaining_wd := 0;
  ELSIF v_today <= v_month_start THEN
    v_remaining_wd := v_total_wd;
  ELSE
    SELECT COUNT(*)::INTEGER
    INTO v_remaining_wd
    FROM generate_series(v_today, v_month_end, '1 day'::INTERVAL) d(day)
    WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
      AND NOT EXISTS (
        SELECT 1 FROM bulgarian_holidays bh
        WHERE bh.holiday_date = d.day::DATE
      );
  END IF;

  -- ========================================================================
  -- 7. Average daily revenue (based on completed workdays)
  -- ========================================================================
  IF v_completed_wd > 0 THEN
    v_avg_daily_earned := (v_earned_cents / v_completed_wd);
    v_avg_daily_billed := (v_combined_cents / v_completed_wd);
  ELSE
    v_avg_daily_earned := 0;
    v_avg_daily_billed := 0;
  END IF;

  -- ========================================================================
  -- 8. Return all metrics
  -- ========================================================================
  RETURN QUERY SELECT
    v_combined_cents,
    v_earned_cents,
    v_avg_daily_earned,
    v_avg_daily_billed,
    v_total_wd,
    v_completed_wd,
    v_remaining_wd,
    v_holiday_count,
    v_earned_cents  + (v_avg_daily_earned * v_remaining_wd),
    v_combined_cents + (v_avg_daily_billed * v_remaining_wd);
END;
$$;

COMMENT ON FUNCTION get_investor_dashboard_metrics(DATE) IS
  'Returns pre-calculated investor dashboard metrics for a given month: '
  'combined revenue, earned revenue, daily averages, workday counts, '
  'holiday count, and projected revenues. Replaces frontend calculations.';

GRANT EXECUTE ON FUNCTION get_investor_dashboard_metrics TO authenticated, service_role;
