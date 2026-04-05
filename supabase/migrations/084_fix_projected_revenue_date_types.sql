-- ============================================================================
-- Migration 084: Fix date type mismatch in get_projected_annual_revenue()
-- ============================================================================
-- employee_time_off.start_date and end_date are TEXT (ISO strings),
-- not DATE. Fix comparisons to use TEXT and cast to DATE where needed.
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

  v_ytd_revenue_cents BIGINT;
  v_combined_cents         BIGINT;
  v_timesheet_revenue_cents BIGINT;
  v_earned_extra_cents     BIGINT;
  v_daily_accrual_cents    BIGINT;
  v_completed_wd           INTEGER;
  v_avg_daily_earned       BIGINT;
  v_remaining_year_wd INTEGER;
  v_ft_vac_days INTEGER;
  v_pt_vac_days INTEGER;
  v_avg_rate NUMERIC;
  v_projected_cents BIGINT;
BEGIN
  -- 1. YTD Revenue
  SELECT COALESCE(SUM(cr.combined_revenue_cents), 0)
  INTO v_ytd_revenue_cents
  FROM v_combined_revenue_by_company_month cr
  WHERE cr.summary_month >= v_year_start
    AND cr.summary_month <= v_month_end;

  -- 2. Average Daily Revenue for current month
  SELECT COALESCE(SUM(cr.combined_revenue_cents), 0)
  INTO v_combined_cents
  FROM v_combined_revenue_by_company_month cr
  WHERE cr.summary_month = v_month_start;

  SELECT COALESCE(SUM(pms.billed_revenue_cents), 0)
  INTO v_timesheet_revenue_cents
  FROM v_canonical_project_monthly_summary pms
  WHERE pms.summary_month = v_month_start;

  SELECT COALESCE(SUM(
    ROUND((pms.carryover_out_hours + pms.unbillable_hours) * pms.rate_used * 100)::BIGINT
  ), 0)
  INTO v_earned_extra_cents
  FROM v_canonical_project_monthly_summary pms
  WHERE pms.summary_month = v_month_start
    AND pms.milestone_override_cents IS NULL;

  v_daily_accrual_cents := v_timesheet_revenue_cents + v_earned_extra_cents;

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

  IF v_completed_wd > 0 THEN
    v_avg_daily_earned := v_daily_accrual_cents / v_completed_wd;
  ELSE
    v_avg_daily_earned := 0;
  END IF;

  -- 3. Remaining Year Workdays
  SELECT COUNT(*)::INTEGER
  INTO v_remaining_year_wd
  FROM generate_series(v_today, v_year_end, '1 day'::INTERVAL) d(day)
  WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
    AND NOT EXISTS (
      SELECT 1 FROM bulgarian_holidays bh
      WHERE bh.holiday_date = d.day::DATE
    );

  -- 4. Vacation Days by Employment Type
  --    employee_time_off.start_date/end_date are TEXT (ISO strings)
  WITH employee_pto AS (
    SELECT
      eto.id AS time_off_id,
      eto.start_date::DATE AS start_dt,
      eto.end_date::DATE AS end_dt,
      CASE
        WHEN et.name = 'Full-time' THEN 'FT'
        WHEN et.name = 'Part-time' THEN 'PT'
      END AS emp_type
    FROM employee_time_off eto
    JOIN v_employee_table_entities vete
      ON (
        eto.resource_id = vete.id
        OR eto.employee_name = TRIM(COALESCE(vete.first_name, '') || ' ' || COALESCE(vete.last_name, ''))
      )
    JOIN employment_types et ON et.id = vete.employment_type_id
    WHERE et.name IN ('Full-time', 'Part-time')
      AND eto.status = 'approved'
      AND eto.start_date::DATE <= v_year_end
      AND eto.end_date::DATE >= v_today
  ),
  pto_workdays AS (
    SELECT
      ep.emp_type,
      d.day::DATE AS pto_day
    FROM employee_pto ep
    CROSS JOIN LATERAL generate_series(
      GREATEST(ep.start_dt, v_today),
      LEAST(ep.end_dt, v_year_end),
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

  -- 5. Average Rate
  SELECT COALESCE(AVG(sub.effective_rate), 0)
  INTO v_avg_rate
  FROM get_all_project_rates_for_month(v_month_start) sub
  WHERE sub.effective_rate > 0;

  -- 6. Compute projected annual revenue
  v_projected_cents := v_ytd_revenue_cents
    + (v_avg_daily_earned * v_remaining_year_wd)
    - ROUND(v_ft_vac_days * 8 * v_avg_rate * 100)::BIGINT
    - ROUND(v_pt_vac_days * 5 * v_avg_rate * 100)::BIGINT;

  -- 7. Return
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
