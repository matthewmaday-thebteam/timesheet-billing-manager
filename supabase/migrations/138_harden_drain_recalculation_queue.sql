-- ============================================================================
-- Migration 138: Harden drain_recalculation_queue
-- ============================================================================
-- Purpose:
--   drain_recalculation_queue(p_max_depth integer DEFAULT 12) RETURNS integer
--   is called (as one RPC transaction) by sync-clockify-timesheets and
--   sync-clickup-timesheets, and via drain_recalculation_queue_authenticated
--   by the UI. Signature and return type are unchanged; the body now:
--
--   1. Serialises drains: pg_advisory_xact_lock on a fixed key (shared with
--      reconcile_billing_months, migration 139).
--   2. Ensures task_monthly_totals is fresh for every month with pending
--      work BEFORE recalculating (validate_task_monthly_totals_vs_rollups ->
--      populate_task_monthly_totals per stale month -> re-validate). Still
--      stale => `tmt_rebuild_failed` alert and return 0 with the queue left
--      pending (never recalculate from known-bad totals).
--   3. Claims items oldest month first (carryover order), as before.
--   4. Member project items are retargeted to the group primary
--      (outcome 'retargeted').
--   5. Locked month => outcome 'skipped_locked'; the shared alert rule
--      (billing_alert_locked_month: alert only on an actual change, never for
--      an accepted variance) applies. Under the explicit owner override the
--      month is recalculated (outcome 'recalculated_override').
--   6. Each recalc runs in its own sub-transaction: a failure rolls back that
--      project-month only, records outcome 'failed' + error, raises
--      `recalc_failed`, and the drain continues.
--   7. A recalc that changes an open month which already has an eom_reports
--      row raises `eom_report_stale` (the report is NOT regenerated).
--   8. Cascade depth limit (unchanged rule) raises `recalc_cascade_limit`
--      instead of only a WARNING.
--
--   recalculation_queue gains nullable `outcome` and `error` columns.
--   Return value: number of project-months handled (any outcome), matching
--   the previous "processed" meaning closely enough for the sync logs.
--
-- Depends on: 134, 135.
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Idempotent (ADD COLUMN IF NOT EXISTS / guarded
-- constraint / CREATE OR REPLACE).
-- Rollback: supabase/rollbacks/138_harden_drain_recalculation_queue_rollback.sql
-- ============================================================================

BEGIN;

ALTER TABLE public.recalculation_queue ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE public.recalculation_queue ADD COLUMN IF NOT EXISTS error TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'recalculation_queue_outcome_check'
           AND conrelid = 'public.recalculation_queue'::regclass
    ) THEN
        ALTER TABLE public.recalculation_queue
            ADD CONSTRAINT recalculation_queue_outcome_check CHECK (
                outcome IS NULL OR outcome IN (
                    'recalculated', 'recalculated_override', 'skipped_locked',
                    'failed', 'retargeted'));
    END IF;
END $$;

COMMENT ON COLUMN public.recalculation_queue.outcome IS
    'Set by drain_recalculation_queue when processed: recalculated | recalculated_override | skipped_locked | failed | retargeted (migration 138). NULL for rows processed before 138.';

-- Advisory lock key shared by every billing writer that must not interleave.
CREATE OR REPLACE FUNCTION public.billing_drain_lock_key()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT 7134138001::BIGINT;
$function$;

