-- ============================================================================
-- Migration 076: Fix Investor Dashboard Avg Daily Revenue Calculation
-- ============================================================================
-- Problem: avg_daily_earned_revenue_cents divides TOTAL earned revenue
-- (which includes full-month fixed billings and milestone overrides) by
-- only completed workdays. This inflates the daily average because fixed
-- billings are monthly lump sums booked upfront, not daily accruals.
--
-- Fix: Separate daily-accruing revenue (timesheet billed + carryover/
-- unbillable extra) from monthly lump-sum revenue (fixed billings +
-- milestone overrides). Average daily is computed from daily-accruing
-- revenue only. Projections add the fixed lump sum to the extrapolated
-- daily trend.
--
-- New return column: fixed_lump_revenue_cents (lump-sum portion)
-- ============================================================================

DROP FUNCTION IF EXISTS get_investor_dashboard_metrics(DATE);

CREATE FUNCTION get_investor_dashboard_metrics(p_month DATE)
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
  projected_billed_revenue_cents BIGINT,
  fixed_lump_revenue_cents       BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_month_start DATE;
  v_month_end   DATE;
  v_today       DATE := CURRENT_DATE;

  v_combined_cents         BIGINT;
  v_earned_extra_cents     BIGINT;
  v_earned_cents           BIGINT;
  v_timesheet_revenue_cents BIGINT;
  v_daily_accrual_cents    BIGINT;
  v_fixed_lump_cents       BIGINT;

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
  --    This includes: effective_revenue (timesheet w/ milestone overrides)
  --    + fixed_billing_cents
  -- ========================================================================
  SELECT COALESCE(SUM(cr.combined_revenue_cents), 0)
  INTO v_combined_cents
  FROM v_combined_revenue_by_company_month cr
  WHERE cr.summary_month = v_month_start;

  -- ========================================================================
  -- 2. Timesheet-only billed revenue (daily-accruing, hours * rate)
  --    This is the raw billed_revenue_cents from ALL canonical projects,
  --    before milestone overrides replace any values.
  -- ========================================================================
  SELECT COALESCE(SUM(pms.billed_revenue_cents), 0)
  INTO v_timesheet_revenue_cents
  FROM v_canonical_project_monthly_summary pms
  WHERE pms.summary_month = v_month_start;

  -- ========================================================================
  -- 3. Earned extra = rolled-over/unbillable value for non-milestone
  --    projects (those without milestone_override_cents)
  -- ========================================================================
  SELECT COALESCE(SUM(
    ROUND((pms.carryover_out_hours + pms.unbillable_hours) * pms.rate_used * 100)::BIGINT
  ), 0)
  INTO v_earned_extra_cents
  FROM v_canonical_project_monthly_summary pms
  WHERE pms.summary_month = v_month_start
    AND pms.milestone_override_cents IS NULL;

  -- ========================================================================
  -- 4. Compute daily-accruing vs lump-sum revenue
  --    - Daily accrual: timesheet billed + earned extra (work-based)
  --    - Fixed lump: combined - timesheet (fixed billings + milestone deltas)
  --    - Total earned: combined + earned extra (unchanged from before)
  -- ========================================================================
  v_daily_accrual_cents := v_timesheet_revenue_cents + v_earned_extra_cents;
  v_fixed_lump_cents    := v_combined_cents - v_timesheet_revenue_cents;
  v_earned_cents        := v_combined_cents + v_earned_extra_cents;

  -- ========================================================================
  -- 5. Company holidays (weekday holidays in this month)
  -- ========================================================================
  SELECT COUNT(*)::INTEGER
  INTO v_holiday_count
  FROM bulgarian_holidays bh
  WHERE bh.holiday_date >= v_month_start
    AND bh.holiday_date <= v_month_end
    AND EXTRACT(DOW FROM bh.holiday_date) NOT IN (0, 6);

  -- ========================================================================
  -- 6. Total workdays in month (weekdays minus holidays)
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
  -- 7. Completed workdays (month start through yesterday)
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
  -- 8. Remaining workdays (today through month end)
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
  -- 9. Average daily revenue (daily-accruing revenue only)
  --    Excludes fixed billings and milestone overrides from the average
  --    so that lump sums don't inflate the per-day rate.
  -- ========================================================================
  IF v_completed_wd > 0 THEN
    v_avg_daily_earned := (v_daily_accrual_cents / v_completed_wd);
    v_avg_daily_billed := (v_timesheet_revenue_cents / v_completed_wd);
  ELSE
    v_avg_daily_earned := 0;
    v_avg_daily_billed := 0;
  END IF;

  -- ========================================================================
  -- 10. Return all metrics
  --     Projections: fixed lump (already known) + daily accrual so far
  --     + extrapolated daily trend for remaining workdays.
  --     For past months (remaining = 0): projected = earned/combined.
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
    -- Projected earned: fixed lump + daily accrual so far + trend * remaining
    v_fixed_lump_cents + v_daily_accrual_cents + (v_avg_daily_earned * v_remaining_wd),
    -- Projected billed: fixed lump + timesheet so far + trend * remaining
    v_fixed_lump_cents + v_timesheet_revenue_cents + (v_avg_daily_billed * v_remaining_wd),
    -- Fixed lump revenue (new column)
    v_fixed_lump_cents;
END;
$$;

COMMENT ON FUNCTION get_investor_dashboard_metrics(DATE) IS
  'Returns pre-calculated investor dashboard metrics for a given month: '
  'combined revenue, earned revenue, daily averages (based on daily-accruing '
  'revenue only, excluding fixed billings/milestone lump sums), workday counts, '
  'holiday count, fixed lump revenue, and projected revenues.';

GRANT EXECUTE ON FUNCTION get_investor_dashboard_metrics TO authenticated, service_role;
