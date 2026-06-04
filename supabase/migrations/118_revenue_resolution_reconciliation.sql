-- ============================================================================
-- Migration 118: Revenue Resolution Reconciliation (Phase 2 Proof)
-- ============================================================================
-- Purpose: PROVE parity between the NEW read-time revenue authority and the
-- stored snapshot the live surfaces render today, and ENUMERATE every
-- previously-hidden (newly-surfaced) revenue amount for finance sign-off.
-- NOTHING is cut over here — this is read-only reconciliation tooling only.
--
-- Authority contract (built by the parallel read-time-authority agent):
--   resolve_month_project_revenue(p_month date)  RETURNS SETOF rows, one per
--     canonical project with activity/floor/milestone/fixed/carryover. Columns
--     used here: project_id, company_id, summary_month, billed_hours,
--     billed_revenue_cents, base_revenue_cents, milestone_override_cents,
--     rounded_minutes, minimum_applied, maximum_applied.
--   v_resolved_project_monthly_revenue  — shadow view (same columns, all months).
--
-- Snapshot (what live surfaces show today):
--   project_monthly_summary read through v_canonical_project_monthly_summary
--   (member rows excluded — same filtering the authority uses for canonical).
--
-- Comparison rule: integer cents, ZERO tolerance.
--
-- Reuse note: this mirrors the field-by-field idiom of migration 048
-- (verify_billing_month) and 046 (compare_summary_vs_recomputed), but targets
-- the snapshot-vs-authority axis rather than snapshot-vs-recompute.
--
-- Safety: All functions READ-ONLY (STABLE, no writes). service_role EXECUTE
-- only; PUBLIC/anon/authenticated revoked.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: compare_resolved_vs_snapshot(p_month) — per-project diff for a month
-- ============================================================================
-- FULL OUTER join between the resolved authority and the canonical snapshot so
-- that rows present on EITHER side surface.
--
-- EFFECTIVE revenue is the comparison axis. The live combined surface renders
-- COALESCE(milestone_override_cents, billed_revenue_cents) (migrations 047/050),
-- so parity MUST be proven on that same effective value — not billed alone.
-- Comparing billed-only would let a fixed-bid / milestone project with zero
-- hours (billed=0 on both sides) but a milestone override classify as
-- 'zero_both' and contribute nothing to mismatch totals, hiding override drift
-- and letting the parity gate falsely PASS.
--
--   eff_cents = COALESCE(milestone_override_cents, billed_revenue_cents, 0)
--
-- Classification (driven by EFFECTIVE values):
--   'match'          both present, eff_cents equal (cents-exact)
--   'newly_surfaced' snapshot effective 0 but resolved effective > 0  (HIDDEN $)
--   'mismatch'       both present but eff_cents differ (incl. override drift)
--   'zero_both'      both effective 0 (no revenue either way)
-- diff_eff_cents = res_eff_cents - snap_eff_cents  (snapshot 0 when row absent).
-- milestone_mismatch flags an override-only divergence on its own axis.
--
-- The billed-only columns (snapshot/resolved_billed_revenue_cents, diff_cents)
-- are RETAINED for localization / drill-down; they no longer drive the verdict.