-- Ensure task_monthly_totals matches rollups for p_months. Rebuilds each
-- stale month in full. Returns the number of months STILL stale afterwards
-- (0 = fresh); when > 0 a `tmt_rebuild_failed` alert has been raised.
CREATE OR REPLACE FUNCTION public.billing_ensure_tmt_fresh(p_months DATE[], p_context TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_months DATE[];
    v_stale  DATE[];
    v_still  DATE[];
    v_month  DATE;
BEGIN
    v_months := ARRAY(SELECT DISTINCT DATE_TRUNC('month', m)::DATE
                        FROM UNNEST(p_months) AS u(m) WHERE m IS NOT NULL ORDER BY 1);
    IF cardinality(v_months) = 0 THEN
        RETURN 0;
    END IF;

    v_stale := ARRAY(
        SELECT DISTINCT v.summary_month
          FROM validate_task_monthly_totals_vs_rollups(v_months[1], v_months[cardinality(v_months)]) v
         WHERE v.summary_month = ANY(v_months)
         ORDER BY 1);
    IF cardinality(v_stale) = 0 THEN
        RETURN 0;
    END IF;

    FOREACH v_month IN ARRAY v_stale LOOP
        -- p_workspace_id is unused by populate_task_monthly_totals (see its
        -- TODO); it rebuilds the whole month across workspaces.
        PERFORM populate_task_monthly_totals('billing:' || p_context, v_month, v_month);
    END LOOP;

    v_still := ARRAY(
        SELECT DISTINCT v.summary_month
          FROM validate_task_monthly_totals_vs_rollups(v_stale[1], v_stale[cardinality(v_stale)]) v
         WHERE v.summary_month = ANY(v_stale)
         ORDER BY 1);

    IF cardinality(v_still) > 0 THEN
        PERFORM raise_billing_alert(
            'tmt_rebuild_failed',
            'task_monthly_totals',
            FORMAT('task_monthly_totals still disagrees with timesheet rollups after rebuild (%s); billing recalculation halted',
                   ARRAY_TO_STRING(ARRAY(SELECT TO_CHAR(m, 'YYYY-MM') FROM UNNEST(v_still) m), ', ')),
            JSONB_BUILD_OBJECT('entity_type', 'table', 'context', p_context,
                               'months', TO_JSONB(v_still), 'rebuilt_months', TO_JSONB(v_stale)),
            'error');
        RETURN cardinality(v_still);
    END IF;

    RETURN 0;
END;
$function$;

-- Billing fingerprint of a stored summary row (NULL when absent).
CREATE OR REPLACE FUNCTION public.billing_pms_fingerprint(p_project_id UUID, p_month DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT JSONB_BUILD_OBJECT(
               'rounded_minutes', s.rounded_minutes,
               'billed_hours', s.billed_hours,
               'billed_revenue_cents', s.billed_revenue_cents,
               'carryover_in_hours', s.carryover_in_hours,
               'carryover_out_hours', s.carryover_out_hours,
               'minimum_padding_hours', s.minimum_padding_hours)
      FROM project_monthly_summary s
     WHERE s.project_id = p_project_id
       AND s.summary_month = DATE_TRUNC('month', p_month)::DATE;
$function$;

-- Raise `eom_report_stale` if (project's canonical company, month) already
-- has an EOM report. Entity: '<canonical company uuid>:<YYYY-MM>'. Changed
-- projects accumulate in metadata.projects.
CREATE OR REPLACE FUNCTION public.billing_alert_eom_stale(
    p_project_id UUID, p_month DATE, p_before JSONB, p_after JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_month    DATE := DATE_TRUNC('month', p_month)::DATE;
    v_company  UUID;
    v_report   RECORD;
    v_entity   TEXT;
    v_projects JSONB;
BEGIN
    SELECT vcc.canonical_company_id INTO v_company
      FROM projects p
      JOIN v_company_canonical vcc ON vcc.company_id = p.company_id
     WHERE p.id = p_project_id;
    IF v_company IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT e.id, e.generated_at, e.company_name INTO v_report
      FROM eom_reports e
     WHERE e.company_id IN (SELECT f.company_id FROM billing_company_family(v_company) f)
       AND e.report_year = EXTRACT(YEAR FROM v_month)::INTEGER
       AND e.report_month = EXTRACT(MONTH FROM v_month)::INTEGER
     ORDER BY e.generated_at DESC
     LIMIT 1;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    v_entity := v_company::TEXT || ':' || TO_CHAR(v_month, 'YYYY-MM');

    SELECT COALESCE(a.metadata->'projects', '{}'::JSONB) INTO v_projects
      FROM sync_alerts a
     WHERE a.alert_type = 'eom_report_stale' AND a.entity_id = v_entity AND a.resolved_at IS NULL;
    v_projects := COALESCE(v_projects, '{}'::JSONB)
               || JSONB_BUILD_OBJECT(p_project_id::TEXT,
                                     JSONB_BUILD_OBJECT('before', p_before, 'after', p_after));

    PERFORM raise_billing_alert(
        'eom_report_stale',
        v_entity,
        FORMAT('EOM report %s %s is stale: %s project summar%s recalculated after it was generated; regenerate before invoicing',
               v_report.company_name, TO_CHAR(v_month, 'YYYY-MM'),
               (SELECT COUNT(*) FROM JSONB_OBJECT_KEYS(v_projects)),
               CASE WHEN (SELECT COUNT(*) FROM JSONB_OBJECT_KEYS(v_projects)) = 1 THEN 'y' ELSE 'ies' END),
        JSONB_BUILD_OBJECT('entity_type', 'company_month', 'entity_name', v_report.company_name,
                           'company_id', v_company, 'month', TO_CHAR(v_month, 'YYYY-MM'),
                           'eom_report_id', v_report.id, 'eom_generated_at', v_report.generated_at,
                           'projects', v_projects),
        'warning');
    RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.drain_recalculation_queue(p_max_depth integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_item          RECORD;
    v_processed     INTEGER := 0;
    v_cascade_depth INTEGER := 0;
    v_canonical     UUID;
    v_lock          TEXT;
    v_outcome       TEXT;
    v_error         TEXT;
    v_before        JSONB;
    v_after         JSONB;
    v_key           TEXT;
BEGIN
    -- (1) One drain at a time (sync functions, UI wrapper, reconcile).
    PERFORM pg_advisory_xact_lock(billing_drain_lock_key());

    -- (2) Never recalculate from stale task totals.
    IF billing_ensure_tmt_fresh(
           ARRAY(SELECT DISTINCT q.queue_month FROM recalculation_queue q WHERE q.processed_at IS NULL),
           'drain_recalculation_queue') > 0 THEN
        RAISE WARNING 'drain_recalculation_queue: task_monthly_totals stale after rebuild; queue left pending';
        RETURN 0;
    END IF;

    -- (3) Oldest month first - critical for carryover.
    LOOP
        SELECT q.id, q.project_id, q.queue_month, q.reason
          INTO v_item
          FROM recalculation_queue q
         WHERE q.processed_at IS NULL
         ORDER BY q.queue_month ASC, q.queued_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED;

        EXIT WHEN NOT FOUND;

        v_key := v_item.project_id::TEXT || ':' || TO_CHAR(v_item.queue_month, 'YYYY-MM');
        v_outcome := NULL;
        v_error := NULL;

        -- (4) Member -> primary.
        v_canonical := billing_canonical_project(v_item.project_id);
        IF v_canonical IS NULL THEN
            v_outcome := 'failed';
            v_error := 'project not found';
            PERFORM raise_billing_alert('recalc_failed', v_key,
                FORMAT('Recalculation failed for %s: project not found', v_key),
                JSONB_BUILD_OBJECT('entity_type', 'project_month', 'project_id', v_item.project_id,
                                   'month', TO_CHAR(v_item.queue_month, 'YYYY-MM'),
                                   'reason', v_item.reason, 'error', v_error),
                'error');
        ELSIF v_canonical <> v_item.project_id THEN
            INSERT INTO recalculation_queue (project_id, queue_month, reason)
            VALUES (v_canonical, v_item.queue_month, v_item.reason)
            ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
            DO NOTHING;
            v_outcome := 'retargeted';
            v_error := 'retargeted to ' || v_canonical::TEXT;
        END IF;

        IF v_outcome IS NULL THEN
            -- (8) Safety: prevent runaway cascades (rule unchanged).
            IF v_item.reason = 'cascade' THEN
                v_cascade_depth := v_cascade_depth + 1;
                IF v_cascade_depth > p_max_depth THEN
                    PERFORM raise_billing_alert('recalc_cascade_limit', v_key,
                        FORMAT('Carryover cascade depth limit (%s) reached at %s; remaining queue left pending',
                               p_max_depth, v_key),
                        JSONB_BUILD_OBJECT('entity_type', 'project_month', 'project_id', v_item.project_id,
                                           'month', TO_CHAR(v_item.queue_month, 'YYYY-MM'),
                                           'max_depth', p_max_depth),
                        'error');
                    RAISE WARNING 'Cascade depth limit reached (%) for project %',
                        p_max_depth, v_item.project_id;
                    EXIT;
                END IF;
            ELSE
                v_cascade_depth := 0;
            END IF;

            -- (5) Locked month: keep and alert.
            v_lock := billing_project_month_lock_reason(v_item.project_id, v_item.queue_month);
            IF v_lock IS NOT NULL AND NOT billing_locked_recalc_override() THEN
                PERFORM billing_alert_locked_month(v_item.project_id, v_item.queue_month,
                                                   v_item.reason, v_lock, NULL);
                v_outcome := 'skipped_locked';
            ELSE
                -- (6) Isolated recalculation.
                v_before := billing_pms_fingerprint(v_item.project_id, v_item.queue_month);
                BEGIN
                    PERFORM recalculate_project_month(v_item.project_id, v_item.queue_month);
                    v_outcome := CASE WHEN v_lock IS NULL THEN 'recalculated' ELSE 'recalculated_override' END;
                EXCEPTION WHEN OTHERS THEN
                    v_outcome := 'failed';
                    v_error := SQLSTATE || ': ' || SQLERRM;
                    PERFORM raise_billing_alert('recalc_failed', v_key,
                        FORMAT('Recalculation failed for %s: %s', v_key, LEFT(SQLERRM, 200)),
                        JSONB_BUILD_OBJECT('entity_type', 'project_month', 'project_id', v_item.project_id,
                                           'month', TO_CHAR(v_item.queue_month, 'YYYY-MM'),
                                           'reason', v_item.reason, 'error', v_error),
                        'error');
                    RAISE WARNING 'drain_recalculation_queue: % failed: %', v_key, v_error;
                END;

                -- (7) Open month already reported => stale EOM report.
                IF v_outcome = 'recalculated' THEN
                    v_after := billing_pms_fingerprint(v_item.project_id, v_item.queue_month);
                    IF v_after IS DISTINCT FROM v_before THEN
                        PERFORM billing_alert_eom_stale(v_item.project_id, v_item.queue_month,
                                                        v_before, v_after);
                    END IF;
                END IF;
            END IF;
        END IF;

        -- Mark ALL pending items for this project+month as processed.
        UPDATE recalculation_queue
           SET processed_at = NOW(),
               outcome = v_outcome,
               error = v_error
         WHERE project_id = v_item.project_id
           AND queue_month = v_item.queue_month
           AND processed_at IS NULL;

        v_processed := v_processed + 1;
    END LOOP;

    RETURN v_processed;
END;
$function$;

REVOKE ALL ON FUNCTION public.billing_drain_lock_key() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_ensure_tmt_fresh(DATE[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_pms_fingerprint(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_alert_eom_stale(UUID, DATE, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_drain_lock_key() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_ensure_tmt_fresh(DATE[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_pms_fingerprint(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_alert_eom_stale(UUID, DATE, JSONB, JSONB) TO service_role;

COMMIT;
