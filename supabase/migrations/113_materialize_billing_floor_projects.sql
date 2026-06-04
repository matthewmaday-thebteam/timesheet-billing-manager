-- ============================================================================
-- Migration 113: Materialize summary rows for floor/limit projects (zero activity)
-- ============================================================================
-- Purpose:
--   A project billed via a minimum-hours floor (or any active billing limit)
--   must still produce its floor revenue in a month where it logs ZERO time.
--
--   Today, project_monthly_summary rows are only created when the billing
--   engine runs for a (project, month). The activity-driven trigger
--   enqueue_affected_months() (migration 045, line 47) only enqueues a
--   (project, month) when n.total_minutes > 0. A floor project with zero
--   hours and no other recompute trigger is therefore never recomputed, so
--   no summary row is created and the floor revenue never materializes.
--
--   Live symptom: "Mission Impossible SLA"
--   (projects.id = 4cd86bfd-f3d5-4a6f-9ab5-60fd85c6af62) has effective
--   minimum_hours = 160 @ $60/hr = $9,600/mo, but has NO summary row for
--   2026-05-01 or 2026-06-01 because it logged no hours those months.
--
-- Fix (additive, idempotent):
--   New function materialize_billing_floor_projects(p_month DATE) that, for
--   the given month, finds every CANONICAL project (primaries + unassociated;
--   members excluded) whose EFFECTIVE BILLING MINIMUM the engine itself would
--   apply (resolved with the engine's exact direct semantics: the most recent
--   project_monthly_billing_limits row with limits_month <= month, NO
--   first_seen_month backfill -- see migration 095 lines 124-133) AND which has
--   NO project_monthly_summary row for that month, then calls the existing
--   engine function
--   recalculate_project_month() (migration 095, the current v2.1-tmt-canonical
--   definition) for each. recalculate_project_month() computes the floor and
--   INSERTs the row (its ON CONFLICT means it never mutates a row that already
--   exists for that project-month when we skip rows that exist — and even if
--   re-run, it reproduces identical output: it is documented idempotent).
--
--   Coverage is wired into the system the lowest-blast-radius way:
--   materialize_billing_floor_projects() ENQUEUES the missing (project, month)
--   pairs into recalculation_queue with reason 'floor_materialize' so the
--   existing drain_recalculation_queue() (migration 044) processes them via
--   the normal path. The function ALSO offers a direct mode (p_enqueue_only =
--   false) that calls recalculate_project_month() inline for callers that want
--   the rows materialized immediately (e.g. month-start backfill).
--
-- Why this is safe (blast radius):
--   - PURELY ADDITIVE: only acts on (project, month) pairs that have NO
--     existing summary row. Existing rows are never read-modified-written by
--     this function.
--   - Reuses existing, load-bearing engine functions verbatim. Creates no
--     parallel billing logic.
--   - Does NOT modify enqueue_affected_months() or any existing trigger, so
--     all current activity-driven behavior is unchanged.
--   - Excludes member projects via v_project_table_entities (migration 058),
--     the same canonical filter recalculate_month() uses (migration 044
--     line 543-549), so it cannot reintroduce the member double-count that
--     migration 050 fixed.
--   - Cannot double-count: the floor revenue lives in the single
--     project_monthly_summary row; it is not also represented as a billing
--     transaction. All four read surfaces (Revenue page, Customer Revenue
--     Report, EOM CSV, QBO invoice) read billed_revenue_cents from that one
--     row, so they all show $9,600 with NO per-surface code change.
--   - Does not touch task_monthly_totals or timesheet_daily_rollups, so it
--     cannot violate the reconciliation invariant
--     validate_task_monthly_totals_vs_rollups() (migration 101): a zero-hour
--     floor row contributes zero minutes to both sides of that comparison.
--
-- Trigger decision:
--   CHOSEN (lowest blast radius): a SQL function invoked at month start by an
--   operator/cron, enqueue mode by default, so the normal drain path does the
--   actual recompute. We deliberately do NOT alter enqueue_affected_months.
--   ALTERNATIVE (not implemented here): fold floor-project discovery directly
--   into the sync drain. Rejected for now because it widens the blast radius
--   of the hot sync path; the enqueue-at-month-start approach is reversible
--   and observable.
--
-- This migration changes NO tables and NO existing functions. It only ADDS
-- one new function. No frontend, edge function, or QBO change.
-- ============================================================================

BEGIN;

-- ============================================================================
-- materialize_billing_floor_projects(p_month, p_enqueue_only)
-- ============================================================================
CREATE OR REPLACE FUNCTION materialize_billing_floor_projects(
    p_month        DATE,
    p_enqueue_only BOOLEAN DEFAULT true
)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_month   DATE := DATE_TRUNC('month', p_month)::DATE;
    v_project RECORD;
    v_limits  RECORD;
    v_count   INTEGER := 0;
