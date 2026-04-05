-- ============================================================================
-- Migration 085: Fix get_projected_annual_revenue() avgDailyRevenue calculation
-- ============================================================================
-- Bug: The RPC computed avgDailyRevenue from monthly summary view totals divided
--      by workdays (~$16,010/day), but the frontend computes it from actual
--      timesheet entries * per-project rates (~$5,983/day). These are
--      fundamentally different calculations yielding $3.3M vs $1.5M projected.
--
-- Fix: Rewrite avgDailyRevenue to compute from timesheet_daily_rollups entries
--      joined with project rates (via canonical project mapping), for current
--      month entries with work_date < today. This matches the frontend's
--      aggregateDailyRevenue() function in chartTransforms.ts.
--
-- Frontend formula (InvestorDashboardPage.tsx):
--   earnedSum = sum of (entry.total_minutes / 60) * projectRate per entry
--              for entries through yesterday (work_date < today)
--   avgDailyRevenue = earnedSum / completedWorkdays
--   projected = ytdRevenue + (avgDailyRevenue * remainingYearWorkdays)
--              - (ftVacDays * 8 * avgRate * 100) - (ptVacDays * 5 * avgRate * 100)
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
  v_earned_sum_cents   BIGINT;
  v_completed_wd       INTEGER;
  v_avg_daily_earned   BIGINT;
  v_remaining_year_wd  INTEGER;
  v_ft_vac_days        INTEGER;
  v_pt_vac_days        INTEGER;
  v_avg_rate           NUMERIC;
  v_projected_cents    BIGINT;
BEGIN
  -- 1. YTD Revenue (unchanged — from combined revenue view)
  SELECT COALESCE(SUM(cr.combined_revenue_cents), 0)
  INTO v_ytd_revenue_cents
  FROM v_combined_revenue_by_company_month cr
  WHERE cr.summary_month >= v_year_start
    AND cr.summary_month <= v_month_end;

  -- 2. Average Daily Revenue for current month — FROM ACTUAL ENTRIES
  --    This matches the frontend's aggregateDailyRevenue() function:
  --    For each timesheet entry in the current month with work_date < today,
  --    earned = (total_minutes / 60.0) * effective_rate for the canonical project.
  --
  --    Join chain:
  --      timesheet_daily_rollups.project_id (TEXT)
  --      -> projects.project_id (TEXT) to get projects.id (UUID)
  --      -> v_project_canonical to get canonical_project_id (UUID)
  --      -> rates from get_all_project_rates_for_month keyed by canonical UUID
  --
  --    Note: We use a subquery on get_all_project_rates_for_month to build
  --    a rate lookup by canonical project UUID. Member projects' entries are
  --    mapped to their primary project's rate via v_project_canonical.

  WITH project_rates AS (
    -- Get effective rate for each canonical project this month
    SELECT
      r.project_id AS canonical_uuid,
      r.effective_rate
    FROM get_all_project_rates_for_month(v_month_start) r
  ),
  entry_earned AS (
    -- Calculate earned revenue per entry for current month, work_date < today
    SELECT
      ROUND((tdr.total_minutes / 60.0) * pr.effective_rate * 100)::BIGINT AS earned_cents
    FROM timesheet_daily_rollups tdr
    -- Map external project_id (TEXT) to projects.id (UUID)
    JOIN projects p ON p.project_id = tdr.project_id
    -- Map to canonical project UUID
    JOIN v_project_canonical vpc ON vpc.project_id = p.id
    -- Get rate for the canonical project
    JOIN project_rates pr ON pr.canonical_uuid = vpc.canonical_project_id
    WHERE tdr.work_date >= v_month_start
      AND tdr.work_date < v_today
      AND tdr.total_minutes > 0
  )
  SELECT COALESCE(SUM(earned_cents), 0)
  INTO v_earned_sum_cents
  FROM entry_earned;

  -- Completed workdays in current month (same as before — month start through yesterday)
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

  -- avgDailyRevenue = earnedSum / completedWorkdays (matching frontend exactly)
  IF v_completed_wd > 0 THEN
    v_avg_daily_earned := v_earned_sum_cents / v_completed_wd;
  ELSE
    v_avg_daily_earned := 0;
  END IF;

  -- 3. Remaining Year Workdays (unchanged)
  SELECT COUNT(*)::INTEGER
  INTO v_remaining_year_wd
  FROM generate_series(v_today, v_year_end, '1 day'::INTERVAL) d(day)
  WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
    AND NOT EXISTS (
      SELECT 1 FROM bulgarian_holidays bh
      WHERE bh.holiday_date = d.day::DATE
    );

  -- 4. Vacation Days by Employment Type (unchanged)
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

  -- 5. Average Rate (unchanged)
  SELECT COALESCE(AVG(sub.effective_rate), 0)
  INTO v_avg_rate
  FROM get_all_project_rates_for_month(v_month_start) sub
  WHERE sub.effective_rate > 0;

  -- 6. Compute projected annual revenue (unchanged formula)
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
