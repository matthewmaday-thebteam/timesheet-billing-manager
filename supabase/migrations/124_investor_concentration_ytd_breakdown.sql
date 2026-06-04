-- ============================================================================
-- Migration 124: Investor Concentration — YTD-Consistent Breakdown (Additive)
-- ============================================================================
-- PURPOSE: Fix a single inconsistency in get_investor_concentration (last set in
--   migration 123). The headline concentration cards (row_kind='ytd') summarize
--   calendar-YEAR-TO-DATE completed months, but the per-company breakdown rows
--   (row_kind='breakdown') that feed the "Revenue by Client" bar chart were
--   computed over ONLY the latest completed month. A client with large YTD
--   revenue but a light most-recent month (e.g. FoodCycle Science — #2 YTD at
--   ~$87,187) therefore vanished from the breakdown list/bar even though it is a
--   top concentration driver for the year.
--
--   THE ONE CHANGE: the row_kind='breakdown' rows now aggregate per-company over
--   the SAME calendar-YTD completed-month window already used by the row_kind='ytd'
--   row:
--       summary_month >= date_trunc('year',  CURRENT_DATE)
--       AND summary_month <  date_trunc('month', CURRENT_DATE)   -- exclude current
--   They return the top N companies by YTD combined revenue plus an 'Other'
--   rollup, with revenue_cents = the company's YTD combined revenue and
--   pct = company_ytd / ytd_total. Top-N + Other therefore sums to 100% of the
--   YTD grand total (the same denominator as the 'ytd' row's total_revenue_cents).
--
--   EVERYTHING ELSE IS BYTE-FOR-BYTE THE MIGRATION 123 BEHAVIOR:
--     - row_kind='trend' (per-month top1_pct/top5_pct/total) is UNCHANGED.
--     - row_kind='ytd' (top1_pct/top5_pct over calendar-YTD completed months) is
--       UNCHANGED.
--     - Function signature + RETURNS TABLE columns are IDENTICAL, so the read
--       hook is unaffected. Its `latest` array (built from the breakdown rows)
--       now simply carries YTD figures instead of latest-month figures.
--
--   get_investor_revenue_mix is NOT touched by this migration (it remains exactly
--   as migration 123 left it).
--
-- DEPLOYMENT: Applied via the Supabase Management API (SQL endpoint), matching
--   the project's established migration workflow. PURELY ADDITIVE — this file only
--   CREATE-OR-REPLACEs one existing function via a NEW migration; it does NOT edit
--   any previously-applied migration file, table, or view.
--
-- SECURITY (identical to migration 123 / 122 / 076 / 065 pattern, preserved):
--   - Function is STABLE and SET search_path = public.
--   - EXECUTE granted to authenticated + service_role.
--   - EXECUTE revoked from PUBLIC.
--
-- CORRECTNESS (financial audit invariants preserved):
--   - Revenue sourced ONLY from the canonical, member-excluded view
--     v_combined_revenue_by_company_month (migration 050). The raw
--     project_monthly_summary table is NEVER queried (member leakage).
--   - The in-progress CURRENT month is excluded from ALL trend / breakdown / YTD
--     outputs (matches migration 122/123 behavior).
--   - All money is integer cents; all percentages are div-by-zero guarded.
--   - NULL company_name is labeled 'Unassigned' (never dropped, never null) so the
--     breakdown total reconciles exactly with the YTD grand total.
--
-- ----------------------------------------------------------------------------
-- DOWN (rollback) — restores the migration 123 definition of
--   get_investor_concentration verbatim. (Provided at the END of this file,
--   commented, to keep this BEGIN/COMMIT a pure forward migration; run the DOWN
--   block to revert.)
-- ============================================================================

BEGIN;

-- ============================================================================
-- get_investor_concentration — YTD-consistent breakdown
-- ============================================================================
-- UNCHANGED from 123: row_kind='trend' (per-month) and row_kind='ytd'
--   (top1/top5 over calendar-YTD completed months).
-- CHANGED from 123: row_kind='breakdown' now aggregates per-company over the
--   calendar-YTD completed-month window (identical to the 'ytd' window) instead
--   of only the latest completed month. Top N companies by YTD combined revenue
--   + an 'Other' rollup; pct = company_ytd / ytd_total. NULL company_name -> 'Unassigned'.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_investor_concentration(date, date, integer);

CREATE FUNCTION get_investor_concentration(
  p_start date DEFAULT NULL,
  p_end   date DEFAULT NULL,
  p_top_n integer DEFAULT 6
)
RETURNS TABLE (
  row_kind            text,
  summary_month       date,
  company_name        text,
  revenue_cents       bigint,
  pct                 numeric,
  top1_pct            numeric,
  top5_pct            numeric,
  total_revenue_cents bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      DATE_TRUNC('month', COALESCE(p_start, '1900-01-01'::date))::date AS lo,
      DATE_TRUNC('month', COALESCE(p_end,   CURRENT_DATE))::date       AS hi,
      DATE_TRUNC('month', CURRENT_DATE)::date                          AS cur,
      DATE_TRUNC('year',  CURRENT_DATE)::date                          AS yr
  ),
  company_month AS (
    SELECT
      cr.summary_month,
      cr.company_name,
      SUM(cr.combined_revenue_cents) AS revenue_cents
    FROM v_combined_revenue_by_company_month cr
    CROSS JOIN bounds b
    WHERE cr.summary_month BETWEEN b.lo AND b.hi
      AND cr.summary_month < b.cur
    GROUP BY cr.summary_month, cr.company_name
  ),
  ranked AS (
    SELECT
      cm.*,
      ROW_NUMBER() OVER (PARTITION BY cm.summary_month ORDER BY cm.revenue_cents DESC) AS rn,
      SUM(cm.revenue_cents) OVER (PARTITION BY cm.summary_month) AS month_total
    FROM company_month cm
  ),
  -- TREND: top1 / top5 share per month (UNCHANGED from migration 123 / 122)
  trend AS (
    SELECT
      r.summary_month,
      MAX(r.month_total) AS total_revenue_cents,
      CASE WHEN MAX(r.month_total) <> 0
        THEN ROUND(SUM(r.revenue_cents) FILTER (WHERE r.rn = 1)::numeric * 100.0 / MAX(r.month_total), 2)
        ELSE NULL END AS top1_pct,
      CASE WHEN MAX(r.month_total) <> 0
        THEN ROUND(SUM(r.revenue_cents) FILTER (WHERE r.rn <= 5)::numeric * 100.0 / MAX(r.month_total), 2)
        ELSE NULL END AS top5_pct
    FROM ranked r
    GROUP BY r.summary_month
  ),
  -- ==========================================================================
  -- YTD per-company aggregation over calendar-YTD COMPLETED months. This single
  -- aggregation now feeds BOTH the row_kind='ytd' summary AND the
  -- row_kind='breakdown' per-company slice, guaranteeing they share one
  -- denominator (ytd_total) and one window. INDEPENDENT of p_start/p_end
  -- (calendar year-to-date by definition). Sourced from the canonical,
  -- member-excluded view. NULL company_name -> 'Unassigned' (never dropped).
  -- ==========================================================================
  ytd_company AS (
    SELECT
      COALESCE(cr.company_name, 'Unassigned') AS company_name,
      SUM(cr.combined_revenue_cents) AS revenue_cents
    FROM v_combined_revenue_by_company_month cr
    CROSS JOIN bounds b
    WHERE cr.summary_month >= b.yr
      AND cr.summary_month <  b.cur            -- calendar-YTD, completed months only
    GROUP BY COALESCE(cr.company_name, 'Unassigned')
  ),
  ytd_ranked AS (
    SELECT
      yc.company_name,
      yc.revenue_cents,
      ROW_NUMBER() OVER (ORDER BY yc.revenue_cents DESC) AS rn,
      SUM(yc.revenue_cents) OVER () AS ytd_total
    FROM ytd_company yc
  ),
  -- YTD summary row (top1 / top5 share) — UNCHANGED semantics from migration 123.
  ytd AS (
    SELECT
      MAX(yr.ytd_total) AS total_revenue_cents,
      CASE WHEN MAX(yr.ytd_total) <> 0
        THEN ROUND(SUM(yr.revenue_cents) FILTER (WHERE yr.rn = 1)::numeric * 100.0 / MAX(yr.ytd_total), 2)
        ELSE NULL END AS top1_pct,
      CASE WHEN MAX(yr.ytd_total) <> 0
        THEN ROUND(SUM(yr.revenue_cents) FILTER (WHERE yr.rn <= 5)::numeric * 100.0 / MAX(yr.ytd_total), 2)
        ELSE NULL END AS top5_pct
    FROM ytd_ranked yr
  ),
  -- BREAKDOWN (CHANGED): top N companies by YTD combined revenue + 'Other'
  -- rollup, over the SAME calendar-YTD window as the 'ytd' row above. The
  -- breakdown rows carry summary_month = year start (date_trunc('year',
  -- CURRENT_DATE)) so they are unambiguously a YTD slice, revenue_cents = the
  -- company's YTD combined revenue, and total_revenue_cents = the YTD grand
  -- total. Top-N + Other therefore sum to 100% of total_revenue_cents.
  breakdown_top AS (
    SELECT
      (SELECT yr FROM bounds) AS summary_month,
      yr.company_name,
      yr.revenue_cents,
      yr.ytd_total AS month_total
    FROM ytd_ranked yr
    WHERE yr.rn <= p_top_n
  ),
  breakdown_other AS (
    SELECT
      (SELECT yr FROM bounds) AS summary_month,
      'Other'::text AS company_name,
      SUM(yr.revenue_cents) AS revenue_cents,
      MAX(yr.ytd_total) AS month_total
    FROM ytd_ranked yr
    WHERE yr.rn > p_top_n
    GROUP BY (SELECT yr FROM bounds)
    HAVING SUM(yr.revenue_cents) > 0
  ),
  breakdown AS (
    SELECT * FROM breakdown_top
    UNION ALL
    SELECT * FROM breakdown_other
  )
  SELECT
    'trend'::text AS row_kind,
    t.summary_month,
    NULL::text AS company_name,
    NULL::bigint AS revenue_cents,
    NULL::numeric AS pct,
    t.top1_pct,
    t.top5_pct,
    t.total_revenue_cents
  FROM trend t
  UNION ALL
  SELECT
    'breakdown'::text AS row_kind,
    bd.summary_month,
    bd.company_name,
    bd.revenue_cents,
    CASE WHEN bd.month_total <> 0
      THEN ROUND(bd.revenue_cents::numeric * 100.0 / bd.month_total, 2)
      ELSE NULL END AS pct,
    NULL::numeric AS top1_pct,
    NULL::numeric AS top5_pct,
    bd.month_total AS total_revenue_cents
  FROM breakdown bd
  UNION ALL
  SELECT
    'ytd'::text AS row_kind,
    (SELECT yr FROM bounds) AS summary_month,   -- date_trunc('year', CURRENT_DATE)
    NULL::text AS company_name,
    NULL::bigint AS revenue_cents,
    NULL::numeric AS pct,
    y.top1_pct,
    y.top5_pct,
    y.total_revenue_cents
  FROM ytd y
  ORDER BY row_kind, summary_month, revenue_cents DESC NULLS LAST;
$$;

COMMENT ON FUNCTION get_investor_concentration(date, date, integer) IS
  'Client concentration (migration 124). row_kind=trend: per-month '
  'top1_pct/top5_pct/total (unchanged from 123). row_kind=breakdown: per-company '
  'slice (top N + Other) over calendar-YTD completed months — CHANGED in 124 from '
  'the latest completed month to the YTD window so it matches the ytd row; '
  'revenue_cents = company YTD combined revenue, pct = company_ytd / ytd_total, '
  'and top-N+Other sum to 100%. row_kind=ytd: top1_pct/top5_pct over calendar-YTD '
  'completed months (unchanged from 123). YTD window = summary_month >= '
  'date_trunc(year, CURRENT_DATE) and < date_trunc(month, CURRENT_DATE); breakdown '
  'and ytd rows carry summary_month = year start, total_revenue_cents = YTD grand '
  'total. NULL company_name is labeled ''Unassigned''. All revenue from '
  'v_combined_revenue_by_company_month (canonical, member-excluded). Excludes the '
  'in-progress current month. Signature and return columns identical to 123 (hook '
  'unaffected; its latest array now carries YTD figures).';

GRANT EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) FROM PUBLIC;

