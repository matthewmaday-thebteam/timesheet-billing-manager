-- ============================================================================
-- Migration 116 — Phase 1: Extract the shared billing rule routine
-- (BEHAVIOR-PRESERVING / PURE EXTRACTION — ZERO behavior change)
-- ============================================================================
-- Purpose:
--   The billing engine recalculate_project_month() (current canonical
--   definition in migration 095, calculation_version 'v2.1-tmt-canonical')
--   INLINES every billing rule AND performs I/O in the same function body:
--     - reads task_monthly_totals / timesheet_daily_rollups / carryover
--     - UPSERTs the project_monthly_summary snapshot row
--     - WRITEs project_carryover_hours and cascades via recalculation_queue
--
--   To enable a future read-time resolution path (resolving a project-month's
--   contractual revenue WITHOUT a snapshot row), the PURE rule body must live
--   in ONE shared routine that both the write engine and the read path call.
--
--   This migration:
--     PART 1. Creates resolve_project_month_revenue(uuid, date) — a PURE,
--             READ-ONLY, STABLE function that RETURNS a composite record with
--             EVERY computed field the snapshot stores at project grain. It
--             reuses the EXACT logic currently inlined in
--             recalculate_project_month (migration 095) — same canonical
--             grouping, same rounding-mode column selection, same effective
--             rate/rounding resolvers, same DIRECT limit/active-status
--             semantics (latest config row <= month, NO first_seen backfill),
--             same min/max/carryover ordering, same revenue-cents formula.
--             It does NOT write anything and does NOT cascade. It RETURNS the
--             computed carryover_out value as a figure only.
--     PART 2. Refactors recalculate_project_month() to be a thin shell:
--               SELECT * INTO v FROM resolve_project_month_revenue(...);
--               <existing UPSERT into project_monthly_summary using v>
--               <existing STEP 7 invoiced read, STEP 8/9 carryover WRITE +
--                queue cascade — byte-identical to migration 095>
--             The engine's OBSERVABLE behavior (the snapshot row it writes and
--             the cascade it performs) is UNCHANGED. calculation_version stays
--             'v2.1-tmt-canonical'.
--
-- WHY this is safe (blast radius):
--   - PURE EXTRACTION. No rule, rounding, ordering, gating, or edge case is
--     altered. The arithmetic that produced every field before now produces it
--     inside resolve_project_month_revenue and is copied back verbatim into the
--     UPSERT. compare_summary_vs_recomputed() (migration 095 Part 2) is left
--     UNTOUCHED and remains an independent oracle for parity checking.
--   - The pure function deliberately EXCLUDES the per-company invoiced read
--     (migration 095 STEP 7) and the snapshot/cascade I/O (STEP 8/9). Those
--     remain in the write engine exactly as before. invoiced_revenue_cents is
--     company-grain, not a project-grain rule output, and is NOT part of the
--     read-path contract; keeping it in the shell preserves the exact written
--     row while keeping resolve_project_month_revenue strictly side-effect-free.
--   - milestone_override_cents is returned by the pure function using the EXACT
--     COALESCE semantics of recalculate_fixed_billing_month (migrations 047/051:
--     LEFT JOIN billing_transactions => override = 0 when a linked
--     revenue_milestone exists but has no transactions in the month; NULL when
--     no linked revenue_milestone billing exists at all). The WRITE engine does
--     NOT and never did set milestone_override_cents (that column is owned by
--     recalculate_fixed_billing_month). The refactored engine therefore does
--     NOT touch milestone_override_cents in its UPSERT — preserving migration
--     047/051 ownership and the existing written row exactly. The field is
--     surfaced ONLY through the pure function for the read path's benefit.
--   - Lock-down: Postgres grants EXECUTE to PUBLIC by default on every new
--     function (lesson from migration 113). We REVOKE PUBLIC/anon/authenticated
--     and GRANT EXECUTE on resolve_project_month_revenue to service_role ONLY.
--
-- This migration changes NO tables. It changes ONE existing function
-- (recalculate_project_month) into a behavior-identical thin shell and ADDS one
-- new pure function. No frontend, edge function, or QBO change.
--
-- ----------------------------------------------------------------------------
-- RULE MAP (R1–R11): inline location in migration 095  ->  new home here
-- ----------------------------------------------------------------------------
--   R1  Canonical grouping (build v_project_ids; resolve member->canonical for
--       task_monthly_totals)          095 L97-110, L166-172  -> resolve_* L"BUILD
--                                                                CANONICAL GROUP"
--   R2  Rounding mode column select (entry->rounded_entry_minutes /
--       task->rounded_task_minutes)   095 L187-196           -> resolve_* STEP 3
--   R3  Hours rounding via billing_round_hours
--                                     095 L214-217           -> resolve_* STEP 4
--   R4  Effective rate (+ default)    095 L116-118,146       -> resolve_* STEP 1
--   R5  Carryover-IN (READ from project_carryover_hours; NOT re-derived)
--                                     095 L152-156           -> resolve_* STEP 2
--   R6  Minimum floor (gated on R9)   095 L223-227           -> resolve_* STEP 5
--   R7  Maximum cap (+ excess split)  095 L229-243           -> resolve_* STEP 5
--   R8  Carryover-OUT VALUE (figure only; NOT written here)
--                                     095 L237-241           -> resolve_* STEP 5
--                                     (the WRITE stays in engine STEP 9)
--   R9  is_active gate for minimum    095 L135-143,223       -> resolve_* STEP 1
--   R10 Revenue cents (base/billed)   095 L249-250           -> resolve_* STEP 6
--   R11 Milestone override (COALESCE) 047 L110-126 / 051 L39-56 (engine never
--                                     set it)               -> resolve_* STEP 7
-- ----------------------------------------------------------------------------
--
-- PROOF PROCEDURE for the orchestrator to run AFTER applying (READ-ONLY here;
-- DO NOT run in this migration):
--   1. BEFORE applying 116, snapshot current golden state for the live months:
--        SELECT snapshot_billing_month(m, 'pre-116')   -- migration 048
--        for each month with summary rows (e.g. 2026-01-01 .. current).
--   2. Apply migration 116.
--   3. Recompute every snapshotted month through the refactored engine:
--        SELECT recalculate_month(m);                  -- migration 044
--      (recalculate_month -> recalculate_project_month, now the thin shell).
--   4. Confirm ZERO drift vs the pre-116 golden snapshot:
--        SELECT * FROM verify_all_billing_months();    -- migration 048
--        -- every month must report status 'PASS' (discrepancy_count = 0)
--      and, as an independent oracle (does not read the snapshot table):
--        SELECT * FROM compare_summary_vs_recomputed(NULL) WHERE has_discrepancy;
--        -- must return zero rows.
--   5. Spot-check the pure function directly equals the written row for a few
--      (project, month) pairs:
--        SELECT (r).billed_revenue_cents, pms.billed_revenue_cents
--        FROM resolve_project_month_revenue(:pid, :m) r
--        JOIN project_monthly_summary pms
--          ON pms.project_id = :pid AND pms.summary_month = :m ON TRUE;
--        -- all compared fields must be equal.
--   Any non-PASS / non-empty result => DO NOT proceed; roll back via the DOWN
--   block below.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 0: Composite return type for the pure resolver
-- ============================================================================
-- One field per project-grain computed value the snapshot stores. Mirrors
-- project_monthly_summary column types (migration 044) so callers can map 1:1.
-- (invoiced_revenue_cents is intentionally NOT included — it is company-grain
--  and remains owned by the write engine; see header.)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'project_month_revenue'
    ) THEN
        CREATE TYPE project_month_revenue AS (
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
        );
    END IF;