CREATE OR REPLACE FUNCTION compare_resolved_vs_snapshot(p_month DATE)
RETURNS TABLE (
    project_id                          UUID,
    company_id                          UUID,
    snapshot_billed_revenue_cents       BIGINT,   -- NULL if no snapshot row
    resolved_billed_revenue_cents       BIGINT,   -- NULL if authority has no row
    snapshot_milestone_override_cents   BIGINT,
    resolved_milestone_override_cents   BIGINT,
    snapshot_effective_cents            BIGINT,   -- COALESCE(override, billed, 0)
    resolved_effective_cents            BIGINT,   -- COALESCE(override, billed, 0)
    diff_cents                          BIGINT,   -- billed-only delta (retained)
    diff_eff_cents                      BIGINT,   -- EFFECTIVE delta (drives verdict)
    milestone_mismatch                  BOOLEAN,  -- override IS DISTINCT FROM override
    classification                      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    RETURN QUERY
    WITH snap AS (
        SELECT
            cpms.project_id,
            cpms.company_id,
            cpms.billed_revenue_cents,
            cpms.milestone_override_cents
        FROM v_canonical_project_monthly_summary cpms
        WHERE cpms.summary_month = v_month
    ),
    resolved AS (
        SELECT
            r.project_id,
            r.company_id,
            r.billed_revenue_cents,
            r.milestone_override_cents
        FROM resolve_month_project_revenue(v_month) r
    ),
    joined AS (
        SELECT
            COALESCE(s.project_id, rv.project_id)   AS project_id,
            COALESCE(s.company_id, rv.company_id)   AS company_id,
            s.billed_revenue_cents                  AS snap_billed,
            rv.billed_revenue_cents                 AS res_billed,
            s.milestone_override_cents              AS snap_milestone,
            rv.milestone_override_cents             AS res_milestone,
            -- EFFECTIVE revenue = what the live surface actually renders.
            COALESCE(s.milestone_override_cents,  s.billed_revenue_cents,  0) AS snap_eff_cents,
            COALESCE(rv.milestone_override_cents, rv.billed_revenue_cents, 0) AS res_eff_cents
        FROM snap s
        FULL OUTER JOIN resolved rv ON rv.project_id = s.project_id
    )
    SELECT
        j.project_id,
        j.company_id,
        j.snap_billed,
        j.res_billed,
        j.snap_milestone,
        j.res_milestone,
        j.snap_eff_cents::BIGINT,
        j.res_eff_cents::BIGINT,
        -- Billed-only delta, retained for localization / drill-down.
        (COALESCE(j.res_billed, 0) - COALESCE(j.snap_billed, 0))::BIGINT AS diff_cents,
        -- EFFECTIVE delta — this is what the parity verdict is built on.
        (j.res_eff_cents - j.snap_eff_cents)::BIGINT AS diff_eff_cents,
        (j.snap_milestone IS DISTINCT FROM j.res_milestone) AS milestone_mismatch,
        CASE
            -- Snapshot effective 0 but authority resolves real effective revenue.
            WHEN j.snap_eff_cents = 0 AND j.res_eff_cents > 0
                THEN 'newly_surfaced'
            -- Nothing on either side (effective).
            WHEN j.snap_eff_cents = 0 AND j.res_eff_cents = 0
                THEN 'zero_both'
            -- Both effective values present and cents-exact equal. A milestone
            -- project with 0 hours and equal overrides lands here (NOT zero_both).
            WHEN j.snap_eff_cents = j.res_eff_cents
                THEN 'match'
            -- Effective values differ (billed drift OR override drift) — a real
            -- mismatch on an existing row.
            ELSE 'mismatch'
        END AS classification
    FROM joined j;
END;
$$;

COMMENT ON FUNCTION compare_resolved_vs_snapshot(DATE) IS
    'Phase 2 proof. Per-project cents-exact diff for one month between the '
    'read-time authority (resolve_month_project_revenue) and the live snapshot '
    '(v_canonical_project_monthly_summary). Classification is driven by '
    'EFFECTIVE revenue = COALESCE(milestone_override_cents, billed_revenue_cents, '
    '0) — the value the live surface renders (migrations 047/050) — so '
    'milestone-override drift is visible. classification: match | '
    'newly_surfaced | mismatch | zero_both. Billed-only columns and diff_cents '
    'are retained for drill-down; diff_eff_cents + milestone_mismatch expose the '
    'effective axis. Read-only.';

-- ============================================================================
-- STEP 2: report_newly_surfaced_revenue(p_from, p_to)
-- ============================================================================
-- Every project-month where the snapshot has NO EFFECTIVE revenue (no row, or
-- effective $0) but the authority resolves EFFECTIVE > 0 — i.e. revenue that was
-- being silently hidden, INCLUDING milestone-only zero-hour months whose real
-- value lives entirely in the override. Includes already_invoiced: whether a
-- SENT QBO invoice exists for that company-month (qbo_invoice_log.status =
-- 'sent'), so finance can see which deltas land in already-billed months. Those
-- are INFORMATIONAL ONLY — never auto re-bill.

CREATE OR REPLACE FUNCTION report_newly_surfaced_revenue(
    p_from DATE,
    p_to   DATE
)
RETURNS TABLE (
    project_id                      UUID,
    company_id                      UUID,
    project_name                    TEXT,
    summary_month                   DATE,
    resolved_effective_cents        BIGINT,   -- effective $ surfaced (override|billed)
    resolved_billed_revenue_cents   BIGINT,   -- billed-only, retained for drill-down
    reason                          TEXT,
    already_invoiced                BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from DATE := DATE_TRUNC('month', p_from)::DATE;
    v_to   DATE := DATE_TRUNC('month', p_to)::DATE;
    v_month DATE;
BEGIN
    FOR v_month IN
        SELECT gs::DATE
        FROM generate_series(v_from, v_to, INTERVAL '1 month') gs
    LOOP
        RETURN QUERY
        SELECT
            c.project_id,
            c.company_id,
            p.project_name,
            v_month AS summary_month,
            c.resolved_effective_cents,
            c.resolved_billed_revenue_cents,
            CASE
                WHEN c.snapshot_billed_revenue_cents IS NULL
                     AND c.snapshot_milestone_override_cents IS NULL
                    THEN 'no_snapshot_row'
                WHEN c.resolved_milestone_override_cents IS NOT NULL
                     AND COALESCE(c.resolved_billed_revenue_cents, 0) = 0
                    THEN 'milestone_override_only'
                ELSE 'snapshot_zero'
            END AS reason,
            EXISTS (
                SELECT 1
                FROM qbo_invoice_log q
                WHERE q.company_id  = c.company_id
                  AND q.report_year  = EXTRACT(YEAR  FROM v_month)::INTEGER
                  AND q.report_month = EXTRACT(MONTH FROM v_month)::INTEGER
                  AND q.status = 'sent'
            ) AS already_invoiced
        FROM compare_resolved_vs_snapshot(v_month) c
        JOIN projects p ON p.id = c.project_id
        WHERE c.classification = 'newly_surfaced';
    END LOOP;
END;
$$;

COMMENT ON FUNCTION report_newly_surfaced_revenue(DATE, DATE) IS
    'Phase 2 proof. Enumerates previously-hidden revenue: project-months where '
    'the snapshot had no EFFECTIVE revenue (no row, or effective $0) but the '
    'read-time authority resolves EFFECTIVE > 0 — effective = '
    'COALESCE(milestone_override_cents, billed_revenue_cents, 0) — across '
    '[p_from, p_to]. Captures milestone-only zero-hour months. '
    'resolved_effective_cents is the surfaced amount; billed-only retained for '
    'drill-down. already_invoiced flags company-months with a SENT '
    'qbo_invoice_log row (informational only — never auto re-bill). Read-only.';

-- ============================================================================
-- STEP 3: compare_resolved_vs_snapshot_range(p_from, p_to)
-- ============================================================================
-- One-call proof across all months: counts by classification and total
-- mismatch_cents (absolute EFFECTIVE cents of disagreement on rows present in
-- BOTH sides). Because classification and diff_eff_cents are EFFECTIVE-driven,
-- mismatch_count / mismatch_cents now cover the milestone-override axis too — so
-- 'zero mismatches on existing rows' is a true all-clear, not a billed-only one.
-- milestone_mismatch_count breaks out how many of those diverged on the override
-- specifically (a project may mismatch on billed, override, or both).
-- Orchestrator proves parity when mismatch_count = 0 AND mismatch_cents = 0
-- (and milestone_mismatch_count = 0) for every month.

CREATE OR REPLACE FUNCTION compare_resolved_vs_snapshot_range(
    p_from DATE,
    p_to   DATE
)
RETURNS TABLE (
    summary_month               DATE,
    match_count                 INTEGER,
    newly_surfaced_count        INTEGER,
    mismatch_count              INTEGER,   -- EFFECTIVE-revenue mismatches
    zero_both_count             INTEGER,
    milestone_mismatch_count    INTEGER,   -- subset diverging on the override axis
    newly_surfaced_cents        BIGINT,    -- total resolved EFFECTIVE cents surfaced
    mismatch_cents              BIGINT     -- total |diff_eff_cents| on 'mismatch' rows
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from DATE := DATE_TRUNC('month', p_from)::DATE;
    v_to   DATE := DATE_TRUNC('month', p_to)::DATE;
    v_month DATE;
BEGIN
    FOR v_month IN
        SELECT gs::DATE
        FROM generate_series(v_from, v_to, INTERVAL '1 month') gs
    LOOP
        RETURN QUERY
        SELECT
            v_month AS summary_month,
            COUNT(*) FILTER (WHERE c.classification = 'match')::INTEGER,
            COUNT(*) FILTER (WHERE c.classification = 'newly_surfaced')::INTEGER,
            COUNT(*) FILTER (WHERE c.classification = 'mismatch')::INTEGER,
            COUNT(*) FILTER (WHERE c.classification = 'zero_both')::INTEGER,
            COUNT(*) FILTER (WHERE c.milestone_mismatch)::INTEGER,
            COALESCE(SUM(c.resolved_effective_cents)
                     FILTER (WHERE c.classification = 'newly_surfaced'), 0)::BIGINT,
            COALESCE(SUM(ABS(c.diff_eff_cents))
                     FILTER (WHERE c.classification = 'mismatch'), 0)::BIGINT
        FROM compare_resolved_vs_snapshot(v_month) c;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION compare_resolved_vs_snapshot_range(DATE, DATE) IS
    'Phase 2 proof aggregate. Per-month counts by classification plus '
    'milestone_mismatch_count, newly_surfaced_cents and mismatch_cents across '
    '[p_from, p_to]. mismatch_count/mismatch_cents are EFFECTIVE-revenue driven '
    '(COALESCE(override, billed)), so they cover the milestone axis. Zero parity '
    'proof = mismatch_count = 0 AND mismatch_cents = 0 for every month. '
    'Read-only.';

-- ============================================================================
-- STEP 4: Least-privilege grants (REVOKE default PUBLIC, service_role only)
-- ============================================================================

REVOKE ALL ON FUNCTION compare_resolved_vs_snapshot(DATE)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_newly_surfaced_revenue(DATE, DATE)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION compare_resolved_vs_snapshot_range(DATE, DATE) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION compare_resolved_vs_snapshot(DATE)             TO service_role;
GRANT EXECUTE ON FUNCTION report_newly_surfaced_revenue(DATE, DATE)      TO service_role;
GRANT EXECUTE ON FUNCTION compare_resolved_vs_snapshot_range(DATE, DATE) TO service_role;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (run manually if this migration must be reverted)
-- ============================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS compare_resolved_vs_snapshot_range(DATE, DATE);
--   DROP FUNCTION IF EXISTS report_newly_surfaced_revenue(DATE, DATE);
--   DROP FUNCTION IF EXISTS compare_resolved_vs_snapshot(DATE);
-- COMMIT;
-- ============================================================================