-- ============================================================================
-- Verification (read-only; no data mutation)
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 124 Complete (additive CREATE OR REPLACE of one RPC):';
  RAISE NOTICE '  - get_investor_concentration(date, date, integer):';
  RAISE NOTICE '      row_kind=breakdown now aggregates per-company over calendar-YTD';
  RAISE NOTICE '      completed months (top N + Other, sums to 100%% of YTD total).';
  RAISE NOTICE '      row_kind=trend and row_kind=ytd unchanged from migration 123.';
  RAISE NOTICE '  STABLE, search_path=public, EXECUTE to authenticated+service_role, REVOKE from PUBLIC.';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK — restores the migration 123 definition of
-- get_investor_concentration (latest-completed-month breakdown).
-- Run this block (uncommented) to revert migration 124.
-- ============================================================================
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS get_investor_concentration(date, date, integer);
--
-- CREATE FUNCTION get_investor_concentration(
--   p_start date DEFAULT NULL,
--   p_end   date DEFAULT NULL,
--   p_top_n integer DEFAULT 6
-- )
-- RETURNS TABLE (
--   row_kind            text,
--   summary_month       date,
--   company_name        text,
--   revenue_cents       bigint,
--   pct                 numeric,
--   top1_pct            numeric,
--   top5_pct            numeric,
--   total_revenue_cents bigint
-- )
-- LANGUAGE sql
-- STABLE
-- SET search_path = public
-- AS $$
--   WITH bounds AS (
--     SELECT
--       DATE_TRUNC('month', COALESCE(p_start, '1900-01-01'::date))::date AS lo,
--       DATE_TRUNC('month', COALESCE(p_end,   CURRENT_DATE))::date       AS hi,
--       DATE_TRUNC('month', CURRENT_DATE)::date                          AS cur,
--       DATE_TRUNC('year',  CURRENT_DATE)::date                          AS yr
--   ),
--   company_month AS (
--     SELECT
--       cr.summary_month,
--       cr.company_name,
--       SUM(cr.combined_revenue_cents) AS revenue_cents
--     FROM v_combined_revenue_by_company_month cr
--     CROSS JOIN bounds b
--     WHERE cr.summary_month BETWEEN b.lo AND b.hi
--       AND cr.summary_month < b.cur
--     GROUP BY cr.summary_month, cr.company_name
--   ),
--   ranked AS (
--     SELECT
--       cm.*,
--       ROW_NUMBER() OVER (PARTITION BY cm.summary_month ORDER BY cm.revenue_cents DESC) AS rn,
--       SUM(cm.revenue_cents) OVER (PARTITION BY cm.summary_month) AS month_total
--     FROM company_month cm
--   ),
--   trend AS (
--     SELECT
--       r.summary_month,
--       MAX(r.month_total) AS total_revenue_cents,
--       CASE WHEN MAX(r.month_total) <> 0
--         THEN ROUND(SUM(r.revenue_cents) FILTER (WHERE r.rn = 1)::numeric * 100.0 / MAX(r.month_total), 2)
--         ELSE NULL END AS top1_pct,
--       CASE WHEN MAX(r.month_total) <> 0
--         THEN ROUND(SUM(r.revenue_cents) FILTER (WHERE r.rn <= 5)::numeric * 100.0 / MAX(r.month_total), 2)
--         ELSE NULL END AS top5_pct
--     FROM ranked r
--     GROUP BY r.summary_month
--   ),
--   latest_month AS (
--     SELECT MAX(summary_month) AS m FROM ranked
--   ),
--   latest_ranked AS (
--     SELECT r.*
--     FROM ranked r
--     JOIN latest_month lm ON lm.m = r.summary_month
--   ),
--   breakdown_top AS (
--     SELECT
--       lr.summary_month,
--       lr.company_name,
--       lr.revenue_cents,
--       lr.month_total
--     FROM latest_ranked lr
--     WHERE lr.rn <= p_top_n
--   ),
--   breakdown_other AS (
--     SELECT
--       lr.summary_month,
--       'Other'::text AS company_name,
--       SUM(lr.revenue_cents) AS revenue_cents,
--       MAX(lr.month_total) AS month_total
--     FROM latest_ranked lr
--     WHERE lr.rn > p_top_n
--     GROUP BY lr.summary_month
--     HAVING SUM(lr.revenue_cents) > 0
--   ),
--   breakdown AS (
--     SELECT * FROM breakdown_top
--     UNION ALL
--     SELECT * FROM breakdown_other
--   ),
--   ytd_company AS (
--     SELECT
--       cr.company_name,
--       SUM(cr.combined_revenue_cents) AS revenue_cents
--     FROM v_combined_revenue_by_company_month cr
--     CROSS JOIN bounds b
--     WHERE cr.summary_month >= b.yr
--       AND cr.summary_month <  b.cur
--     GROUP BY cr.company_name
--   ),
--   ytd_ranked AS (
--     SELECT
--       yc.revenue_cents,
--       ROW_NUMBER() OVER (ORDER BY yc.revenue_cents DESC) AS rn,
--       SUM(yc.revenue_cents) OVER () AS ytd_total
--     FROM ytd_company yc
--   ),
--   ytd AS (
--     SELECT
--       MAX(yr.ytd_total) AS total_revenue_cents,
--       CASE WHEN MAX(yr.ytd_total) <> 0
--         THEN ROUND(SUM(yr.revenue_cents) FILTER (WHERE yr.rn = 1)::numeric * 100.0 / MAX(yr.ytd_total), 2)
--         ELSE NULL END AS top1_pct,
--       CASE WHEN MAX(yr.ytd_total) <> 0
--         THEN ROUND(SUM(yr.revenue_cents) FILTER (WHERE yr.rn <= 5)::numeric * 100.0 / MAX(yr.ytd_total), 2)
--         ELSE NULL END AS top5_pct
--     FROM ytd_ranked yr
--   )
--   SELECT
--     'trend'::text AS row_kind,
--     t.summary_month,
--     NULL::text AS company_name,
--     NULL::bigint AS revenue_cents,
--     NULL::numeric AS pct,
--     t.top1_pct,
--     t.top5_pct,
--     t.total_revenue_cents
--   FROM trend t
--   UNION ALL
--   SELECT
--     'breakdown'::text AS row_kind,
--     bd.summary_month,
--     bd.company_name,
--     bd.revenue_cents,
--     CASE WHEN bd.month_total <> 0
--       THEN ROUND(bd.revenue_cents::numeric * 100.0 / bd.month_total, 2)
--       ELSE NULL END AS pct,
--     NULL::numeric AS top1_pct,
--     NULL::numeric AS top5_pct,
--     bd.month_total AS total_revenue_cents
--   FROM breakdown bd
--   UNION ALL
--   SELECT
--     'ytd'::text AS row_kind,
--     (SELECT yr FROM bounds) AS summary_month,
--     NULL::text AS company_name,
--     NULL::bigint AS revenue_cents,
--     NULL::numeric AS pct,
--     y.top1_pct,
--     y.top5_pct,
--     y.total_revenue_cents
--   FROM ytd y
--   ORDER BY row_kind, summary_month, revenue_cents DESC NULLS LAST;
-- $$;
--
-- GRANT EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) TO authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) FROM PUBLIC;
--
-- COMMIT;
