-- ============================================================================
-- Migration 117 — Phase 2: Read-time resolution authority + SHADOW view
-- (NOT cut over — pure resolution exposed for PARITY comparison only)
-- ============================================================================
-- Purpose:
--   Build the read-time authority that resolves a project-month's contractual
--   revenue from the billing contract + activity, so that "no snapshot row"
--   still yields the correct amount. This phase wires NOTHING into any live
--   consumer; it only adds:
--
--     PART 1. resolve_month_project_revenue(p_month DATE) — a SET-RETURNING
--             function producing ONE row per CANONICAL project (members
--             excluded, preserving the migration-050 no-double-count invariant)
--             that, for that month, has ANY of:
--               (a) timesheet activity (task_monthly_totals minutes > 0),
--               (b) an effective minimum-hours floor (DIRECT semantics — same as
--                   migration 113 / migration 095: latest project_monthly_billing_limits
--                   row with limits_month <= month, NO first_seen backfill),
--               (c) an active linked revenue_milestone (billings.linked_project_id),
--               (d) a fixed/standalone billing attributable at project grain
--                   (a linked revenue_milestone is the only project-grain
--                   billing; non-linked fixed billings are company-grain and are
--                   intentionally NOT attributed to a project here — see note),
--               (e) carryover-IN (project_carryover_hours.carryover_month = month).
--             For each such project it calls the PURE
--             resolve_project_month_revenue(project_id, month) (migration 116)
--             and returns that record plus project_id, company_id, summary_month.
--
--     PART 2. v_resolved_project_monthly_revenue — a SHADOW VIEW exposing the
--             PURE resolution output across a sensible month range, for PARITY
--             comparison against project_monthly_summary. This view is NOT a
--             consumer of, and does NOT replace, alter, or shadow:
--               - v_canonical_project_monthly_summary (migration 050)
--               - v_combined_revenue_by_company_month (migrations 047/050)
--             Those remain the live read surfaces, UNTOUCHED.
--             The shadow view exposes PURE resolution only — it does NOT COALESCE
--             the snapshot. Snapshot-precedence for closed months and the actual
--             cutover are a LATER phase.
--
-- Project-grain attribution note (universe rule (d)):
--   The only billing that is attributable to a single project is a
--   revenue_milestone with linked_project_id set (migration 036 rule 1;
--   milestone override handled in migrations 047/051). All other billing types
--   (service_fee, subscription, license, reimbursement, unlinked milestones)
--   are COMPANY-grain (monthly_fixed_billing_summary, migration 047) and have
--   no project to attribute to; including them per-project would double-count
--   against the company-grain fixed total. So universe rule (d) collapses into
--   rule (c): a linked revenue_milestone. This is called out explicitly so the
--   universe stays the no-double-count-safe set.
--
-- WHY this is safe (blast radius):
--   - ADDITIVE ONLY: one new set-returning function + one new shadow view.
--     No existing table, function, view, trigger, or grant is modified.
--   - The shadow view is not referenced by any frontend, edge function, RPC,
--     report, or QBO path. It exists purely so the orchestrator can diff
--     resolution vs snapshot before any future cutover.
--   - Members are excluded via v_project_table_entities (migration 058), the
--     same canonical filter recalculate_month() (migration 044) and migration
--     113 use, so the migration-050 double-count invariant is preserved.
--   - resolve_month_project_revenue and the shadow view only READ; the pure
--     resolver they call is itself read-only/STABLE (migration 116).
--   - Least privilege (lesson from migration 113): REVOKE default PUBLIC/anon/
--     authenticated on the new function; GRANT EXECUTE to service_role ONLY.
--   - RLS / over-exposure: see PART 2 — we set security_invoker=on when the
--     server supports it (PG15+, which Supabase runs) so base-table RLS still
--     applies to the view and rate/limit config is not over-exposed. We do NOT
--     grant SELECT on any rate/limits config table to authenticated beyond what
--     already exists; the shadow view is granted to service_role only.
--
-- This migration changes NO tables and NO existing objects. No frontend, edge
-- function, or QBO change.
--
-- PROOF / PARITY PROCEDURE for the orchestrator (READ-ONLY; DO NOT run here):
--   After applying 116 and 117, for any closed month m where a snapshot exists,
--   confirm the pure resolution matches the stored snapshot field-for-field for
--   projects that have a snapshot row:
--     SELECT r.project_id, r.summary_month,
--            r.billed_revenue_cents  AS resolved_billed,
--            pms.billed_revenue_cents AS snapshot_billed,
--            r.billed_hours          AS resolved_billed_hours,
--            pms.billed_hours        AS snapshot_billed_hours
--     FROM v_resolved_project_monthly_revenue r
--     JOIN project_monthly_summary pms
--       ON pms.project_id = r.project_id
--      AND pms.summary_month = r.summary_month
--     WHERE r.summary_month = m
--       AND ( r.billed_revenue_cents IS DISTINCT FROM pms.billed_revenue_cents
--          OR r.billed_hours        IS DISTINCT FROM pms.billed_hours );
--     -- Expected: zero rows for any month already reconciled by migration 116's
--     -- proof procedure. Rows that appear in the resolved view but NOT in
--     -- project_monthly_summary are the "no snapshot row, contractual amount"
--     -- universe this phase is designed to surface (e.g. zero-hour floor
--     -- projects not yet materialized by migration 113).
-- ============================================================================