BEGIN
    -- Iterate only canonical entities (primaries + unassociated; members
    -- excluded) -- identical scope to recalculate_month() (migration 044).
    FOR v_project IN
        SELECT vte.id AS project_id
        FROM v_project_table_entities vte
        WHERE NOT EXISTS (
            SELECT 1
            FROM project_monthly_summary pms
            WHERE pms.project_id = vte.id
              AND pms.summary_month = v_month
        )
    LOOP
        -- Resolve limits with the SAME direct semantics the engine uses
        -- (recalculate_project_month, migration 095 lines 124-133): the most
        -- recent billing-limits row with limits_month <= v_month. We deliberately
        -- do NOT use get_effective_project_billing_limits() here, because that RPC
        -- applies first_seen_month backfill (source='backfill') and would surface
        -- limits for months BEFORE the engine would ever see them. Using the
        -- engine's exact resolution keeps discovery and the engine on a single
        -- source of truth, so we never materialize a spurious $0 row for a
        -- pre-first-seen month (which a later NOT EXISTS guard would then suppress).
        SELECT l.minimum_hours, l.maximum_hours
        INTO v_limits
        FROM project_monthly_billing_limits l
        WHERE l.project_id = v_project.project_id
            AND l.limits_month <= v_month
        ORDER BY l.limits_month DESC
        LIMIT 1;

        -- Floor materialization only: act only on projects with an effective
        -- MINIMUM the engine would also apply. A max-only project with zero
        -- activity has nothing to floor, so materializing it would create a noise
        -- $0 summary row. minimum_hours IS NULL (no row found, or a row with no
        -- minimum) => skip; project stays activity-driven (unchanged behavior).
        IF v_limits.minimum_hours IS NULL THEN
            CONTINUE;
        END IF;

        IF p_enqueue_only THEN
            -- Lowest-blast-radius path: hand off to the normal drain pipeline.
            INSERT INTO recalculation_queue (project_id, queue_month, reason)
            VALUES (v_project.project_id, v_month, 'floor_materialize')
            ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
            DO NOTHING;
        ELSE
            -- Direct path: materialize immediately via the existing engine.
            PERFORM recalculate_project_month(v_project.project_id, v_month);
        END IF;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION materialize_billing_floor_projects(DATE, BOOLEAN) IS
    'Additive/idempotent. service_role-only. For p_month, finds canonical '
    'projects (members excluded) that have an effective billing MINIMUM the '
    'engine would apply (resolved with recalculate_project_month''s exact direct '
    'semantics: latest project_monthly_billing_limits row with limits_month <= '
    'month, no first_seen backfill) but NO project_monthly_summary row, and '
    'either enqueues them (p_enqueue_only=true, default) or directly '
    'recalculates them (false) via recalculate_project_month so the floor '
    'revenue materializes even with zero time activity. Max-only projects are '
    'intentionally excluded (no floor to apply). Never mutates existing summary '
    'rows. Returns count of projects acted on.';

-- Least privilege: this function drives the billing engine and (in direct mode)
-- calls recalculate_project_month(). Postgres grants EXECUTE to PUBLIC by default
-- on every new function, so an explicit GRANT TO service_role alone would leave
-- anon/authenticated/PUBLIC able to execute it. We REVOKE the default PUBLIC
-- grant (and anon/authenticated explicitly) first, then grant EXECUTE to
-- service_role ONLY -- the operator/cron usage model documented in this header.
-- (This is stricter than the existing engine functions, whose default PUBLIC
-- grant was never revoked; they are shielded only because PostgREST does not
-- expose them. We lock this one down at the grant level too.)
REVOKE ALL ON FUNCTION materialize_billing_floor_projects(DATE, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION materialize_billing_floor_projects(DATE, BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION materialize_billing_floor_projects(DATE, BOOLEAN) TO service_role;

-- ============================================================================
-- Verification (informational only)
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration 113 Complete:';
    RAISE NOTICE '  - Added materialize_billing_floor_projects(DATE, BOOLEAN)';
    RAISE NOTICE '  - Additive only: creates summary rows where none exist for floor/limit projects';
    RAISE NOTICE '  - No tables changed, no existing functions changed, no triggers changed';
    RAISE NOTICE '';
    RAISE NOTICE '  USAGE (enqueue mode, then drain):';
    RAISE NOTICE '    SELECT materialize_billing_floor_projects(''2026-06-01'');';
    RAISE NOTICE '    SELECT drain_recalculation_queue();';
    RAISE NOTICE '  USAGE (direct mode):';
    RAISE NOTICE '    SELECT materialize_billing_floor_projects(''2026-06-01'', false);';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (manual; run inside a transaction)
-- ============================================================================
-- This migration is purely additive (one new function, no data writes at
-- migration time). To fully reverse:
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS materialize_billing_floor_projects(DATE, BOOLEAN);
--   COMMIT;
--
-- Note: any project_monthly_summary rows that were later materialized by
-- CALLING this function are legitimate floor-revenue rows produced by the
-- existing billing engine (recalculate_project_month). They are NOT created
-- by this migration itself and should generally be retained. If a specific
-- materialized row must be removed, delete it explicitly by (project_id,
-- summary_month) after financial sign-off, e.g.:
--
--   -- DELETE FROM project_monthly_summary
--   -- WHERE project_id = '<uuid>' AND summary_month = '<YYYY-MM-01>';
-- ============================================================================