END $$;

-- ============================================================================
-- PART 1: PURE resolver — resolve_project_month_revenue(uuid, date)
-- ============================================================================
-- READ-ONLY. STABLE. No INSERT/UPDATE/DELETE. No cascade. Returns the computed
-- carryover_out value (R8) as a figure only.
CREATE OR REPLACE FUNCTION resolve_project_month_revenue(
    p_project_id UUID,
    p_month      DATE
)
RETURNS project_month_revenue
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_external_project_id TEXT;
    v_company_id UUID;

    -- Billing config
    v_rate NUMERIC(10,2);
    v_rate_source TEXT;
    v_rounding INTEGER;
    v_rounding_mode TEXT;
    v_minimum_hours NUMERIC(10,2);
    v_maximum_hours NUMERIC(10,2);
    v_is_active BOOLEAN;
    v_carryover_enabled BOOLEAN;
    v_carryover_in NUMERIC(10,2) := 0;

    -- Calculated values
    v_actual_minutes INTEGER := 0;
    v_rounded_minutes INTEGER := 0;
    v_actual_hours NUMERIC(10,2);
    v_rounded_hours NUMERIC(10,2);
    v_adjusted_hours NUMERIC(10,2);
    v_billed_hours NUMERIC(10,2);
    v_unbillable_hours NUMERIC(10,2) := 0;
    v_carryover_out NUMERIC(10,2) := 0;
    v_minimum_padding NUMERIC(10,2) := 0;
    v_minimum_applied BOOLEAN := false;
    v_maximum_applied BOOLEAN := false;
    v_has_billing_limits BOOLEAN := false;
    v_base_revenue_cents BIGINT;
    v_billed_revenue_cents BIGINT;
    v_milestone_override_cents BIGINT := NULL;
    v_resource_count INTEGER := 0;
    v_task_count INTEGER := 0;
    v_entry_count INTEGER := 0;

    -- Member project IDs for canonical grouping (R1)
    v_project_ids UUID[];

    -- Canonical project ID for task_monthly_totals lookup (R1, migration 095)
    v_canonical_project_id UUID;

    v_result project_month_revenue;
