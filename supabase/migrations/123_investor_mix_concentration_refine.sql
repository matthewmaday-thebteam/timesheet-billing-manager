-- ============================================================================
-- Migration 123: Investor Revenue-Mix & Concentration Refinement (Additive)
-- ============================================================================
-- PURPOSE: Refine two investor analytics RPCs introduced in migration 122 to
--   match confirmed product decisions. PURELY ADDITIVE — this migration ONLY
--   CREATE-OR-REPLACEs the two existing functions. It does NOT touch migration
--   122's file, nor any table, view, trigger, or the three other 122 RPCs.
--
--   1. get_investor_revenue_mix(date, date)
--        - Re-cast buckets to the SLA model:
--            * recurring  = hourly / timesheet (SLA) work + recurring fixed
--                           billings (subscription / service_fee / license).
--            * one_off    = milestone overrides (delivery one-offs) + UNLINKED
--                           revenue_milestone billings.
--            * reimbursement = pass-through reimbursement billings.
--        - Drop the old project_cents / one_time_cents columns.
--        - Replace committed_monthly_run_rate with recurring_run_rate_cents =
--          trailing 3-completed-month AVERAGE of recurring_cents.
--
--   2. get_investor_concentration(date, date, integer)
--        - Keep the existing per-month 'trend' rows and latest-month
--          'breakdown' rows EXACTLY as-is.
--        - ADD a single row_kind='ytd' row carrying top1_pct / top5_pct over
--          calendar-YTD completed months.
--
-- DEPLOYMENT: Applied via the Supabase Management API (SQL endpoint), matching
--   the project's established migration workflow. All calculations stay in SQL
--   so the read hooks fetch ready-to-render numbers (no browser arithmetic).
--
-- SECURITY (identical to migration 122 / 076 / 065 pattern, preserved):
--   - Both functions are STABLE and SET search_path = public.
--   - EXECUTE granted to authenticated + service_role.
--   - EXECUTE revoked from PUBLIC.
--
-- CORRECTNESS (financial audit invariants preserved):
--   - Revenue sourced ONLY from canonical, member-excluded views
--     (v_combined_revenue_by_company_month, v_canonical_project_monthly_summary).
--     project_monthly_summary is NEVER queried raw (member leakage).
--   - The in-progress CURRENT month is excluded from ALL trend / YTD outputs
--     (matches migration 122 behavior).
--   - Revenue-mix reconciliation BY CONSTRUCTION (see CHANGE 1 below):
--       recurring_cents + one_off_cents + reimbursement_cents == combined_cents
--     for every completed month. Any residual is surfaced as
--     reconciliation_delta_cents (expected 0); never folded into a bucket.
--
-- ----------------------------------------------------------------------------
-- DOWN (rollback) — restores the migration 122 definitions of BOTH functions
-- verbatim. (Provided at the END of this file, commented, to keep this BEGIN/
-- COMMIT transaction a pure forward migration; run the DOWN block to revert.)
-- ============================================================================

BEGIN;