BEGIN;

-- ============================================================================
-- Report the detected PostgreSQL server version (informational; gates
-- security_invoker on the shadow view in PART 2).
-- ============================================================================
DO $$
DECLARE
    v_num INTEGER := current_setting('server_version_num')::INTEGER;
    v_str TEXT := current_setting('server_version');
BEGIN
    RAISE NOTICE 'Migration 117: detected PostgreSQL server_version = % (server_version_num = %)',
        v_str, v_num;
    IF v_num >= 150000 THEN
        RAISE NOTICE '  -> security_invoker views supported; shadow view will use security_invoker=on.';
    ELSE
        RAISE NOTICE '  -> security_invoker NOT supported on this server; see PART 2 RLS follow-up.';
    END IF;
END $$;

-- ============================================================================
-- PART 1: resolve_month_project_revenue(p_month DATE) -> SETOF resolved rows
-- ============================================================================
-- Composite shape: project_month_revenue (migration 116) + project_id,
-- company_id, summary_month. We declare an explicit RETURNS TABLE matching the
-- contract so a parallel agent can rely on exact column names/order.
CREATE OR REPLACE FUNCTION resolve_month_project_revenue(p_month DATE)
RETURNS TABLE (
    project_id                UUID,
    company_id                UUID,
    summary_month             DATE,
    actual_minutes            INTEGER,
    rounded_minutes           INTEGER,
    actual_hours              NUMERIC(10,2),
    rounded_hours             NUMERIC(10,2),
    carryover_in_hours        NUMERIC(10,2),
    adjusted_hours            NUMERIC(10,2),
    billed_hours              NUMERIC(10,2),
    unbillable_hours          NUMERIC(10,2),
    carryover_out_hours       NUMERIC(10,2),
    minimum_padding_hours     NUMERIC(10,2),
    minimum_applied           BOOLEAN,
    maximum_applied           BOOLEAN,
    has_billing_limits        BOOLEAN,
    is_active_used            BOOLEAN,
    base_revenue_cents        BIGINT,
    billed_revenue_cents      BIGINT,
    milestone_override_cents  BIGINT,
    rate_used                 NUMERIC(10,2),
    rate_source               TEXT,
    rounding_used             INTEGER,
    minimum_hours_config      NUMERIC(10,2),
    maximum_hours_config      NUMERIC(10,2),
    carryover_enabled_config  BOOLEAN,
    resource_count            INTEGER,
    task_count                INTEGER,
    source_entry_count        INTEGER
)
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_proj  RECORD;
    v_rec   project_month_revenue;
    v_pid   UUID;
    v_cid   UUID;
