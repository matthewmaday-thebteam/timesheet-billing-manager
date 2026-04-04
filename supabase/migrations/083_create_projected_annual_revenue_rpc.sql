-- ============================================================================
-- Migration 083: Create get_projected_annual_revenue() RPC
-- ============================================================================
-- Purpose: Single source of truth for the "Projected Annual Revenue" metric
-- shown on both the Investor Dashboard and the main Dashboard page.
--
-- Replicates the EXACT formula from InvestorDashboardPage.tsx lines 365-418:
--
--   projectedAnnualRevenue = ytdRevenue
--     + (avgDailyRevenue * remainingYearWorkdays)
--     - (ftVacationDays * 8 * avgRate)
--     - (ptVacationDays * 5 * avgRate)
--
-- Where:
--   ytdRevenue          = sum of combined_revenue_cents for all months in current year
--                          from v_combined_revenue_by_company_month (converted to dollars)
--   avgDailyRevenue     = current month's earned daily-accrual revenue / completed workdays
--                          (same as get_investor_dashboard_metrics avg_daily_earned_revenue_cents)
--   remainingYearWorkdays = weekdays from today through Dec 31 minus bulgarian_holidays
--   ftVacationDays      = remaining-year PTO working days for Full-time employees
--   ptVacationDays      = remaining-year PTO working days for Part-time employees
--   avgRate             = AVG(effective_rate) across canonical projects where rate > 0
--                          (same as Rates page average from get_all_project_rates_for_month)
--
-- Revenue is stored in CENTS in the database. This function returns cents.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_projected_annual_revenue()
RETURNS TABLE (
  projected_annual_revenue_cents BIGINT,
  ytd_revenue_cents              BIGINT,
  avg_daily_revenue_cents        BIGINT,
  remaining_year_workdays        INTEGER,
  ft_vacation_days               INTEGER,
  pt_vacation_days               INTEGER,
  avg_rate                       NUMERIC,
  completed_workdays             INTEGER
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_today           DATE := CURRENT_DATE;
  v_current_year    INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_year_start      DATE := MAKE_DATE(v_current_year, 1, 1);
  v_year_end        DATE := MAKE_DATE(v_current_year, 12, 31);
  v_month_start     DATE := DATE_TRUNC('month', v_today)::DATE;
  v_month_end       DATE := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  -- YTD Revenue (cents)
  v_ytd_revenue_cents BIGINT;

  -- Current month metrics (replicating get_investor_dashboard_metrics logic)
  v_combined_cents         BIGINT;
  v_timesheet_revenue_cents BIGINT;
  v_earned_extra_cents     BIGINT;
  v_daily_accrual_cents    BIGINT;
  v_completed_wd           INTEGER;
  v_avg_daily_earned       BIGINT;

  -- Remaining year workdays
  v_remaining_year_wd INTEGER;

  -- Vacation days
  v_ft_vac_days INTEGER;
  v_pt_vac_days INTEGER;

  -- Average rate
  v_avg_rate NUMERIC;

  -- Final projection
  v_projected_cents BIGINT;
BEGIN
  -- ========================================================================
  -- 1. YTD Revenue: sum of combined_revenue_cents for all months in current year
  --    This matches InvestorDashboardPage's ytdRevenue calculation which sums
  --    combinedRevenueByMonth entries where key starts with current year prefix.
  --    combinedRevenueByMonth comes from v_combined_revenue_by_company_month.
  -- ========================================================================
  SELECT COALESCE(SUM(cr.combined_revenue_cents), 0)
  INTO v_ytd_revenue_cents
  FROM v_combined_revenue_by_company_month cr
  WHERE cr.summary_month >= v_year_start
    AND cr.summary_month <= v_month_end;

  -- ========================================================================
  -- 2. Average Daily Revenue for current month
  --    Replicates the same logic as get_investor_dashboard_metrics (migration 076):
  --    daily accrual = timesheet billed + earned extra (carryover/unbillable)
  --    avg daily = daily_accrual_cents / completed_workdays
  -- ========================================================================

  -- 2a. Combined (billed) revenue for current month
  SELECT COALESCE(SUM(cr.combined_revenue_cents), 0)
  INTO v_combined_cents
  FROM v_combined_revenue_by_company_month cr
  WHERE cr.summary_month = v_month_start;

  -- 2b. Timesheet-only billed revenue for current month
  SELECT COALESCE(SUM(pms.billed_revenue_cents), 0)
  INTO v_timesheet_revenue_cents
  FROM v_canonical_project_monthly_summary pms
  WHERE pms.summary_month = v_month_start;

  -- 2c. Earned extra (carryover/unbillable for non-milestone projects)
  SELECT COALESCE(SUM(
    ROUND((pms.carryover_out_hours + pms.unbillable_hours) * pms.rate_used * 100)::BIGINT
  ), 0)
  INTO v_earned_extra_cents
  FROM v_canonical_project_monthly_summary pms
  WHERE pms.summary_month = v_month_start
    AND pms.milestone_override_cents IS NULL;

  -- 2d. Daily accrual = timesheet + earned extra
  v_daily_accrual_cents := v_timesheet_revenue_cents + v_earned_extra_cents;

  -- 2e. Completed workdays in current month (month start through yesterday)
  IF v_today <= v_month_start THEN
    v_completed_wd := 0;
  ELSE
    SELECT COUNT(*)::INTEGER
    INTO v_completed_wd
    FROM generate_series(v_month_start, (v_today - INTERVAL '1 day')::DATE, '1 day'::INTERVAL) d(day)
    WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
      AND NOT EXISTS (
        SELECT 1 FROM bulgarian_holidays bh
        WHERE bh.holiday_date = d.day::DATE
      );
  END IF;

  -- 2f. Average daily earned revenue
  IF v_completed_wd > 0 THEN
    v_avg_daily_earned := v_daily_accrual_cents / v_completed_wd;
  ELSE
    v_avg_daily_earned := 0;
  END IF;

  -- ========================================================================
  -- 3. Remaining Year Workdays (today through Dec 31, minus holidays)
  --    Matches InvestorDashboardPage's remainingYearWorkdays calculation
  --    which uses eachDayOfInterval({ start: yearStart, end: yearEnd })
  --    where yearStart = new Date() and yearEnd = Dec 31.
  -- ========================================================================
  SELECT COUNT(*)::INTEGER
  INTO v_remaining_year_wd
  FROM generate_series(v_today, v_year_end, '1 day'::INTERVAL) d(day)
  WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
    AND NOT EXISTS (
      SELECT 1 FROM bulgarian_holidays bh
      WHERE bh.holiday_date = d.day::DATE
    );

  -- ========================================================================
  -- 4. Remaining Vacation Days by Employment Type
  --    Matches InvestorDashboardPage's ftVacationDays/ptVacationDays calculation.
  --    Counts PTO working days (excluding weekends and holidays) from today
  --    through Dec 31 for Full-time and Part-time employees.
  --
  --    The frontend matches time-off records to employees by comparing:
  --    - to.employee_name === displayName (first_name + ' ' + last_name)
  --    - to.resource_id === employee.id
  --    We replicate both matching strategies here.
  -- ========================================================================
  WITH employee_pto AS (
    SELECT
      eto.id AS time_off_id,
      eto.start_date,
      eto.end_date,
      CASE
        WHEN et.name = 'Full-time' THEN 'FT'
        WHEN et.name = 'Part-time' THEN 'PT'
      END AS emp_type
    FROM employee_time_off eto
    JOIN v_employee_table_entities vete
      ON (
        -- Match by resource_id (same as to.resource_id === employee.id)
        eto.resource_id = vete.id
        OR
        -- Match by employee_name (same as to.employee_name === displayName)
        eto.employee_name = TRIM(COALESCE(vete.first_name, '') || ' ' || COALESCE(vete.last_name, ''))
      )
    JOIN employment_types et ON et.id = vete.employment_type_id
    WHERE et.name IN ('Full-time', 'Part-time')
      AND eto.status = 'approved'
      -- Time-off overlaps with today through year end
      AND eto.start_date <= v_year_end::TEXT
      AND eto.end_date >= v_today::TEXT
  ),
  pto_workdays AS (
    SELECT
      ep.emp_type,
      d.day::DATE AS pto_day
    FROM employee_pto ep
    CROSS JOIN LATERAL generate_series(
      GREATEST(ep.start_date::DATE, v_today),
      LEAST(ep.end_date::DATE, v_year_end),
      '1 day'::INTERVAL
    ) d(day)
    WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
      AND NOT EXISTS (
        SELECT 1 FROM bulgarian_holidays bh
        WHERE bh.holiday_date = d.day::DATE
      )
  )
  SELECT
    COALESCE(SUM(CASE WHEN emp_type = 'FT' THEN 1 ELSE 0 END), 0)::INTEGER,
    COALESCE(SUM(CASE WHEN emp_type = 'PT' THEN 1 ELSE 0 END), 0)::INTEGER
  INTO v_ft_vac_days, v_pt_vac_days
  FROM pto_workdays;

  -- ========================================================================
  -- 5. Average Rate across canonical projects with rate > 0
  --    Matches InvestorDashboardPage's rateMetrics.averageRate calculation:
  --    for (const project of projectsWithRates) {
  --      if (project.effectiveRate > 0) { totalRate += project.effectiveRate; ratedCount++; }
  --    }
  --    averageRate = totalRate / ratedCount;
  --
  --    projectsWithRates comes from get_all_project_rates_for_month(currentMonth)
  --    which returns effective_rate for canonical projects only.
  -- ========================================================================
  SELECT COALESCE(AVG(sub.effective_rate), 0)
  INTO v_avg_rate
  FROM get_all_project_rates_for_month(v_month_start) sub
  WHERE sub.effective_rate > 0;

  -- ========================================================================
  -- 6. Compute projected annual revenue
  --    projectedAnnualRevenue = ytdRevenue
  --      + (avgDailyRevenue * remainingYearWorkdays)
  --      - (ftVacationDays * 8 * avgRate)
  --      - (ptVacationDays * 5 * avgRate)
  --
  --    NOTE: ytdRevenue and avgDailyRevenue are in cents.
  --    avgRate is in dollars (e.g., 45.00).
  --    The vacation deduction must also be in cents:
  --      ftVacationDays * 8 * avgRate * 100 (convert dollars to cents)
  -- ========================================================================
  v_projected_cents := v_ytd_revenue_cents
    + (v_avg_daily_earned * v_remaining_year_wd)
    - ROUND(v_ft_vac_days * 8 * v_avg_rate * 100)::BIGINT
    - ROUND(v_pt_vac_days * 5 * v_avg_rate * 100)::BIGINT;

  -- ========================================================================
  -- 7. Return all components for debugging and the final value
  -- ========================================================================
  RETURN QUERY SELECT
    v_projected_cents,
    v_ytd_revenue_cents,
    v_avg_daily_earned,
    v_remaining_year_wd,
    v_ft_vac_days,
    v_pt_vac_days,
    v_avg_rate,
    v_completed_wd;
END;
$$;

COMMENT ON FUNCTION get_projected_annual_revenue() IS
  'Returns the projected annual revenue and its intermediate components. '
  'Single source of truth for chart bands (+/- 15%) on Dashboard and Investor Dashboard. '
  'Replicates the formula: ytdRevenue + (avgDailyRevenue * remainingYearWorkdays) '
  '- (ftVacationDays * 8 * avgRate) - (ptVacationDays * 5 * avgRate).';

GRANT EXECUTE ON FUNCTION get_projected_annual_revenue TO authenticated, service_role;