-- ============================================================================
-- CHANGE 1. REVENUE MIX (SLA model) + TRAILING RECURRING RUN-RATE
-- ============================================================================
-- Bucket re-cast — SLA model (hourly/timesheet work IS recurring; milestones
-- are one-off):
--
--   recurring_cents
--     = Σ effective_revenue for NON-milestone-override canonical projects
--         (milestone_override_cents IS NULL → genuine timesheet/SLA hourly
--          revenue = billed_revenue_cents)
--     + recurring fixed billings (billings.type IN
--         ('subscription','service_fee','license')).
--
--   one_off_cents
--     = Σ milestone_override_cents for milestone-override canonical projects
--         (milestone_override_cents IS NOT NULL → delivery one-off; this is the
--          override that REPLACED the project's timesheet revenue, counted once)
--     + UNLINKED revenue_milestone billings (linked_project_id IS NULL).
--
--   reimbursement_cents
--     = reimbursement billings (pass-through).
--
--   combined_cents              : canonical combined (unchanged); the bucket sum
--                                 target.
--   reconciliation_delta_cents  : combined − (recurring + one_off +
--                                 reimbursement); 0 in steady state.
--
-- WHY IT RECONCILES (by construction):
--   From migration 050 the combined view defines, per canonical project/company:
--     combined = Σ effective + fixed_billing
--     effective = Σ COALESCE(milestone_override_cents, billed_revenue_cents)
--   and from migration 051 Part 3:
--     fixed_billing = ALL billing transactions EXCEPT linked revenue_milestones
--                   = subscription + service_fee + license
--                   + UNLINKED revenue_milestone + reimbursement
--   Splitting effective by the per-project milestone flag (canonical summary):
--     Σ effective (all)  = Σ effective (milestone_override IS NULL)        -- billed_revenue_cents
--                        + Σ milestone_override_cents (override IS NOT NULL)
--   Therefore:
--     recurring + one_off + reimbursement
--       = [Σ effective(non-milestone) + (sub+sf+lic)]
--       + [Σ override(milestone)      + unlinked_rm]
--       + reimbursement
--       = Σ effective(all) + fixed_billing
--       = combined.                                            ∎
--   The milestone split is taken from v_canonical_project_monthly_summary (which
--   exposes the per-project milestone_override_cents flag) so the two halves are
--   sourced consistently with the combined view's effective_revenue_cents.
--
--   GUARD: each bucket is GREATEST(.,0)-guarded so it can never be silently
--   negative; reconciliation_delta surfaces any residual instead of hiding it.
--
-- recurring_run_rate_cents (REPLACES committed_monthly_run_rate):
--   A trailing-AVERAGE estimate of the ongoing recurring base = AVG of
--   recurring_cents over the last 3 COMPLETED months that have data. If fewer
--   than 3 completed months exist, it averages whatever months exist. This is
--   an estimate, not a contractual figure: it reflects the recently-observed
--   recurring run rate (SLA hourly + recurring fixed billings). It is identical
--   on every returned row (a scalar the hook reads off the first row).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_investor_revenue_mix(date, date);

CREATE FUNCTION get_investor_revenue_mix(
  p_start date DEFAULT NULL,
  p_end   date DEFAULT NULL
)
RETURNS TABLE (
  summary_month               date,
  recurring_cents             bigint,
  one_off_cents               bigint,
  reimbursement_cents         bigint,
  combined_cents              bigint,
  reconciliation_delta_cents  bigint,
  recurring_run_rate_cents    bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      DATE_TRUNC('month', COALESCE(p_start, '1900-01-01'::date))::date AS lo,
      DATE_TRUNC('month', COALESCE(p_end,   CURRENT_DATE))::date       AS hi,
      DATE_TRUNC('month', CURRENT_DATE)::date                          AS cur
  ),
  -- Canonical combined revenue per month (authoritative bucket-sum target).
  combined AS (
    SELECT
      cr.summary_month,
      SUM(cr.combined_revenue_cents) AS combined_cents
    FROM v_combined_revenue_by_company_month cr
    CROSS JOIN bounds b
    WHERE cr.summary_month BETWEEN b.lo AND b.hi
      AND cr.summary_month < b.cur                 -- exclude in-progress current month
    GROUP BY cr.summary_month
  ),
  -- Effective revenue split by the per-project milestone flag (canonical,
  -- member-excluded). non_milestone_effective = SLA/timesheet hourly revenue;
  -- milestone_effective = the override that replaced timesheet revenue (one-off).
  effective_split AS (
    SELECT
      cpms.summary_month,
      SUM(cpms.billed_revenue_cents)
        FILTER (WHERE cpms.milestone_override_cents IS NULL)      AS non_milestone_effective_cents,
      SUM(cpms.milestone_override_cents)
        FILTER (WHERE cpms.milestone_override_cents IS NOT NULL)  AS milestone_effective_cents
    FROM v_canonical_project_monthly_summary cpms
    CROSS JOIN bounds b
    WHERE cpms.summary_month BETWEEN b.lo AND b.hi
      AND cpms.summary_month < b.cur
    GROUP BY cpms.summary_month
  ),
  -- Fixed-billing components, partitioned EXACTLY as migration 051 Part 3 derives
  -- fixed_billing_cents (ALL billing types EXCEPT linked revenue_milestones,
  -- whose value lives in the per-project override inside effective revenue).
  --   recurring fixed : subscription / service_fee / license.
  --   unlinked_milestone : revenue_milestone with linked_project_id IS NULL.
  --   reimbursement   : reimbursement (pass-through).
  billing_buckets AS (
    SELECT
      bt.transaction_month AS summary_month,
      SUM(bt.amount_cents) FILTER (
        WHERE bi.type IN ('subscription','service_fee','license')
      ) AS recurring_fixed_cents,
      SUM(bt.amount_cents) FILTER (
        WHERE bi.type = 'revenue_milestone' AND bi.linked_project_id IS NULL
      ) AS unlinked_milestone_cents,
      SUM(bt.amount_cents) FILTER (
        WHERE bi.type = 'reimbursement'
      ) AS reimbursement_cents
    FROM billing_transactions bt
    JOIN billings bi ON bi.id = bt.billing_id
    CROSS JOIN bounds b
    WHERE bt.transaction_month BETWEEN b.lo AND b.hi
      AND bt.transaction_month < b.cur
      -- Mirror 051 Part 3: linked revenue_milestones are NOT part of fixed billing.
      AND NOT (bi.type = 'revenue_milestone' AND bi.linked_project_id IS NOT NULL)
    GROUP BY bt.transaction_month
  ),
  -- Assemble the SLA buckets per completed month.
  per_month AS (
    SELECT
      c.summary_month,
      -- recurring = SLA hourly (non-milestone effective) + recurring fixed billings
      GREATEST(
        COALESCE(es.non_milestone_effective_cents, 0)
          + COALESCE(bb.recurring_fixed_cents, 0), 0
      ) AS recurring_cents,
      -- one_off = milestone overrides (delivery) + unlinked revenue_milestone billings
      GREATEST(
        COALESCE(es.milestone_effective_cents, 0)
          + COALESCE(bb.unlinked_milestone_cents, 0), 0
      ) AS one_off_cents,
      -- reimbursement = pass-through
      GREATEST(COALESCE(bb.reimbursement_cents, 0), 0) AS reimbursement_cents,
      c.combined_cents
    FROM combined c
    LEFT JOIN effective_split es ON es.summary_month = c.summary_month
    LEFT JOIN billing_buckets bb ON bb.summary_month = c.summary_month
  ),
  -- Trailing 3-COMPLETED-month average of recurring_cents (estimate of the
  -- ongoing recurring base). Averages whatever exists if fewer than 3 months.
  run_rate AS (
    SELECT COALESCE(ROUND(AVG(recurring_cents))::bigint, 0) AS cents
    FROM (
      SELECT pm.recurring_cents
      FROM per_month pm
      ORDER BY pm.summary_month DESC
      LIMIT 3
    ) recent
  )
  SELECT
    pm.summary_month,
    pm.recurring_cents,
    pm.one_off_cents,
    pm.reimbursement_cents,
    pm.combined_cents,
    -- Residual (expected 0 when sourced consistently); never folded into a bucket.
    (pm.combined_cents
       - pm.recurring_cents
       - pm.one_off_cents
       - pm.reimbursement_cents) AS reconciliation_delta_cents,
    (SELECT cents FROM run_rate) AS recurring_run_rate_cents
  FROM per_month pm
  ORDER BY pm.summary_month;
$$;

COMMENT ON FUNCTION get_investor_revenue_mix(date, date) IS
  'Revenue mix per completed month under the SLA model (migration 123). '
  'recurring_cents = Σ effective revenue for NON-milestone-override canonical '
  'projects (SLA/timesheet hourly) + recurring fixed billings '
  '(subscription/service_fee/license). one_off_cents = Σ milestone_override_cents '
  'for milestone-override projects (delivery one-offs, counted once) + UNLINKED '
  'revenue_milestone billings. reimbursement_cents = reimbursement (pass-through). '
  'By construction recurring+one_off+reimbursement == combined_cents; any residual '
  'is surfaced as reconciliation_delta_cents (never hidden in a bucket); each '
  'bucket is GREATEST(.,0)-guarded. recurring_run_rate_cents = trailing AVERAGE of '
  'recurring_cents over the last 3 completed months (fewer if less data) — a '
  'trailing-average ESTIMATE of the ongoing recurring base, identical on every '
  'row. Sourced only from canonical member-excluded views; excludes the '
  'in-progress current month.';

GRANT EXECUTE ON FUNCTION get_investor_revenue_mix(date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_revenue_mix(date, date) FROM PUBLIC;

-- ============================================================================
-- CHANGE 2. CLIENT CONCENTRATION + CALENDAR-YTD FIGURES
-- ============================================================================
-- UNCHANGED: the per-month 'trend' rows (top1_pct/top5_pct/total per month) and
-- the latest-completed-month 'breakdown' rows (top N companies + 'Other') are
-- carried over verbatim from migration 122.
--
-- ADDED: a single row_kind='ytd' row carrying top1_pct and top5_pct computed
-- over calendar-YTD COMPLETED months:
--     summary_month >= date_trunc('year', CURRENT_DATE)
--     AND summary_month <  date_trunc('month', CURRENT_DATE)   -- exclude current
--   Sum each company's combined_revenue over that window, then:
--     top1_pct = (max company total) / (grand total) * 100
--     top5_pct = (sum of top 5 company totals) / (grand total) * 100
--   All from v_combined_revenue_by_company_month (canonical, member-excluded).
--   The ytd row carries summary_month = date_trunc('year', CURRENT_DATE) and
--   total_revenue_cents = the YTD grand total; company_name/revenue_cents/pct are
--   NULL (it is a summary row, like 'trend'). The YTD window is INDEPENDENT of
--   p_start/p_end (calendar year-to-date by definition).
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
  -- TREND: top1 / top5 share per month (UNCHANGED from migration 122)
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
  latest_month AS (
    SELECT MAX(summary_month) AS m FROM ranked
  ),
  -- BREAKDOWN: latest completed month, top N companies + 'Other' (UNCHANGED)
  latest_ranked AS (
    SELECT r.*
    FROM ranked r
    JOIN latest_month lm ON lm.m = r.summary_month
  ),
  breakdown_top AS (
    SELECT
      lr.summary_month,
      lr.company_name,
      lr.revenue_cents,
      lr.month_total
    FROM latest_ranked lr
    WHERE lr.rn <= p_top_n
  ),
  breakdown_other AS (
    SELECT
      lr.summary_month,
      'Other'::text AS company_name,
      SUM(lr.revenue_cents) AS revenue_cents,
      MAX(lr.month_total) AS month_total
    FROM latest_ranked lr
    WHERE lr.rn > p_top_n
    GROUP BY lr.summary_month
    HAVING SUM(lr.revenue_cents) > 0
  ),
  breakdown AS (
    SELECT * FROM breakdown_top
    UNION ALL
    SELECT * FROM breakdown_other
  ),
  -- YTD (ADDED): per-company combined revenue over calendar-YTD completed months,
  -- INDEPENDENT of p_start/p_end. Sourced from the same canonical member-excluded
  -- view. top1 = largest company / total; top5 = sum of top 5 / total.
  ytd_company AS (
    SELECT
      cr.company_name,
      SUM(cr.combined_revenue_cents) AS revenue_cents
    FROM v_combined_revenue_by_company_month cr
    CROSS JOIN bounds b
    WHERE cr.summary_month >= b.yr
      AND cr.summary_month <  b.cur            -- calendar-YTD, completed months only
    GROUP BY cr.company_name
  ),
  ytd_ranked AS (
    SELECT
      yc.revenue_cents,
      ROW_NUMBER() OVER (ORDER BY yc.revenue_cents DESC) AS rn,
      SUM(yc.revenue_cents) OVER () AS ytd_total
    FROM ytd_company yc
  ),
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
  'Client concentration (migration 123). row_kind=trend: per-month '
  'top1_pct/top5_pct/total (unchanged). row_kind=breakdown: latest-completed-month '
  'per-company slice (top N + Other) for the pie (unchanged). row_kind=ytd (ADDED): '
  'top1_pct/top5_pct over calendar-YTD completed months (summary_month >= '
  'date_trunc(year, CURRENT_DATE) and < date_trunc(month, CURRENT_DATE)); '
  'summary_month on the ytd row = year start, total_revenue_cents = YTD grand '
  'total. All revenue from v_combined_revenue_by_company_month (canonical, '
  'member-excluded). Excludes the in-progress current month.';

GRANT EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) FROM PUBLIC;

-- ============================================================================
-- Verification (read-only; no data mutation)
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 123 Complete (additive CREATE OR REPLACE of two RPCs):';
  RAISE NOTICE '  - get_investor_revenue_mix(date, date) -> SLA buckets + recurring_run_rate_cents';
  RAISE NOTICE '  - get_investor_concentration(date, date, integer) -> + row_kind=ytd';
  RAISE NOTICE '  Both STABLE, search_path=public, EXECUTE to authenticated+service_role, REVOKE from PUBLIC.';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK — restores the migration 122 definitions of BOTH functions.
-- Run this block (uncommented) to revert migration 123.
-- ============================================================================
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS get_investor_revenue_mix(date, date);
--
-- CREATE FUNCTION get_investor_revenue_mix(
--   p_start date DEFAULT NULL,
--   p_end   date DEFAULT NULL
-- )
-- RETURNS TABLE (
--   summary_month                    date,
--   recurring_cents                  bigint,
--   project_cents                    bigint,
--   one_time_cents                   bigint,
--   reimbursement_cents              bigint,
--   combined_cents                   bigint,
--   reconciliation_delta_cents       bigint,
--   committed_monthly_run_rate_cents bigint
-- )
-- LANGUAGE sql
-- STABLE
-- SET search_path = public
-- AS $$
--   WITH bounds AS (
--     SELECT
--       DATE_TRUNC('month', COALESCE(p_start, '1900-01-01'::date))::date AS lo,
--       DATE_TRUNC('month', COALESCE(p_end,   CURRENT_DATE))::date       AS hi,
--       DATE_TRUNC('month', CURRENT_DATE)::date                          AS cur
--   ),
--   combined AS (
--     SELECT
--       cr.summary_month,
--       SUM(cr.combined_revenue_cents) AS combined_cents,
--       SUM(cr.effective_revenue_cents) AS project_cents
--     FROM v_combined_revenue_by_company_month cr
--     CROSS JOIN bounds b
--     WHERE cr.summary_month BETWEEN b.lo AND b.hi
--       AND cr.summary_month < b.cur
--     GROUP BY cr.summary_month
--   ),
--   billing_buckets AS (
--     SELECT
--       bt.transaction_month AS summary_month,
--       SUM(bt.amount_cents) FILTER (
--         WHERE bi.type IN ('subscription','service_fee','license')
--       ) AS recurring_cents,
--       SUM(bt.amount_cents) FILTER (
--         WHERE bi.type = 'revenue_milestone' AND bi.linked_project_id IS NULL
--       ) AS one_time_cents,
--       SUM(bt.amount_cents) FILTER (
--         WHERE bi.type = 'reimbursement'
--       ) AS reimbursement_cents
--     FROM billing_transactions bt
--     JOIN billings bi ON bi.id = bt.billing_id
--     CROSS JOIN bounds b
--     WHERE bt.transaction_month BETWEEN b.lo AND b.hi
--       AND bt.transaction_month < b.cur
--       AND NOT (bi.type = 'revenue_milestone' AND bi.linked_project_id IS NOT NULL)
--     GROUP BY bt.transaction_month
--   ),
--   floor_run_rate AS (
--     SELECT COALESCE(SUM(
--       ROUND(r.minimum_hours * r.effective_rate * 100)::bigint
--     ), 0) AS cents
--     FROM get_all_project_rates_for_month(DATE_TRUNC('month', CURRENT_DATE)::date) r
--     WHERE r.is_active = true
--       AND r.minimum_hours IS NOT NULL
--       AND r.minimum_hours > 0
--       AND NOT EXISTS (
--         SELECT 1 FROM billings mb
--         WHERE mb.linked_project_id = r.project_id
--           AND mb.type = 'revenue_milestone'
--       )
--   ),
--   recurring_run_rate AS (
--     SELECT COALESCE(SUM(latest.amount_cents), 0) AS cents
--     FROM (
--       SELECT DISTINCT ON (bt.billing_id)
--         bt.billing_id,
--         bt.amount_cents
--       FROM billing_transactions bt
--       JOIN billings bi ON bi.id = bt.billing_id
--       WHERE bi.type IN ('subscription','service_fee','license')
--       ORDER BY bt.billing_id, bt.transaction_month DESC
--     ) latest
--   ),
--   run_rate AS (
--     SELECT (SELECT cents FROM floor_run_rate) + (SELECT cents FROM recurring_run_rate) AS cents
--   )
--   SELECT
--     c.summary_month,
--     COALESCE(bb.recurring_cents, 0) AS recurring_cents,
--     GREATEST(COALESCE(c.project_cents, 0), 0) AS project_cents,
--     COALESCE(bb.one_time_cents, 0) AS one_time_cents,
--     COALESCE(bb.reimbursement_cents, 0) AS reimbursement_cents,
--     c.combined_cents,
--     (c.combined_cents
--        - GREATEST(COALESCE(c.project_cents, 0), 0)
--        - COALESCE(bb.recurring_cents, 0)
--        - COALESCE(bb.one_time_cents, 0)
--        - COALESCE(bb.reimbursement_cents, 0)) AS reconciliation_delta_cents,
--     (SELECT cents FROM run_rate) AS committed_monthly_run_rate_cents
--   FROM combined c
--   LEFT JOIN billing_buckets bb ON bb.summary_month = c.summary_month
--   ORDER BY c.summary_month;
-- $$;
--
-- GRANT EXECUTE ON FUNCTION get_investor_revenue_mix(date, date) TO authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION get_investor_revenue_mix(date, date) FROM PUBLIC;
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
--       DATE_TRUNC('month', CURRENT_DATE)::date                          AS cur
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
--   ORDER BY row_kind, summary_month, revenue_cents DESC NULLS LAST;
-- $$;
--
-- GRANT EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) TO authenticated, service_role;
-- REVOKE EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) FROM PUBLIC;
--
-- COMMIT;
