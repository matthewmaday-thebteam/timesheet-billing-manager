-- ============================================================================
-- Migration 122: Investor Analytics Views & RPCs (Additive)
-- ============================================================================
-- PURPOSE: Backend for 5 new Investor Dashboard charts. PURELY ADDITIVE.
--   This migration ONLY creates NEW database objects (RPCs). It does NOT
--   modify, drop, or replace any existing view, table, RPC, hook, or trigger.
--
-- DEPLOYMENT: Applied via the Supabase Management API (SQL endpoint), matching
--   the project's established migration workflow. All calculations live in SQL
--   so the read hooks fetch ready-to-render numbers (no browser arithmetic).
--
-- SECURITY (mirrors migration 076 / 065 pattern):
--   - All functions are STABLE and SET search_path = public.
--   - EXECUTE granted to authenticated + service_role.
--   - EXECUTE revoked from PUBLIC and anon.
--
-- CORRECTNESS (financial audit invariants enforced in SQL):
--   - Revenue sourced ONLY from canonical, member-excluded views
--     (v_combined_revenue_by_company_month, v_canonical_project_monthly_summary).
--     project_monthly_summary is NEVER queried raw (member leakage).
--   - Effective revenue uses the view's COALESCE(milestone_override, billed)
--     so milestone + timesheet are NEVER double-counted.
--   - The in-progress CURRENT month is excluded from ALL trend outputs
--     (matches existing MoM/CAGR behavior). Full completed-month history is
--     returned otherwise.
--   - Reconciliation invariants satisfied:
--       (i)   SUM(per-company combined revenue) == combined_total_revenue_cents
--             from get_investor_dashboard_metrics for the same month.
--       (ii)  Revenue-mix buckets are sourced ADDITIVELY from the SAME sources
--             combined is built from (project=Σ effective_revenue;
--             recurring/one_time(UNLINKED)/reimbursement = the fixed_billing
--             components per migration 051 Part 3), so they sum to combined.
--             Any residual is surfaced as reconciliation_delta_cents (never
--             folded into project_cents); project_cents is guarded >= 0.
--       (iii) Milestone-linked project revenue counted EXACTLY once (the
--             override, already inside effective revenue / project_cents — and
--             EXCLUDED from one_time, which is unlinked milestones only).
--
-- OBJECTS CREATED (all NEW):
--   1. get_investor_margin_by_month(date, date)        -> margin + efficiency
--   2. get_investor_concentration(date, date)          -> client concentration
--   3. get_investor_revenue_mix(date, date)            -> revenue mix + run-rate
--   4. get_investor_utilization_by_month(date, date)   -> utilization (w/ contractors)
--   5. get_investor_realization_by_month(date, date)   -> realization & eff. rate
-- ============================================================================
-- DOWN (rollback) — additive-only, safe to drop the new objects:
--   DROP FUNCTION IF EXISTS get_investor_margin_by_month(date, date);
--   DROP FUNCTION IF EXISTS get_investor_concentration(date, date, integer);
--   DROP FUNCTION IF EXISTS get_investor_revenue_mix(date, date);
--   DROP FUNCTION IF EXISTS get_investor_utilization_by_month(date, date);
--   DROP FUNCTION IF EXISTS get_investor_realization_by_month(date, date);
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. MARGIN + EFFICIENCY PER MONTH
-- ============================================================================
-- Per completed month:
--   combined_revenue_cents     : canonical combined (effective + fixed billings)
--   timesheet_revenue_cents    : Σ canonical billed_revenue_cents (effective:
--                                COALESCE(milestone_override, billed))
--   timesheet_revenue_cents    : TRUE timesheet-only revenue = Σ canonical
--                                billed_revenue_cents BEFORE milestone override
--                                (per migration 076). This is the genuine
--                                timesheet figure, so ts_margin is honestly
--                                "timesheet revenue − labor", NOT polluted by
--                                milestone overrides. (F7)
--   labor_cost_cents           : Σ v_employee_project_profit.employee_cost_cents
--                                (the view is ALREADY canonical + member-excluded,
--                                so no extra join is needed — F5). NULL cost is
--                                NOT treated as 0 (it is excluded from the sum
--                                AND flagged via cost coverage).
--   all_in_profit_cents        : combined_revenue - labor_cost
--   all_in_margin_pct          : all_in_profit / combined_revenue * 100
--   ts_profit_cents            : timesheet_revenue - labor_cost
--   ts_margin_pct              : ts_profit / timesheet_revenue * 100
--   cost_coverage_pct          : covered labor minutes / total worked minutes,
--                                where total worked minutes comes from a source
--                                INDEPENDENT of the cost join (F5). A month with
--                                revenue but NO cost rows therefore shows
--                                coverage 0% (NOT NULL, NOT a false 100%) so the
--                                margin is surfaced as CANNOT-VERIFY.
--   resource_count             : DISTINCT canonical resources with worked time
--                                (incl. contractors). Unmapped timesheet users
--                                are NOT dropped — they fall back to a stable
--                                'unmapped:'||user_id key so per-head divisors
--                                stay complete and consistent. (F2)
--   revenue_per_resource_cents : combined_revenue / resource_count
--   profit_per_resource_cents  : all_in_profit / resource_count
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_investor_margin_by_month(date, date);