BEGIN
    -- Build the universe: canonical projects (members excluded via
    -- v_project_table_entities) that have ANY qualifying signal for v_month.
    FOR v_proj IN
        SELECT vte.id AS project_id, vte.company_id AS company_id
        FROM v_project_table_entities vte
        WHERE
            -- (a) timesheet activity (task_monthly_totals stores canonical pids;
            --     members already excluded so vte.id IS the canonical id)
            EXISTS (
                SELECT 1 FROM task_monthly_totals tmt
                WHERE tmt.project_id = vte.id
                  AND tmt.summary_month = v_month
                  AND COALESCE(tmt.actual_minutes, 0) > 0
            )
            -- (b) effective minimum-hours floor (DIRECT semantics: latest
            --     limits row <= month, NO first_seen backfill — matches
            --     migrations 095 & 113)
            OR EXISTS (
                SELECT 1
                FROM (
                    SELECT l.minimum_hours
                    FROM project_monthly_billing_limits l
                    WHERE l.project_id = vte.id
                      AND l.limits_month <= v_month
                    ORDER BY l.limits_month DESC
                    LIMIT 1
                ) lim
                WHERE lim.minimum_hours IS NOT NULL
            )
            -- (c)/(d) active linked revenue_milestone (the only project-grain
            --     billing; collapses universe rule (d) per header note)
            OR EXISTS (
                SELECT 1 FROM billings b
                WHERE b.type = 'revenue_milestone'
                  AND b.linked_project_id = vte.id
            )
            -- (e) carryover-IN into this month
            OR EXISTS (
                SELECT 1 FROM project_carryover_hours pch
                WHERE pch.project_id = vte.id
                  AND pch.carryover_month = v_month
                  AND COALESCE(pch.carryover_hours, 0) > 0
            )
    LOOP
        v_pid := v_proj.project_id;
        v_cid := v_proj.company_id;

        -- Reuse the single shared pure routine (migration 116).
        SELECT * INTO v_rec FROM resolve_project_month_revenue(v_pid, v_month);

        -- Skip projects whose resolver returned NULL (missing/NULL-company).
        IF v_rec IS NULL THEN
            CONTINUE;
        END IF;

        project_id               := v_pid;
        company_id               := v_cid;
        summary_month            := v_month;
        actual_minutes           := v_rec.actual_minutes;
        rounded_minutes          := v_rec.rounded_minutes;
        actual_hours             := v_rec.actual_hours;
        rounded_hours            := v_rec.rounded_hours;
        carryover_in_hours       := v_rec.carryover_in_hours;
        adjusted_hours           := v_rec.adjusted_hours;
        billed_hours             := v_rec.billed_hours;
        unbillable_hours         := v_rec.unbillable_hours;
        carryover_out_hours      := v_rec.carryover_out_hours;
        minimum_padding_hours    := v_rec.minimum_padding_hours;
        minimum_applied          := v_rec.minimum_applied;
        maximum_applied          := v_rec.maximum_applied;
        has_billing_limits       := v_rec.has_billing_limits;
        is_active_used           := v_rec.is_active_used;
        base_revenue_cents       := v_rec.base_revenue_cents;
        billed_revenue_cents     := v_rec.billed_revenue_cents;
        milestone_override_cents := v_rec.milestone_override_cents;
        rate_used                := v_rec.rate_used;
        rate_source              := v_rec.rate_source;
        rounding_used            := v_rec.rounding_used;
        minimum_hours_config     := v_rec.minimum_hours_config;
        maximum_hours_config     := v_rec.maximum_hours_config;
        carryover_enabled_config := v_rec.carryover_enabled_config;
        resource_count           := v_rec.resource_count;
        task_count               := v_rec.task_count;
        source_entry_count       := v_rec.source_entry_count;

        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_month_project_revenue(DATE) IS
    'READ-ONLY, STABLE read-time resolution authority. Returns ONE row per '
    'canonical project (members excluded via v_project_table_entities) that for '
    'the month has any of: timesheet activity, an effective minimum-hours floor '
    '(DIRECT semantics), a linked revenue_milestone, or carryover-in. Calls the '
    'pure resolve_project_month_revenue() (migration 116) for each. Includes '
    'project_id and company_id. NOT wired into any live consumer. service_role only.';