BEGIN
    -- =========================================
    -- RESOLVE PROJECT INFO
    -- =========================================
    SELECT p.project_id, p.company_id
    INTO v_external_project_id, v_company_id
    FROM projects p WHERE p.id = p_project_id;

    IF v_external_project_id IS NULL THEN
        RAISE WARNING 'Project % not found', p_project_id;
        RETURN NULL;
    END IF;

    IF v_company_id IS NULL THEN
        RAISE WARNING 'Project % has NULL company_id', p_project_id;
        RETURN NULL;
    END IF;

    -- =========================================
    -- R1: BUILD CANONICAL PROJECT GROUP
    -- (verbatim from migration 095 L97-110)
    -- =========================================
    SELECT ARRAY_AGG(sub.pid)
    INTO v_project_ids
    FROM (
        SELECT p_project_id AS pid
        UNION
        SELECT pgm.member_project_id
        FROM project_groups pg
        JOIN project_group_members pgm ON pgm.group_id = pg.id
        WHERE pg.primary_project_id = p_project_id
    ) sub;

    IF v_project_ids IS NULL THEN
        v_project_ids := ARRAY[p_project_id];
    END IF;

    -- =========================================
    -- STEP 1: GET BILLING CONFIGURATION
    -- R4 (rate), R2 (rounding mode), limits (DIRECT semantics), R9 (is_active)
    -- (verbatim from migration 095 L116-147)
    -- =========================================
    SELECT r.effective_rate, r.source
    INTO v_rate, v_rate_source
    FROM get_effective_project_rate(p_project_id, v_month) r;

    SELECT r.effective_rounding, r.effective_rounding_mode
    INTO v_rounding, v_rounding_mode
    FROM get_effective_project_rounding(p_project_id, v_month) r;

    -- DIRECT limit semantics: latest config row <= month, NO first_seen backfill
    SELECT
        l.minimum_hours,
        l.maximum_hours,
        COALESCE(l.carryover_enabled, false)
    INTO v_minimum_hours, v_maximum_hours, v_carryover_enabled
    FROM project_monthly_billing_limits l
    WHERE l.project_id = p_project_id
        AND l.limits_month <= v_month
    ORDER BY l.limits_month DESC
    LIMIT 1;

    -- R9: is_active gate (DIRECT semantics; default true)
    SELECT COALESCE(s.is_active, true)
    INTO v_is_active
    FROM project_monthly_active_status s
    WHERE s.project_id = p_project_id
        AND s.status_month <= v_month
    ORDER BY s.status_month DESC
    LIMIT 1;

    v_is_active := COALESCE(v_is_active, true);
    v_rounding := COALESCE(v_rounding, get_default_rounding_increment());
    v_rounding_mode := COALESCE(v_rounding_mode, 'task');
    v_rate := COALESCE(v_rate, get_default_rate());
    v_carryover_enabled := COALESCE(v_carryover_enabled, false);

    -- =========================================
    -- STEP 2: R5 — CARRYOVER-IN (READ ONLY; do NOT re-derive the chain)
    -- (verbatim from migration 095 L152-156)
    -- =========================================
    SELECT COALESCE(SUM(pch.carryover_hours), 0)
    INTO v_carryover_in
    FROM project_carryover_hours pch
    WHERE pch.project_id = p_project_id
        AND pch.carryover_month = v_month;

    v_has_billing_limits := (v_minimum_hours IS NOT NULL
                          OR v_maximum_hours IS NOT NULL
                          OR v_carryover_in > 0);

    -- =========================================
    -- R1: Resolve member -> canonical for task_monthly_totals lookup
    -- (verbatim from migration 095 L166-172)
    -- =========================================
    v_canonical_project_id := COALESCE(
        (SELECT pg.primary_project_id
         FROM project_groups pg
         JOIN project_group_members pgm ON pgm.group_id = pg.id
         WHERE pgm.member_project_id = p_project_id),
        p_project_id
    );

    -- =========================================
    -- STEP 3: R2 — READ PRE-COMPUTED TASK TOTALS (rounding-mode column select)
    -- (verbatim from migration 095 L187-209)
    -- =========================================
    SELECT
        COALESCE(SUM(tmt.actual_minutes), 0)::INTEGER,
        CASE WHEN v_rounding_mode = 'entry'
             THEN COALESCE(SUM(tmt.rounded_entry_minutes), 0)::INTEGER
             ELSE COALESCE(SUM(tmt.rounded_task_minutes), 0)::INTEGER
        END
    INTO v_actual_minutes, v_rounded_minutes
    FROM task_monthly_totals tmt
    WHERE tmt.project_id = v_canonical_project_id
      AND tmt.summary_month = v_month;

    -- Counts (still from timesheet_daily_rollups; verbatim from 095)
    SELECT
        COALESCE(COUNT(DISTINCT tdr.user_id), 0),
        COALESCE(COUNT(DISTINCT COALESCE(tdr.task_name, 'No Task')), 0),
        COALESCE(COUNT(*), 0)
    INTO v_resource_count, v_task_count, v_entry_count
    FROM timesheet_daily_rollups tdr
    JOIN projects p ON p.project_id = tdr.project_id
    WHERE p.id = ANY(v_project_ids)
        AND DATE_TRUNC('month', tdr.work_date)::DATE = v_month
        AND tdr.total_minutes > 0;

    -- =========================================
    -- STEP 4: R3 — CALCULATE HOURS (billing_round_hours)
    -- (verbatim from migration 095 L214-217)
    -- =========================================
    v_actual_hours := billing_round_hours(v_actual_minutes::NUMERIC / 60);
    v_rounded_hours := billing_round_hours(v_rounded_minutes::NUMERIC / 60);
    v_adjusted_hours := billing_round_hours(v_rounded_hours + v_carryover_in);
    v_billed_hours := v_adjusted_hours;

    -- =========================================
    -- STEP 5: R6 (min floor, gated R9), R7 (max cap), R8 (carryover-out VALUE)
    -- (verbatim from migration 095 L222-244)
    -- =========================================
    IF v_has_billing_limits THEN
        IF v_is_active AND v_minimum_hours IS NOT NULL AND v_adjusted_hours < v_minimum_hours THEN
            v_minimum_padding := billing_round_hours(v_minimum_hours - v_adjusted_hours);
            v_billed_hours := v_minimum_hours;
            v_minimum_applied := true;
        END IF;

        IF v_maximum_hours IS NOT NULL AND v_billed_hours > v_maximum_hours THEN
            DECLARE
                v_excess NUMERIC(10,2);
            BEGIN
                v_excess := billing_round_hours(v_billed_hours - v_maximum_hours);
                v_billed_hours := v_maximum_hours;
                v_maximum_applied := true;

                IF v_carryover_enabled THEN
                    -- R8: carryover-out VALUE only. The WRITE/cascade stays in
                    -- the write engine (recalculate_project_month STEP 9).
                    v_carryover_out := v_excess;
                ELSE
                    v_unbillable_hours := v_excess;
                END IF;
            END;
        END IF;
    END IF;

    -- =========================================
    -- STEP 6: R10 — REVENUE CENTS
    -- (verbatim from migration 095 L249-250)
    -- =========================================
    v_base_revenue_cents := ROUND(v_rounded_hours * v_rate * 100)::BIGINT;
    v_billed_revenue_cents := ROUND(v_billed_hours * v_rate * 100)::BIGINT;

    -- =========================================
    -- STEP 7: R11 — MILESTONE OVERRIDE (COALESCE semantics, migrations 047/051)
    -- READ-ONLY surfacing for the read path. The WRITE engine never set this
    -- column (recalculate_fixed_billing_month owns it). LEFT JOIN => override 0
    -- when a linked revenue_milestone exists but has no transactions in month;
    -- NULL when no linked revenue_milestone billing exists at all.
    -- =========================================
    SELECT sub.total_cents
    INTO v_milestone_override_cents
    FROM (
        SELECT COALESCE(SUM(bt.amount_cents), 0) AS total_cents
        FROM billings b
        LEFT JOIN billing_transactions bt
          ON bt.billing_id = b.id
          AND bt.transaction_month = v_month
        WHERE b.type = 'revenue_milestone'
          AND b.linked_project_id = p_project_id
        HAVING COUNT(b.id) > 0
    ) sub;
    -- (If no linked revenue_milestone billing exists, the subquery returns no
    --  row and v_milestone_override_cents stays NULL — exactly migration 051's
    --  "no override" semantics.)

    -- =========================================
    -- ASSEMBLE RESULT (project-grain only; no I/O performed)
    -- =========================================
    v_result.actual_minutes           := v_actual_minutes;
    v_result.rounded_minutes          := v_rounded_minutes;
    v_result.actual_hours             := v_actual_hours;
    v_result.rounded_hours            := v_rounded_hours;
    v_result.carryover_in_hours       := v_carryover_in;
    v_result.adjusted_hours           := v_adjusted_hours;
    v_result.billed_hours             := v_billed_hours;
    v_result.unbillable_hours         := v_unbillable_hours;
    v_result.carryover_out_hours      := v_carryover_out;
    v_result.minimum_padding_hours    := v_minimum_padding;
    v_result.minimum_applied          := v_minimum_applied;
    v_result.maximum_applied          := v_maximum_applied;
    v_result.has_billing_limits       := v_has_billing_limits;
    v_result.is_active_used           := v_is_active;
    v_result.base_revenue_cents       := v_base_revenue_cents;
    v_result.billed_revenue_cents     := v_billed_revenue_cents;
    v_result.milestone_override_cents := v_milestone_override_cents;
    v_result.rate_used                := v_rate;
    v_result.rate_source              := v_rate_source;
    v_result.rounding_used            := v_rounding;
    v_result.minimum_hours_config     := v_minimum_hours;
    v_result.maximum_hours_config     := v_maximum_hours;
    v_result.carryover_enabled_config := v_carryover_enabled;
    v_result.resource_count           := v_resource_count;
    v_result.task_count               := v_task_count;
    v_result.source_entry_count       := v_entry_count;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_project_month_revenue(UUID, DATE) IS
    'PURE, READ-ONLY, STABLE resolver for a single project-month. Returns a '
    'project_month_revenue record with every project-grain computed field the '
    'snapshot stores. Reuses the EXACT rules inlined in recalculate_project_month '
    '(migration 095, v2.1-tmt-canonical): canonical grouping, rounding-mode column '
    'select, effective rate/rounding, DIRECT limit/active semantics, min/max/'
    'carryover, revenue cents, plus milestone override via migrations 047/051 '
    'COALESCE semantics. Performs NO writes and NO cascade; carryover_out is a '
    'returned figure only. service_role only.';