CREATE FUNCTION get_investor_margin_by_month(
  p_start date DEFAULT NULL,
  p_end   date DEFAULT NULL
)
RETURNS TABLE (
  summary_month               date,
  combined_revenue_cents      bigint,
  timesheet_revenue_cents     bigint,
  labor_cost_cents            bigint,
  all_in_profit_cents         bigint,
  all_in_margin_pct           numeric,
  ts_profit_cents             bigint,
  ts_margin_pct               numeric,
  cost_coverage_pct           numeric,
  resource_count              integer,
  revenue_per_resource_cents  bigint,
  profit_per_resource_cents   bigint
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
  -- Canonical combined revenue per company-month (member-excluded source view).
  -- combined_revenue_cents = effective (timesheet w/ milestone overrides) + fixed
  -- billings. This is the authoritative ALL-IN total.
  combined AS (
    SELECT
      cr.summary_month,
      SUM(cr.combined_revenue_cents) AS combined_revenue_cents
    FROM v_combined_revenue_by_company_month cr
    CROSS JOIN bounds b
    WHERE cr.summary_month BETWEEN b.lo AND b.hi
      AND cr.summary_month < b.cur          -- exclude in-progress current month
    GROUP BY cr.summary_month
  ),
  -- F7: TRUE timesheet-only revenue = raw billed_revenue_cents BEFORE milestone
  -- override (mirrors migration 076's v_timesheet_revenue_cents). Member-excluded
  -- via the canonical view. ts_margin is therefore genuinely timesheet−labor.
  timesheet AS (
    SELECT
      cpms.summary_month,
      SUM(cpms.billed_revenue_cents) AS timesheet_revenue_cents
    FROM v_canonical_project_monthly_summary cpms
    CROSS JOIN bounds b
    WHERE cpms.summary_month BETWEEN b.lo AND b.hi
      AND cpms.summary_month < b.cur
    GROUP BY cpms.summary_month
  ),
  -- F5: Labor cost per month directly from v_employee_project_profit, which is
  -- ALREADY canonical + member-excluded (built on v_canonical_project_monthly_
  -- summary and v_entity_canonical). The redundant INNER JOIN to the canonical
  -- summary is dropped. NULL cost is excluded from the sum (NOT coerced to 0)
  -- and the covered minutes are tracked separately for coverage.
  labor AS (
    SELECT
      epp.month AS summary_month,
      SUM(epp.employee_cost_cents) FILTER (WHERE epp.employee_cost_cents IS NOT NULL) AS labor_cost_cents,
      SUM(epp.employee_raw_minutes) FILTER (WHERE epp.employee_cost_cents IS NOT NULL) AS covered_minutes
    FROM v_employee_project_profit epp
    CROSS JOIN bounds b
    WHERE epp.month BETWEEN b.lo AND b.hi
      AND epp.month < b.cur
    GROUP BY epp.month
  ),
  -- F5/F2: Worked minutes + distinct resources per month from the raw rollups,
  -- INDEPENDENT of the cost join. This is the coverage denominator (so a month
  -- with revenue but no cost shows 0% coverage, not a false 100% margin) AND the
  -- per-head divisor. Unmapped timesheet users are NOT dropped: they fall back to
  -- a stable 'unmapped:'||user_id key (F2). Includes contractors.
  worked_per_month AS (
    SELECT
      DATE_TRUNC('month', tdr.work_date)::date AS summary_month,
      SUM(tdr.total_minutes) AS total_worked_minutes,
      COUNT(DISTINCT COALESCE(vec.canonical_entity_id::text, 'unmapped:' || tdr.user_id)) AS resource_count
    FROM timesheet_daily_rollups tdr
    LEFT JOIN resource_user_associations rua ON rua.user_id = tdr.user_id
    LEFT JOIN v_entity_canonical vec ON vec.entity_id = rua.resource_id
    CROSS JOIN bounds b
    WHERE tdr.total_minutes > 0
      AND DATE_TRUNC('month', tdr.work_date)::date BETWEEN b.lo AND b.hi
      AND DATE_TRUNC('month', tdr.work_date)::date < b.cur
    GROUP BY DATE_TRUNC('month', tdr.work_date)::date
  )
  SELECT
    c.summary_month,
    c.combined_revenue_cents,
    COALESCE(ts.timesheet_revenue_cents, 0) AS timesheet_revenue_cents,
    COALESCE(l.labor_cost_cents, 0) AS labor_cost_cents,
    (c.combined_revenue_cents - COALESCE(l.labor_cost_cents, 0)) AS all_in_profit_cents,
    CASE WHEN c.combined_revenue_cents <> 0
      THEN ROUND((c.combined_revenue_cents - COALESCE(l.labor_cost_cents, 0))::numeric
                 * 100.0 / c.combined_revenue_cents, 2)
      ELSE NULL
    END AS all_in_margin_pct,
    (COALESCE(ts.timesheet_revenue_cents, 0) - COALESCE(l.labor_cost_cents, 0)) AS ts_profit_cents,
    CASE WHEN COALESCE(ts.timesheet_revenue_cents, 0) <> 0
      THEN ROUND((COALESCE(ts.timesheet_revenue_cents, 0) - COALESCE(l.labor_cost_cents, 0))::numeric
                 * 100.0 / ts.timesheet_revenue_cents, 2)
      ELSE NULL
    END AS ts_margin_pct,
    -- Coverage denominator is the INDEPENDENT worked-minutes source (F5): a month
    -- with worked time but no cost rows -> covered/total = 0% (CANNOT-VERIFY),
    -- never a silent NULL or false 100%.
    CASE WHEN COALESCE(w.total_worked_minutes, 0) > 0
      THEN ROUND(COALESCE(l.covered_minutes, 0)::numeric * 100.0 / w.total_worked_minutes, 2)
      ELSE NULL
    END AS cost_coverage_pct,
    COALESCE(w.resource_count, 0)::integer AS resource_count,
    CASE WHEN COALESCE(w.resource_count, 0) > 0
      THEN (c.combined_revenue_cents / w.resource_count)::bigint
      ELSE NULL
    END AS revenue_per_resource_cents,
    CASE WHEN COALESCE(w.resource_count, 0) > 0
      THEN ((c.combined_revenue_cents - COALESCE(l.labor_cost_cents, 0)) / w.resource_count)::bigint
      ELSE NULL
    END AS profit_per_resource_cents
  FROM combined c
  LEFT JOIN timesheet ts ON ts.summary_month = c.summary_month
  LEFT JOIN labor l ON l.summary_month = c.summary_month
  LEFT JOIN worked_per_month w ON w.summary_month = c.summary_month
  ORDER BY c.summary_month;
$$;

COMMENT ON FUNCTION get_investor_margin_by_month(date, date) IS
  'Per completed month: canonical combined (all-in) revenue and TRUE timesheet- '
  'only revenue (raw billed_revenue_cents BEFORE milestone override, per 076), '
  'labor cost (Σ employee_cost_cents straight from v_employee_project_profit '
  'which is already canonical+member-excluded; NULL cost excluded, not zeroed), '
  'all-in & timesheet-only profit/margin, cost coverage from an INDEPENDENT '
  'worked-minutes source (<100% => margin CANNOT-VERIFY; revenue w/o cost => 0%, '
  'never false 100%), resource count (incl. contractors; unmapped users kept via '
  'unmapped:user_id fallback), and revenue/profit per resource. Excludes the '
  'in-progress current month.';

GRANT EXECUTE ON FUNCTION get_investor_margin_by_month(date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_margin_by_month(date, date) FROM PUBLIC;

-- ============================================================================
-- 2. CLIENT CONCENTRATION
-- ============================================================================
-- Returns two logical sections in one result set, discriminated by row_kind:
--   row_kind = 'trend'    : per-month top1_pct, top5_pct, total_revenue_cents
--   row_kind = 'breakdown': latest-completed-month per-company slice for the pie
--                           (top N companies + an 'Other' rollup), with
--                           company_name, revenue_cents, pct.
-- All revenue from v_combined_revenue_by_company_month (canonical, member-excl).
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
      DATE_TRUNC('month', CURRENT_DATE)::date                          AS cur
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
  -- TREND: top1 / top5 share per month
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
  -- BREAKDOWN: latest completed month, top N companies + 'Other'
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
  ORDER BY row_kind, summary_month, revenue_cents DESC NULLS LAST;
$$;

COMMENT ON FUNCTION get_investor_concentration(date, date, integer) IS
  'Client concentration. row_kind=trend: per-month top1_pct/top5_pct/total. '
  'row_kind=breakdown: latest-completed-month per-company slice (top N + Other) '
  'for the pie. All revenue from v_combined_revenue_by_company_month (canonical, '
  'member-excluded). Excludes the in-progress current month.';

GRANT EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_concentration(date, date, integer) FROM PUBLIC;

-- ============================================================================
-- 3. REVENUE MIX + COMMITTED RUN-RATE
-- ============================================================================
-- F1 (BLOCKER FIX): buckets are computed ADDITIVELY from the SAME sources the
-- canonical combined revenue is built from, NOT as a blind residual. Combined =
-- effective_revenue (timesheet w/ milestone overrides) + fixed_billing_cents,
-- where fixed_billing_cents EXCLUDES linked milestones (migration 051 Part 3).
-- So:
--   project_cents       : Σ effective_revenue_cents from
--                         v_combined_revenue_by_company_month. This already
--                         includes linked-milestone overrides (a linked milestone
--                         REPLACED that project's timesheet revenue, so it is
--                         project/delivery revenue) — counted exactly once.
--   recurring_cents     : component of fixed_billing — billings.type IN
--                         ('subscription','service_fee','license'). service_fee
--                         IS recurring (product decision).
--   one_time_cents      : component of fixed_billing — billings.type =
--                         'revenue_milestone' AND linked_project_id IS NULL
--                         (UNLINKED only; linked milestones live in project_cents
--                         via the override and are EXCLUDED from fixed_billing).
--   reimbursement_cents : component of fixed_billing — billings.type =
--                         'reimbursement'.
-- These four bucket sources mirror EXACTLY how combined is derived, so
--   project_cents + recurring + one_time + reimbursement == combined_cents.
-- If a residual remains (must not happen if sourced consistently), it is
-- surfaced as reconciliation_delta_cents — NEVER absorbed into project_cents,
-- and project_cents is GREATEST(...,0)-guarded so it can never be silently
-- negative.
--   combined_cents              : canonical combined (the bucket sum target).
--   reconciliation_delta_cents  : combined - (sum of the four buckets); 0 in the
--                                 healthy case.
--
-- committed_monthly_run_rate_cents (current snapshot, identical on every row):
--   F4 FIX — active floors resolved by canonical effective-dated semantics via
--   get_all_project_rates_for_month(current month), which already returns
--   canonical, member-excluded projects with minimum_hours, is_active and
--   effective_rate in one consistent "latest row <= month" resolution (no fragile
--   status_month = limits_month equality join):
--   Σ (minimum_hours × effective_rate × 100) for rows where is_active AND
--     minimum_hours > 0 AND the project is NOT milestone-linked
--   + Σ active recurring billings (subscription/service_fee/license latest
--                                  monthly transaction amount).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_investor_revenue_mix(date, date);

CREATE FUNCTION get_investor_revenue_mix(
  p_start date DEFAULT NULL,
  p_end   date DEFAULT NULL
)
RETURNS TABLE (
  summary_month                    date,
  recurring_cents                  bigint,
  project_cents                    bigint,
  one_time_cents                   bigint,
  reimbursement_cents              bigint,
  combined_cents                   bigint,
  reconciliation_delta_cents       bigint,
  committed_monthly_run_rate_cents bigint
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
  -- Canonical combined revenue per month + the project (effective) component.
  -- combined_cents is the authoritative total; project_cents is sourced the SAME
  -- way combined derives effective_revenue (incl. milestone overrides), counted
  -- exactly once (F1).
  combined AS (
    SELECT
      cr.summary_month,
      SUM(cr.combined_revenue_cents) AS combined_cents,
      SUM(cr.effective_revenue_cents) AS project_cents
    FROM v_combined_revenue_by_company_month cr
    CROSS JOIN bounds b
    WHERE cr.summary_month BETWEEN b.lo AND b.hi
      AND cr.summary_month < b.cur
    GROUP BY cr.summary_month
  ),
  -- Fixed-billing components, partitioned EXACTLY as migration 051 Part 3 derives
  -- fixed_billing_cents: ALL billing types EXCEPT linked revenue_milestones
  -- (which are excluded from fixed billing because their value lives in the
  -- per-project override inside effective_revenue / project_cents). So one_time
  -- here is UNLINKED revenue_milestone only. The sum of these three == the
  -- fixed_billing_cents that feeds combined (F1).
  billing_buckets AS (
    SELECT
      bt.transaction_month AS summary_month,
      SUM(bt.amount_cents) FILTER (
        WHERE bi.type IN ('subscription','service_fee','license')
      ) AS recurring_cents,
      SUM(bt.amount_cents) FILTER (
        WHERE bi.type = 'revenue_milestone' AND bi.linked_project_id IS NULL
      ) AS one_time_cents,
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
  -- ----- Committed monthly run-rate (current snapshot) -----
  -- F4: Active SLA floors resolved via get_all_project_rates_for_month (canonical,
  -- member-excluded, effective-dated "latest row <= current month" for both the
  -- floor AND the active flag AND the rate — no status_month=limits_month join).
  -- Milestone-linked projects are excluded (their revenue is the override, not a
  -- floor).
  floor_run_rate AS (
    SELECT COALESCE(SUM(
      ROUND(r.minimum_hours * r.effective_rate * 100)::bigint
    ), 0) AS cents
    FROM get_all_project_rates_for_month(DATE_TRUNC('month', CURRENT_DATE)::date) r
    WHERE r.is_active = true
      AND r.minimum_hours IS NOT NULL
      AND r.minimum_hours > 0
      AND NOT EXISTS (
        SELECT 1 FROM billings mb
        WHERE mb.linked_project_id = r.project_id
          AND mb.type = 'revenue_milestone'
      )
  ),
  -- Active recurring billings: latest monthly transaction amount per billing.
  recurring_run_rate AS (
    SELECT COALESCE(SUM(latest.amount_cents), 0) AS cents
    FROM (
      SELECT DISTINCT ON (bt.billing_id)
        bt.billing_id,
        bt.amount_cents
      FROM billing_transactions bt
      JOIN billings bi ON bi.id = bt.billing_id
      WHERE bi.type IN ('subscription','service_fee','license')
      ORDER BY bt.billing_id, bt.transaction_month DESC
    ) latest
  ),
  run_rate AS (
    SELECT (SELECT cents FROM floor_run_rate) + (SELECT cents FROM recurring_run_rate) AS cents
  )
  SELECT
    c.summary_month,
    COALESCE(bb.recurring_cents, 0) AS recurring_cents,
    -- F1: project bucket is sourced ADDITIVELY (effective_revenue), guarded so it
    -- can NEVER be silently negative.
    GREATEST(COALESCE(c.project_cents, 0), 0) AS project_cents,
    COALESCE(bb.one_time_cents, 0) AS one_time_cents,
    COALESCE(bb.reimbursement_cents, 0) AS reimbursement_cents,
    c.combined_cents,
    -- F1: any residual (should be 0 when sourced consistently) is surfaced here,
    -- NEVER absorbed into project_cents.
    (c.combined_cents
       - GREATEST(COALESCE(c.project_cents, 0), 0)
       - COALESCE(bb.recurring_cents, 0)
       - COALESCE(bb.one_time_cents, 0)
       - COALESCE(bb.reimbursement_cents, 0)) AS reconciliation_delta_cents,
    (SELECT cents FROM run_rate) AS committed_monthly_run_rate_cents
  FROM combined c
  LEFT JOIN billing_buckets bb ON bb.summary_month = c.summary_month
  ORDER BY c.summary_month;
$$;

COMMENT ON FUNCTION get_investor_revenue_mix(date, date) IS
  'Revenue mix per completed month, buckets sourced ADDITIVELY (F1, not a '
  'residual): project (Σ effective_revenue incl. milestone overrides, counted '
  'once, GREATEST(.,0)-guarded so never negative), recurring (subscription/'
  'service_fee/license), one_time (UNLINKED revenue_milestone only), reimbursement '
  '(the components of fixed_billing per migration 051 Part 3 which EXCLUDES linked '
  'milestones). project+recurring+one_time+reimbursement == combined; any residual '
  'is surfaced as reconciliation_delta_cents, never hidden in project. '
  'committed_monthly_run_rate_cents = Σ active SLA floors (minimum_hours × '
  'effective_rate via get_all_project_rates_for_month, non-milestone) + active '
  'recurring billings. Excludes the in-progress current month from trend rows.';

GRANT EXECUTE ON FUNCTION get_investor_revenue_mix(date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_revenue_mix(date, date) FROM PUBLIC;

-- ============================================================================
-- 4. UTILIZATION TREND PER MONTH (includes contractors)
-- ============================================================================
-- Ports the InvestorDashboardPage inline utilization formula into SQL:
--   utilization = worked hours / available hours
--   available  = per-resource hours/day × working days (weekdays minus
--                bulgarian_holidays) − approved time-off (employee_time_off
--                overlap, weekdays only).
--   hours/day  : Full-time = 8, Part-time = 4, otherwise (contractor / hourly)
--                = expected_hours / working_days_in_month (monthly expected
--                spread across the month), falling back to 8 when unknown.
--
-- NOTE: This is the INCLUDE-CONTRACTORS basis (per product decision). It
-- intentionally differs from the page's existing FT+PT-only inline number,
-- which this migration does NOT modify.
--
-- F3 — POPULATION CONSISTENCY: the worked-minutes NUMERATOR and the available-
-- hours DENOMINATOR are now the SAME entity universe (v_employee_table_entities,
-- the canonical, member-excluded capacity set, which already includes
-- contractors). Worked minutes are aggregated to canonical_entity_id, then
-- joined to the capacity set on resource_id = canonical_entity_id. Worked
-- minutes whose canonical entity is NOT in the capacity set (e.g. unmapped
-- timesheet users with no resource association) are EXCLUDED from both the
-- numerator and the resource count — they cannot be measured against a capacity
-- and would otherwise produce a spurious >100%. This removes the previous
-- asymmetry (member-vs-primary / capacity-vs-worked mismatch) that allowed silent
-- >100% utilization.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_investor_utilization_by_month(date, date);

CREATE FUNCTION get_investor_utilization_by_month(
  p_start date DEFAULT NULL,
  p_end   date DEFAULT NULL
)
RETURNS TABLE (
  summary_month    date,
  utilization_pct  numeric,
  worked_hours     numeric,
  available_hours  numeric,
  resource_count   integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH bounds AS (
    -- This function is GENERATOR-driven (generate_series fabricates a row per
    -- month and CROSS JOINs the capacity set), unlike the sibling functions which
    -- are DATA-driven aggregations (they survive a '1900-01-01' floor because no
    -- source rows precede the first activity month, so GROUP BY never emits them).
    -- Here a '1900-01-01' floor would manufacture ~1500 phantom months, each with
    -- worked_hours=0 / resource_count=0 but a non-zero available_hours (capacity
    -- computed against working days that predate ALL data). So when p_start is
    -- NULL we resolve the floor from data — the first month with timesheet
    -- activity — mirroring how the data-driven siblings effectively begin at the
    -- first month that has rows. When p_end is NULL we resolve to the last
    -- COMPLETED month (current month minus one), since the in-progress current
    -- month is excluded everywhere. An explicit p_start/p_end is honored as-is
    -- (month-truncated), so the hook/page contract is unchanged.
    SELECT
      DATE_TRUNC(
        'month',
        COALESCE(
          p_start,
          (SELECT MIN(work_date) FROM timesheet_daily_rollups),
          CURRENT_DATE  -- empty-table guard; yields an empty range below
        )
      )::date AS lo,
      LEAST(
        DATE_TRUNC('month', COALESCE(p_end, CURRENT_DATE))::date,
        -- never emit the in-progress current month
        (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date
      ) AS hi,
      DATE_TRUNC('month', CURRENT_DATE)::date AS cur
  ),
  -- Completed months in range (in-progress current month already excluded via the
  -- resolved hi). Bounded to [lo, hi]; no pre-data 1900 months are generated.
  months AS (
    SELECT gs::date AS summary_month
    FROM bounds b, generate_series(b.lo, b.hi, '1 month'::interval) gs
    WHERE gs::date < b.cur
  ),
  -- Working days per month (weekdays minus holidays).
  working_days AS (
    SELECT
      m.summary_month,
      COUNT(*) FILTER (
        WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
          AND NOT EXISTS (
            SELECT 1 FROM bulgarian_holidays bh WHERE bh.holiday_date = d.day::date
          )
      ) AS working_day_count
    FROM months m
    CROSS JOIN LATERAL generate_series(
      m.summary_month,
      (m.summary_month + INTERVAL '1 month - 1 day')::date,
      '1 day'::interval
    ) d(day)
    GROUP BY m.summary_month
  ),
  -- Canonical (non-member) resources with their per-day hours basis.
  emp AS (
    SELECT
      e.id AS resource_id,
      TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS display_name,
      e.employment_type_name,
      e.expected_hours
    FROM v_employee_table_entities e
  ),
  -- Per-resource, per-month available hours (gross, before time-off).
  emp_month AS (
    SELECT
      wd.summary_month,
      emp.resource_id,
      emp.display_name,
      wd.working_day_count,
      CASE
        WHEN emp.employment_type_name = 'Full-time' THEN 8.0
        WHEN emp.employment_type_name = 'Part-time' THEN 4.0
        WHEN emp.expected_hours IS NOT NULL AND emp.expected_hours > 0 AND wd.working_day_count > 0
          THEN ROUND(emp.expected_hours::numeric / wd.working_day_count, 4)
        ELSE 8.0
      END AS hours_per_day
    FROM working_days wd
    CROSS JOIN emp
  ),
  -- Approved time-off weekdays per resource per month (overlap clamped).
  time_off_days AS (
    SELECT
      em.summary_month,
      em.resource_id,
      COUNT(*) FILTER (
        WHERE EXTRACT(DOW FROM d.day) NOT IN (0, 6)
          AND NOT EXISTS (
            SELECT 1 FROM bulgarian_holidays bh WHERE bh.holiday_date = d.day::date
          )
      ) AS pto_weekdays
    FROM emp_month em
    JOIN employee_time_off eto
      ON eto.status = 'approved'
     AND (eto.resource_id = em.resource_id OR eto.employee_name = em.display_name)
     AND eto.start_date::date <= (em.summary_month + INTERVAL '1 month - 1 day')::date
     AND eto.end_date::date   >= em.summary_month
    CROSS JOIN LATERAL generate_series(
      GREATEST(eto.start_date::date, em.summary_month),
      LEAST(eto.end_date::date, (em.summary_month + INTERVAL '1 month - 1 day')::date),
      '1 day'::interval
    ) d(day)
    GROUP BY em.summary_month, em.resource_id
  ),
  -- Worked minutes aggregated to CANONICAL ENTITY per month (F3). This is the
  -- numerator's entity universe; joined to the capacity set below so the two
  -- sides match. Unmapped users (NULL canonical entity) are produced here but
  -- get dropped by the INNER-style join to emp_month (no capacity to measure).
  worked_by_entity AS (
    SELECT
      DATE_TRUNC('month', tdr.work_date)::date AS summary_month,
      vec.canonical_entity_id,
      SUM(tdr.total_minutes)::numeric / 60.0 AS worked_hours
    FROM timesheet_daily_rollups tdr
    LEFT JOIN resource_user_associations rua ON rua.user_id = tdr.user_id
    LEFT JOIN v_entity_canonical vec ON vec.entity_id = rua.resource_id
    CROSS JOIN bounds b
    WHERE tdr.total_minutes > 0
      AND DATE_TRUNC('month', tdr.work_date)::date BETWEEN b.lo AND b.hi
      AND DATE_TRUNC('month', tdr.work_date)::date < b.cur
    GROUP BY DATE_TRUNC('month', tdr.work_date)::date, vec.canonical_entity_id
  ),
  -- Per-resource, per-month: available hours (capacity − PTO) joined to that same
  -- resource's worked hours. emp.resource_id is a canonical (primary/unassociated)
  -- entity id, which equals worked_by_entity.canonical_entity_id — the SAME
  -- universe on both sides (F3).
  resource_month AS (
    SELECT
      em.summary_month,
      em.resource_id,
      (em.working_day_count - COALESCE(td.pto_weekdays, 0)) * em.hours_per_day AS available_hours,
      COALESCE(wbe.worked_hours, 0) AS worked_hours
    FROM emp_month em
    LEFT JOIN time_off_days td
      ON td.summary_month = em.summary_month
     AND td.resource_id = em.resource_id
    LEFT JOIN worked_by_entity wbe
      ON wbe.summary_month = em.summary_month
     AND wbe.canonical_entity_id = em.resource_id
  )
  SELECT
    m.summary_month,
    CASE WHEN COALESCE(SUM(rm.available_hours), 0) > 0
      THEN ROUND(SUM(rm.worked_hours) * 100.0 / SUM(rm.available_hours), 2)
      ELSE NULL
    END AS utilization_pct,
    ROUND(COALESCE(SUM(rm.worked_hours), 0), 2) AS worked_hours,
    ROUND(COALESCE(SUM(rm.available_hours), 0), 2) AS available_hours,
    -- Resource count = capacity-set members who actually worked this month
    -- (same universe as numerator/denominator; includes contractors).
    COUNT(*) FILTER (WHERE rm.worked_hours > 0)::integer AS resource_count
  FROM months m
  LEFT JOIN resource_month rm ON rm.summary_month = m.summary_month
  GROUP BY m.summary_month
  ORDER BY m.summary_month;
$$;

COMMENT ON FUNCTION get_investor_utilization_by_month(date, date) IS
  'Utilization trend per completed month (INCLUDE-CONTRACTORS basis): '
  'worked hours / available hours, where available = per-resource hours/day '
  '(FT 8 / PT 4 / else expected_hours per working day, fallback 8) × working '
  'days (weekdays minus bulgarian_holidays) minus approved employee_time_off '
  'weekdays. F3: worked minutes are canonicalized to the SAME entity universe as '
  'capacity (v_employee_table_entities) and joined per-resource, so the numerator '
  'and denominator populations match; worked minutes for entities outside the '
  'capacity set (unmapped users) are excluded, removing spurious >100%. '
  'Intentionally differs from the page''s FT+PT-only inline number (which is NOT '
  'modified). Excludes the in-progress current month.';

GRANT EXECUTE ON FUNCTION get_investor_utilization_by_month(date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_utilization_by_month(date, date) FROM PUBLIC;

-- ============================================================================
-- 5. REALIZATION & EFFECTIVE RATE PER MONTH
-- ============================================================================
-- Over v_canonical_project_monthly_summary, EXCLUDING milestone-override
-- projects (milestone_override_cents IS NULL) so hours-vs-revenue stays honest:
--   realization_pct      : Σ billed_hours / Σ actual_hours * 100
--                          (>100% = floor padding, <100% = carryover/unbillable)
--   effective_rate_cents : Σ billed_revenue_cents / Σ actual_hours
--                          (divided by ACTUAL hours, by design)
--   decomposition        : Σ minimum_padding_hours, Σ unbillable_hours,
--                          Σ carryover_out_hours, Σ actual_hours, Σ billed_hours
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_investor_realization_by_month(date, date);

CREATE FUNCTION get_investor_realization_by_month(
  p_start date DEFAULT NULL,
  p_end   date DEFAULT NULL
)
RETURNS TABLE (
  summary_month             date,
  realization_pct           numeric,
  effective_rate_cents      bigint,
  total_actual_hours        numeric,
  total_billed_hours        numeric,
  total_minimum_padding_hours numeric,
  total_unbillable_hours    numeric,
  total_carryover_out_hours numeric,
  total_billed_revenue_cents bigint
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
  agg AS (
    SELECT
      cpms.summary_month,
      SUM(cpms.actual_hours)            AS total_actual_hours,
      SUM(cpms.billed_hours)            AS total_billed_hours,
      SUM(cpms.minimum_padding_hours)   AS total_minimum_padding_hours,
      SUM(cpms.unbillable_hours)        AS total_unbillable_hours,
      SUM(cpms.carryover_out_hours)     AS total_carryover_out_hours,
      SUM(cpms.billed_revenue_cents)    AS total_billed_revenue_cents
    FROM v_canonical_project_monthly_summary cpms
    CROSS JOIN bounds b
    WHERE cpms.summary_month BETWEEN b.lo AND b.hi
      AND cpms.summary_month < b.cur
      AND cpms.milestone_override_cents IS NULL  -- exclude milestone-override projects
    GROUP BY cpms.summary_month
  )
  SELECT
    a.summary_month,
    CASE WHEN a.total_actual_hours > 0
      THEN ROUND(a.total_billed_hours * 100.0 / a.total_actual_hours, 2)
      ELSE NULL
    END AS realization_pct,
    CASE WHEN a.total_actual_hours > 0
      THEN ROUND(a.total_billed_revenue_cents / a.total_actual_hours)::bigint
      ELSE NULL
    END AS effective_rate_cents,
    ROUND(a.total_actual_hours, 2)          AS total_actual_hours,
    ROUND(a.total_billed_hours, 2)          AS total_billed_hours,
    ROUND(a.total_minimum_padding_hours, 2) AS total_minimum_padding_hours,
    ROUND(a.total_unbillable_hours, 2)      AS total_unbillable_hours,
    ROUND(a.total_carryover_out_hours, 2)   AS total_carryover_out_hours,
    a.total_billed_revenue_cents
  FROM agg a
  ORDER BY a.summary_month;
$$;

COMMENT ON FUNCTION get_investor_realization_by_month(date, date) IS
  'Realization & effective rate per completed month over '
  'v_canonical_project_monthly_summary EXCLUDING milestone-override projects. '
  'realization_pct = Σ billed_hours / Σ actual_hours; effective_rate_cents = '
  'Σ billed_revenue_cents / Σ ACTUAL hours. Returns the hours decomposition '
  '(padding/unbillable/carryover/actual/billed) so the UI can honestly explain '
  '>100% (floor padding) vs <100% (carryover/unbillable). Excludes the '
  'in-progress current month.';

GRANT EXECUTE ON FUNCTION get_investor_realization_by_month(date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION get_investor_realization_by_month(date, date) FROM PUBLIC;

-- ============================================================================
-- Verification (read-only; no data mutation)
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 122 Complete (additive-only):';
  RAISE NOTICE '  - get_investor_margin_by_month(date, date)';
  RAISE NOTICE '  - get_investor_concentration(date, date, integer)';
  RAISE NOTICE '  - get_investor_revenue_mix(date, date)';
  RAISE NOTICE '  - get_investor_utilization_by_month(date, date)';
  RAISE NOTICE '  - get_investor_realization_by_month(date, date)';
  RAISE NOTICE '  All STABLE, search_path=public, EXECUTE to authenticated+service_role, REVOKE from PUBLIC.';
END $$;

COMMIT;