REVOKE ALL ON FUNCTION resolve_month_project_revenue(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_month_project_revenue(DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_month_project_revenue(DATE) TO service_role;

-- ============================================================================
-- PART 2: SHADOW view v_resolved_project_monthly_revenue (parity only)
-- ============================================================================
-- Exposes PURE resolution across a sensible month range. The range is driven by
-- the months that already exist in project_monthly_summary (so parity diffs
-- line up with reconciled months) UNION the current month, so a zero-activity
-- floor project in the current month still surfaces even before it is
-- materialized. No COALESCE against the snapshot (cutover is a later phase).
--
-- Column set: project_monthly_summary's key computed columns + project_id,
-- company_id, summary_month (per the interface contract).
DROP VIEW IF EXISTS v_resolved_project_monthly_revenue;
CREATE VIEW v_resolved_project_monthly_revenue AS
WITH months AS (
    SELECT DISTINCT pms.summary_month AS m
    FROM project_monthly_summary pms
    UNION
    SELECT DATE_TRUNC('month', CURRENT_DATE)::DATE
)
SELECT
    r.project_id,
    r.company_id,
    r.summary_month,
    r.actual_minutes,
    r.rounded_minutes,
    r.actual_hours,
    r.rounded_hours,
    r.carryover_in_hours,
    r.adjusted_hours,
    r.billed_hours,
    r.unbillable_hours,
    r.carryover_out_hours,
    r.minimum_padding_hours,
    r.minimum_applied,
    r.maximum_applied,
    r.has_billing_limits,
    r.is_active_used,
    r.base_revenue_cents,
    r.billed_revenue_cents,
    r.milestone_override_cents,
    r.rate_used,
    r.rate_source,
    r.rounding_used,
    r.minimum_hours_config,
    r.maximum_hours_config,
    r.carryover_enabled_config,
    r.resource_count,
    r.task_count,
    r.source_entry_count
FROM months
CROSS JOIN LATERAL resolve_month_project_revenue(months.m) r;

COMMENT ON VIEW v_resolved_project_monthly_revenue IS
    'SHADOW view (parity comparison ONLY — NOT a live consumer surface). Exposes '
    'the PURE read-time resolution (resolve_month_project_revenue -> '
    'resolve_project_month_revenue) across months present in project_monthly_summary '
    'plus the current month. Does NOT COALESCE the snapshot. Does NOT replace or '
    'alter v_canonical_project_monthly_summary or v_combined_revenue_by_company_month. '
    'Cutover and closed-month snapshot precedence are a later phase.';

-- security_invoker: when supported (PG15+, which Supabase runs), set it so the
-- view enforces the querying role's RLS on base tables and does not over-expose
-- rate/limit config. If the server predates PG15, the ALTER below is skipped and
-- the RLS follow-up is documented (the view is in any case granted to
-- service_role ONLY, so authenticated/anon cannot read it regardless).
DO $$
BEGIN
    IF current_setting('server_version_num')::INTEGER >= 150000 THEN
        EXECUTE 'ALTER VIEW v_resolved_project_monthly_revenue SET (security_invoker = on)';
        RAISE NOTICE 'Migration 117: v_resolved_project_monthly_revenue security_invoker = on';
    ELSE
        RAISE NOTICE 'Migration 117: security_invoker NOT set (server < PG15).';
        RAISE NOTICE '  RLS FOLLOW-UP: view runs with owner privileges. It is granted to '
                     'service_role ONLY (no authenticated/anon grant), so config columns are '
                     'not exposed to app users. If this view is ever granted to authenticated, '
                     'first upgrade to PG15+ and enable security_invoker, OR replace it with a '
                     'revenue-only projection that omits rate_used/rounding_used/*_config.';
    END IF;
END $$;

-- Least privilege: the shadow view exposes config columns (rate/limits). Grant
-- to service_role ONLY. Do NOT grant to authenticated/anon (no over-exposure;
-- no new grant on any rate/limits config table either).
REVOKE ALL ON v_resolved_project_monthly_revenue FROM PUBLIC;
REVOKE ALL ON v_resolved_project_monthly_revenue FROM anon, authenticated;
GRANT SELECT ON v_resolved_project_monthly_revenue TO service_role;

-- ============================================================================
-- Verification (informational only)
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration 117 Complete:';
    RAISE NOTICE '  - Added resolve_month_project_revenue(DATE) SETOF resolved rows (service_role only)';
    RAISE NOTICE '  - Added SHADOW view v_resolved_project_monthly_revenue (service_role only)';
    RAISE NOTICE '  - NOTHING cut over: live views/consumers untouched';
    RAISE NOTICE '  - v_canonical_project_monthly_summary / v_combined_revenue_by_company_month UNCHANGED';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (manual; run inside a transaction)
-- ============================================================================
-- Purely additive. To fully reverse:
--
--   BEGIN;
--   DROP VIEW IF EXISTS v_resolved_project_monthly_revenue;
--   DROP FUNCTION IF EXISTS resolve_month_project_revenue(DATE);
--   COMMIT;
--
-- (The composite type project_month_revenue and resolve_project_month_revenue
--  belong to migration 116; do NOT drop them here.)
-- ============================================================================
