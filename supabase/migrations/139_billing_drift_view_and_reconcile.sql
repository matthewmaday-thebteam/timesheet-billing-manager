-- ============================================================================
-- Migration 139: Billing drift view + reconcile_billing_months()
-- ============================================================================
-- Purpose:
--   Self-healing for open months and visibility for locked ones, independent
--   of whether a trigger fired.
--
--   v_billing_month_drift
--     One row per CANONICAL project-month (members excluded) whose stored
--     project_monthly_summary.rounded_minutes differs from what the engine
--     would read from task_monthly_totals today (rounded_entry_minutes or
--     rounded_task_minutes per get_effective_project_rounding — the
--     resolver's own rounding source). Carries the lock reason and the
--     accepted-variance flag. security_invoker: callers see what their RLS
--     allows.
--
--   reconcile_billing_months(p_from date DEFAULT NULL, p_to date DEFAULT NULL,
--                            p_dry_run boolean DEFAULT true) RETURNS jsonb
--     SECURITY DEFINER, service_role only. Months are first-of-month; NULL
--     bound = unbounded.
--       1. task_monthly_totals vs rollups: stale months are rebuilt (real run)
--          or only reported (dry run). Still stale => status 'failed'.
--       2. Each drifted project-month in range:
--            locked + accepted  -> counted in `accepted`, no alert (only while
--                                  the accepted minutes/revenue still match)
--            locked             -> invoiced_month_source_changed alert
--                                  (`locked_alerts`)
--            open               -> queued, reason 'reconcile_drift'
--                                  (`recalculated`)
--       3. Real run: drain the queue, re-read the view; any open drift left in
--          range raises `reconcile_drift_persisting` and status 'failed'
--          (`persisting`).
--     A dry run performs NO writes at all (no TMT rebuild, no queue rows, no
--     alerts) and reports what a real run would do. Re-running is idempotent:
--     alerts are upserts, fixed open drift no longer appears.
--
--     Returns {status: 'ok'|'failed', dry_run, from, to, tmt_stale_months,
--              tmt_still_stale, recalculated, locked_alerts, accepted,
--              persisting, drained, items: [...]}.
--
--   run_scheduled_billing_reconcile() — the pg_cron entry point (migration
--     140). Never lets an exception vanish into cron.job_run_details only: an
--     unexpected error becomes a `reconcile_failed` alert.
--
-- Depends on: 134, 135, 138.
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Idempotent (CREATE OR REPLACE).
-- Rollback: supabase/rollbacks/139_billing_drift_view_and_reconcile_rollback.sql
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_billing_month_drift
WITH (security_invoker = true)
AS
WITH canonical AS (
    SELECT p.id AS project_id
      FROM projects p
     WHERE NOT EXISTS (SELECT 1 FROM project_group_members m WHERE m.member_project_id = p.id)
),
pms AS (
    SELECT s.project_id, s.summary_month, s.rounded_minutes, s.billed_revenue_cents
      FROM project_monthly_summary s
      JOIN canonical c ON c.project_id = s.project_id
),
tmt AS (
    SELECT t.project_id, t.summary_month,
           SUM(t.rounded_entry_minutes) AS entry_min,
           SUM(t.rounded_task_minutes)  AS task_min
      FROM task_monthly_totals t
      JOIN canonical c ON c.project_id = t.project_id
     GROUP BY t.project_id, t.summary_month
),
keyed AS (
    SELECT project_id, summary_month FROM pms
    UNION
    SELECT project_id, summary_month FROM tmt
),
calc AS (
    SELECT k.project_id,
           k.summary_month,
           COALESCE(r.effective_rounding_mode, 'task') AS rounding_mode,
           pms.rounded_minutes::BIGINT AS pms_min,
           CASE WHEN COALESCE(r.effective_rounding_mode, 'task') = 'entry'
                THEN tmt.entry_min ELSE tmt.task_min END::BIGINT AS tmt_min,
           pms.billed_revenue_cents
      FROM keyed k
      LEFT JOIN pms ON pms.project_id = k.project_id AND pms.summary_month = k.summary_month
      LEFT JOIN tmt ON tmt.project_id = k.project_id AND tmt.summary_month = k.summary_month
      LEFT JOIN LATERAL get_effective_project_rounding(k.project_id, k.summary_month) r ON TRUE
)
SELECT c.project_id,
       p.project_name,
       vcc.canonical_company_id AS company_id,
       COALESCE(co.display_name, co.client_name) AS company_name,
       c.summary_month,
       c.rounding_mode,
       c.pms_min,
       c.tmt_min,
       COALESCE(c.tmt_min, 0) - COALESCE(c.pms_min, 0) AS delta_min,
       c.billed_revenue_cents,
       l.lock_reason,
       l.lock_reason IS NOT NULL AS is_locked,
       EXISTS (SELECT 1 FROM billing_accepted_variances a
                WHERE a.project_id = c.project_id AND a.month = c.summary_month
                  AND a.accepted_pms_min = COALESCE(c.pms_min, 0)
                  AND a.accepted_tmt_min = COALESCE(c.tmt_min, 0)) AS is_accepted
  FROM calc c
  JOIN projects p ON p.id = c.project_id
  LEFT JOIN v_company_canonical vcc ON vcc.company_id = p.company_id
  LEFT JOIN companies co ON co.id = vcc.canonical_company_id
  LEFT JOIN LATERAL (SELECT billing_month_lock_reason(vcc.canonical_company_id, c.summary_month) AS lock_reason) l ON TRUE
 WHERE COALESCE(c.pms_min, 0) <> COALESCE(c.tmt_min, 0);

COMMENT ON VIEW public.v_billing_month_drift IS
    'Canonical project-months whose stored PMS rounded minutes differ from task_monthly_totals (by effective rounding mode), with lock / accepted-variance flags (migration 139).';

REVOKE ALL ON public.v_billing_month_drift FROM anon;
GRANT SELECT ON public.v_billing_month_drift TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_billing_months(
    p_from    DATE DEFAULT NULL,
    p_to      DATE DEFAULT NULL,
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_from          DATE := DATE_TRUNC('month', p_from)::DATE;
    v_to            DATE := DATE_TRUNC('month', p_to)::DATE;
    v_stale         DATE[];
    v_still         INTEGER := 0;
    v_recalc        INTEGER := 0;
    v_locked_alerts INTEGER := 0;
    v_accepted      INTEGER := 0;
    v_persisting    INTEGER := 0;
    v_drained       INTEGER := 0;
    v_items         JSONB := '[]'::JSONB;
    v_action        TEXT;
    r               RECORD;
BEGIN
    IF p_dry_run IS NULL THEN
        RAISE EXCEPTION 'reconcile_billing_months: p_dry_run must be true or false';
    END IF;
    IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to THEN
        RAISE EXCEPTION 'reconcile_billing_months: p_from % is after p_to %', v_from, v_to;
    END IF;

    IF NOT p_dry_run THEN
        PERFORM pg_advisory_xact_lock(billing_drain_lock_key());
    END IF;

    -- 1. task_monthly_totals freshness.
    v_stale := ARRAY(SELECT DISTINCT v.summary_month
                       FROM validate_task_monthly_totals_vs_rollups(v_from, v_to) v
                      ORDER BY 1);
    IF NOT p_dry_run AND cardinality(v_stale) > 0 THEN
        v_still := cardinality(billing_ensure_tmt_fresh(v_stale, 'reconcile_billing_months'));
        IF v_still > 0 THEN
            RETURN JSONB_BUILD_OBJECT(
                'status', 'failed', 'dry_run', p_dry_run, 'from', v_from, 'to', v_to,
                'tmt_stale_months', TO_JSONB(v_stale), 'tmt_still_stale', v_still,
                'recalculated', 0, 'locked_alerts', 0, 'accepted', 0,
                'persisting', 0, 'drained', 0, 'items', '[]'::JSONB);
        END IF;
    END IF;

    -- 2. Classify drift.
    FOR r IN
        SELECT d.*
          FROM v_billing_month_drift d
         WHERE (v_from IS NULL OR d.summary_month >= v_from)
           AND (v_to IS NULL OR d.summary_month <= v_to)
         ORDER BY d.summary_month, d.company_name, d.project_name
    LOOP
        IF r.is_locked THEN
            -- Real run: the shared alert rule decides (an accepted variance
            -- suppresses only while minutes AND revenue still match what was
            -- accepted). Dry run: the view's minute-level acceptance flag.
            IF p_dry_run THEN
                v_action := CASE WHEN r.is_accepted THEN 'accepted' ELSE 'locked_alert' END;
            ELSIF billing_alert_locked_month(
                    r.project_id, r.summary_month, 'reconcile_drift', r.lock_reason,
                    JSONB_BUILD_OBJECT('drift_pms_min', r.pms_min, 'drift_tmt_min', r.tmt_min)) THEN
                v_action := 'locked_alert';
            ELSE
                v_action := 'accepted';
            END IF;
            IF v_action = 'accepted' THEN
                v_accepted := v_accepted + 1;
            ELSE
                v_locked_alerts := v_locked_alerts + 1;
            END IF;
        ELSE
            v_action := 'recalc';
            v_recalc := v_recalc + 1;
            IF NOT p_dry_run THEN
                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (r.project_id, r.summary_month, 'reconcile_drift')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;
            END IF;
        END IF;

        v_items := v_items || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
            'action', v_action, 'project_id', r.project_id, 'project_name', r.project_name,
            'company_id', r.company_id, 'company_name', r.company_name,
            'month', TO_CHAR(r.summary_month, 'YYYY-MM'),
            'pms_min', r.pms_min, 'tmt_min', r.tmt_min,
            'billed_revenue_cents', r.billed_revenue_cents, 'lock_reason', r.lock_reason));
    END LOOP;

    -- 3. Real run: drain and verify.
    IF NOT p_dry_run AND v_recalc > 0 THEN
        v_drained := drain_recalculation_queue(12);

        FOR r IN
            SELECT d.*
              FROM v_billing_month_drift d
             WHERE NOT d.is_locked
               AND (v_from IS NULL OR d.summary_month >= v_from)
               AND (v_to IS NULL OR d.summary_month <= v_to)
        LOOP
            v_persisting := v_persisting + 1;
            PERFORM raise_billing_alert(
                'reconcile_drift_persisting',
                r.project_id::TEXT || ':' || TO_CHAR(r.summary_month, 'YYYY-MM'),
                FORMAT('%s / %s %s: summary still differs from task totals after reconcile (stored %s min, source %s min)',
                       COALESCE(r.company_name, 'Unknown company'), r.project_name,
                       TO_CHAR(r.summary_month, 'YYYY-MM'),
                       COALESCE(r.pms_min::TEXT, 'none'), COALESCE(r.tmt_min::TEXT, '0')),
                JSONB_BUILD_OBJECT('entity_type', 'project_month', 'entity_name', r.project_name,
                                   'project_id', r.project_id, 'company_id', r.company_id,
                                   'month', TO_CHAR(r.summary_month, 'YYYY-MM'),
                                   'pms_min', r.pms_min, 'tmt_min', r.tmt_min),
                'error');
        END LOOP;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'status',           CASE WHEN v_persisting > 0 THEN 'failed' ELSE 'ok' END,
        'dry_run',          p_dry_run,
        'from',             v_from,
        'to',               v_to,
        'tmt_stale_months', TO_JSONB(v_stale),
        'tmt_still_stale',  v_still,
        'recalculated',     v_recalc,
        'locked_alerts',    v_locked_alerts,
        'accepted',         v_accepted,
        'persisting',       v_persisting,
        'drained',          v_drained,
        'items',            v_items);
END;
$function$;

-- pg_cron entry point (migration 140). Real run over all months.
CREATE OR REPLACE FUNCTION public.run_scheduled_billing_reconcile()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_result JSONB;
BEGIN
    BEGIN
        v_result := reconcile_billing_months(NULL, NULL, FALSE);
    EXCEPTION WHEN OTHERS THEN
        PERFORM raise_billing_alert(
            'reconcile_failed', 'reconcile_billing_months',
            FORMAT('Daily billing reconcile raised an error: %s', LEFT(SQLERRM, 200)),
            JSONB_BUILD_OBJECT('entity_type', 'job', 'sqlstate', SQLSTATE, 'error', SQLERRM, 'at', NOW()),
            'error');
        RETURN JSONB_BUILD_OBJECT('status', 'failed', 'error', SQLERRM);
    END;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_billing_months(DATE, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_scheduled_billing_reconcile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_billing_months(DATE, DATE, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_scheduled_billing_reconcile() TO service_role;

COMMIT;