-- Least privilege (lesson from migration 113): REVOKE the default PUBLIC grant
-- and anon/authenticated, then GRANT EXECUTE to service_role ONLY.
REVOKE ALL ON FUNCTION resolve_project_month_revenue(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_project_month_revenue(UUID, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_project_month_revenue(UUID, DATE) TO service_role;

-- ============================================================================
-- PART 2: Refactor recalculate_project_month() to a behavior-identical shell
-- ============================================================================
-- The function now: (a) SELECTs the pure record, (b) reads invoiced (STEP 7 of
-- 095, company-grain), (c) UPSERTs project_monthly_summary using the record —
-- column-for-column identical to migration 095 — and (d) performs the carryover
-- WRITE + queue cascade (STEP 9 of 095) verbatim. milestone_override_cents is
-- NOT written here (owned by recalculate_fixed_billing_month, migrations 047/051),
-- exactly as before this migration.
CREATE OR REPLACE FUNCTION recalculate_project_month(
    p_project_id UUID,      -- Internal projects.id (canonical/primary)
    p_month DATE
)
RETURNS VOID AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_company_id UUID;
    v_external_project_id TEXT;

    -- Pure rule output
    v project_month_revenue;

    -- Company-grain invoiced (migration 095 STEP 7) — stays in the write engine
    v_invoiced_revenue_cents BIGINT := 0;
BEGIN
    -- Resolve project info (mirror of migration 095 guard clauses, so behavior
    -- on missing project / NULL company is identical: WARNING + RETURN, no row).
    SELECT p.project_id, p.company_id
    INTO v_external_project_id, v_company_id
    FROM projects p WHERE p.id = p_project_id;

    IF v_external_project_id IS NULL THEN
        RAISE WARNING 'Project % not found', p_project_id;
        RETURN;
    END IF;

    IF v_company_id IS NULL THEN
        RAISE WARNING 'Project % has NULL company_id', p_project_id;
        RETURN;
    END IF;

    -- (a) Compute every project-grain field via the shared pure routine.
    SELECT * INTO v FROM resolve_project_month_revenue(p_project_id, v_month);

    IF v IS NULL THEN
        -- Defensive: resolver returned NULL only if project/company vanished
        -- between the guard above and the call. Match prior no-op behavior.
        RETURN;
    END IF;

    -- (b) STEP 7 (migration 095 L255-260): company-grain invoiced revenue.
    SELECT COALESCE(SUM(bt.amount_cents), 0)
    INTO v_invoiced_revenue_cents
    FROM billing_transactions bt
    JOIN billings b ON b.id = bt.billing_id
    WHERE b.company_id = v_company_id
        AND bt.transaction_month = v_month;

    -- (c) STEP 8 (migration 095 L265-317): UPSERT the snapshot row — identical
    -- column list, identical ON CONFLICT, identical calculation_version. Note:
    -- milestone_override_cents is intentionally NOT in this list (unchanged from
    -- migration 095; owned by recalculate_fixed_billing_month).
    INSERT INTO project_monthly_summary (
        summary_month, project_id, company_id,
        actual_minutes, rounded_minutes, actual_hours, rounded_hours,
        carryover_in_hours, adjusted_hours, billed_hours,
        unbillable_hours, carryover_out_hours, minimum_padding_hours,
        minimum_applied, maximum_applied, has_billing_limits, is_active_used,
        base_revenue_cents, billed_revenue_cents, invoiced_revenue_cents,
        rate_used, rate_source, rounding_used,
        minimum_hours_config, maximum_hours_config, carryover_enabled_config,
        resource_count, task_count, source_entry_count,
        calculated_at, calculation_version
    ) VALUES (
        v_month, p_project_id, v_company_id,
        v.actual_minutes, v.rounded_minutes, v.actual_hours, v.rounded_hours,
        v.carryover_in_hours, v.adjusted_hours, v.billed_hours,
        v.unbillable_hours, v.carryover_out_hours, v.minimum_padding_hours,
        v.minimum_applied, v.maximum_applied, v.has_billing_limits, v.is_active_used,
        v.base_revenue_cents, v.billed_revenue_cents, v_invoiced_revenue_cents,
        v.rate_used, v.rate_source, v.rounding_used,
        v.minimum_hours_config, v.maximum_hours_config, v.carryover_enabled_config,
        v.resource_count, v.task_count, v.source_entry_count,
        NOW(), 'v2.1-tmt-canonical'
    )
    ON CONFLICT (project_id, summary_month) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        actual_minutes = EXCLUDED.actual_minutes,
        rounded_minutes = EXCLUDED.rounded_minutes,
        actual_hours = EXCLUDED.actual_hours,
        rounded_hours = EXCLUDED.rounded_hours,
        carryover_in_hours = EXCLUDED.carryover_in_hours,
        adjusted_hours = EXCLUDED.adjusted_hours,
        billed_hours = EXCLUDED.billed_hours,
        unbillable_hours = EXCLUDED.unbillable_hours,
        carryover_out_hours = EXCLUDED.carryover_out_hours,
        minimum_padding_hours = EXCLUDED.minimum_padding_hours,
        minimum_applied = EXCLUDED.minimum_applied,
        maximum_applied = EXCLUDED.maximum_applied,
        has_billing_limits = EXCLUDED.has_billing_limits,
        is_active_used = EXCLUDED.is_active_used,
        base_revenue_cents = EXCLUDED.base_revenue_cents,
        billed_revenue_cents = EXCLUDED.billed_revenue_cents,
        invoiced_revenue_cents = EXCLUDED.invoiced_revenue_cents,
        rate_used = EXCLUDED.rate_used,
        rate_source = EXCLUDED.rate_source,
        rounding_used = EXCLUDED.rounding_used,
        minimum_hours_config = EXCLUDED.minimum_hours_config,
        maximum_hours_config = EXCLUDED.maximum_hours_config,
        carryover_enabled_config = EXCLUDED.carryover_enabled_config,
        resource_count = EXCLUDED.resource_count,
        task_count = EXCLUDED.task_count,
        source_entry_count = EXCLUDED.source_entry_count,
        calculated_at = NOW(),
        calculation_version = EXCLUDED.calculation_version;

    -- (d) STEP 9 (migration 095 L322-364): carryover-out WRITE + queue cascade,
    -- byte-identical. Uses v.carryover_out_hours / v.rounded_hours /
    -- v.maximum_hours_config / v.carryover_enabled_config from the pure record
    -- (same values the inline engine computed).
    DECLARE
        v_old_carryover_out NUMERIC(10,2);
        v_next_month DATE := (v_month + INTERVAL '1 month')::DATE;
    BEGIN
        SELECT COALESCE(SUM(pch.carryover_hours), 0)
        INTO v_old_carryover_out
        FROM project_carryover_hours pch
        WHERE pch.project_id = p_project_id
            AND pch.source_month = v_month;

        IF v.carryover_out_hours IS DISTINCT FROM v_old_carryover_out THEN
            IF v.carryover_enabled_config AND v.carryover_out_hours > 0 THEN
                INSERT INTO project_carryover_hours (
                    project_id, carryover_month, source_month,
                    carryover_hours, actual_hours_worked, maximum_applied
                ) VALUES (
                    p_project_id, v_next_month, v_month,
                    v.carryover_out_hours, v.rounded_hours, v.maximum_hours_config
                )
                ON CONFLICT (project_id, carryover_month, source_month) DO UPDATE SET
                    carryover_hours = EXCLUDED.carryover_hours,
                    actual_hours_worked = EXCLUDED.actual_hours_worked,
                    maximum_applied = EXCLUDED.maximum_applied,
                    calculated_at = NOW();

                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (p_project_id, v_next_month, 'cascade')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;

            ELSIF v_old_carryover_out > 0 THEN
                DELETE FROM project_carryover_hours
                WHERE project_id = p_project_id
                    AND source_month = v_month
                    AND carryover_month = v_next_month;

                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (p_project_id, v_next_month, 'cascade')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;
            END IF;
        END IF;
    END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_project_month(UUID, DATE) IS
    'Recalculate billing summary for a single canonical project in a given month. '
    'v2.1-tmt-canonical (migration 116 refactor): now a thin shell that calls the '
    'PURE resolve_project_month_revenue() for all project-grain rules, then performs '
    'the same company-grain invoiced read, the same project_monthly_summary UPSERT, '
    'and the same carryover-out WRITE + queue cascade as migration 095. Observable '
    'behavior (written row + cascade) is byte-identical. Idempotent.';

-- ============================================================================
-- Verification (informational only — does NOT run the proof procedure)
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration 116 Complete:';
    RAISE NOTICE '  - Added composite type project_month_revenue';
    RAISE NOTICE '  - Added PURE resolve_project_month_revenue(UUID, DATE) (service_role only)';
    RAISE NOTICE '  - Refactored recalculate_project_month() to a behavior-identical shell';
    RAISE NOTICE '  - calculation_version unchanged: v2.1-tmt-canonical';
    RAISE NOTICE '  - No table changes; compare_summary_vs_recomputed() untouched';
    RAISE NOTICE '';
    RAISE NOTICE '  RUN THE PROOF PROCEDURE (see header) BEFORE trusting this in prod:';
    RAISE NOTICE '    1. snapshot_billing_month(m, ''pre-116'') BEFORE applying';
    RAISE NOTICE '    2. recalculate_month(m) for each month AFTER applying';
    RAISE NOTICE '    3. verify_all_billing_months()  -> every month PASS';
    RAISE NOTICE '    4. compare_summary_vs_recomputed(NULL) WHERE has_discrepancy -> 0 rows';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (manual; run inside a transaction)
-- ============================================================================
-- Restores the migration-095 inline definition of recalculate_project_month
-- and drops the new pure function + composite type. The prior body is the
-- v2.1-tmt-canonical definition in
--   supabase/migrations/095_fix_canonical_in_billing_engine.sql  (PART 1,
--   lines 30-366) — copy that CREATE OR REPLACE FUNCTION verbatim to restore.
--
--   BEGIN;
--   -- 1. Restore recalculate_project_month from migration 095 PART 1 verbatim
--   --    (CREATE OR REPLACE FUNCTION recalculate_project_month(UUID, DATE) ...
--   --     the full inline body, lines 30-366 of migration 095).
--   --    Paste it here exactly as it appears in 095.
--   --
--   -- 2. Drop the new pure function and composite type:
--   DROP FUNCTION IF EXISTS resolve_project_month_revenue(UUID, DATE);
--   DROP TYPE IF EXISTS project_month_revenue;
--   COMMIT;
--
-- Note: this DOWN block restores the EXACT prior engine. Because migration 116
-- is a pure extraction (no rule change), no project_monthly_summary data needs
-- correcting on rollback; the next recalc reproduces identical rows either way.
-- ============================================================================
