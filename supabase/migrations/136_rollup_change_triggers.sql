-- ============================================================================
-- Migration 136: Queue recalculation on rollup UPDATE and DELETE
-- ============================================================================
-- Purpose:
--   timesheet_daily_rollups is upserted hourly by sync-clockify-timesheets
--   (:00) and sync-clickup-timesheets (:30), ON CONFLICT
--   (clockify_workspace_id, task_id), and pruned by
--   cleanup_stale_timesheet_entries(). Until now only INSERT queued work
--   (trg_enqueue_recalc_on_sync, statement-level), so:
--     RC2  a changed entry arriving via the upsert's UPDATE path queued
--          nothing (ZoneCoach Sep/Oct);
--     RC3  an entry deleted at source queued nothing (Luxus Site Audit Oct).
--
--   This migration:
--     * adds canonical_project_uuid(ext_project_id text): the ONE place that
--       maps an external rollup project id to its canonical project
--       (member -> group primary), same rule as migration 050;
--     * adds enqueue_rollup_project_months(ext ids[], work dates[], reason):
--       shared resolver + enqueuer. A non-NULL external project id that does
--       not resolve raises a `rollup_project_unresolved` alert instead of
--       being dropped silently. (A NULL project id is time logged against no
--       project; it was never billable and is still ignored.)
--     * re-points the existing INSERT trigger function at the helper
--       (reason 'sync', same predicate: total_minutes > 0);
--     * adds statement-level AFTER UPDATE (reason 'sync_update') and AFTER
--       DELETE (reason 'sync_delete') triggers using transition tables.
--
--   UPDATE rule: old/new rows are joined on id and considered changed only
--   when project_id, work_date, total_minutes, rounded_minutes, task_name or
--   client_id IS DISTINCT FROM. A synced_at / sync_run_id-only rewrite (every
--   hourly upsert) queues NOTHING. For a changed row the OLD side is queued
--   when old.total_minutes > 0 and the NEW side when new.total_minutes > 0,
--   so a project move or a month-boundary work_date change queues both
--   project-months; 60 -> 0 queues; 0 -> 0 does not.
--
--   Locked months are still queued: the decision belongs to the drain, which
--   records outcome 'skipped_locked' and alerts (migrations 135/138).
--
-- Depends on: 134.
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- Rollback: supabase/rollbacks/136_rollup_change_triggers_rollback.sql
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.canonical_project_uuid(ext_project_id TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT COALESCE(pg.primary_project_id, p.id)
      FROM projects p
      LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
      LEFT JOIN project_groups pg ON pg.id = pgm.group_id
     WHERE p.project_id = ext_project_id;
$function$;

-- Distinct (external project id, month) pairs with their canonical project.
CREATE OR REPLACE FUNCTION public.rollup_project_month_pairs(p_ext_project_ids TEXT[], p_work_dates DATE[])
RETURNS TABLE(ext_project_id TEXT, queue_month DATE, canonical_id UUID)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT s.ext_project_id, s.queue_month, canonical_project_uuid(s.ext_project_id)
      FROM (
        SELECT DISTINCT u.ext_project_id, DATE_TRUNC('month', u.work_date)::DATE AS queue_month
          FROM UNNEST(p_ext_project_ids, p_work_dates) AS u(ext_project_id, work_date)
         WHERE u.ext_project_id IS NOT NULL
           AND u.work_date IS NOT NULL
      ) s;
$function$;

-- Resolve (external project id, work date) pairs to canonical project-months
-- and queue them. Arrays are parallel. Returns the number of distinct
-- canonical project-months offered to the queue.
CREATE OR REPLACE FUNCTION public.enqueue_rollup_project_months(
    p_ext_project_ids TEXT[],
    p_work_dates      DATE[],
    p_reason          TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_count      INTEGER := 0;
    v_unresolved RECORD;
BEGIN
    IF COALESCE(cardinality(p_ext_project_ids), 0) = 0 THEN
        RETURN 0;
    END IF;
    IF cardinality(p_ext_project_ids) <> COALESCE(cardinality(p_work_dates), 0) THEN
        RAISE EXCEPTION 'enqueue_rollup_project_months: array length mismatch (% ids, % dates)',
            cardinality(p_ext_project_ids), cardinality(p_work_dates);
    END IF;

    FOR v_unresolved IN
        SELECT s.ext_project_id,
               ARRAY_AGG(TO_CHAR(s.queue_month, 'YYYY-MM') ORDER BY s.queue_month) AS months
          FROM rollup_project_month_pairs(p_ext_project_ids, p_work_dates) s
         WHERE s.canonical_id IS NULL
         GROUP BY s.ext_project_id
    LOOP
        PERFORM raise_billing_alert(
            'rollup_project_unresolved',
            'ext:' || v_unresolved.ext_project_id,
            FORMAT('Timesheet rollups reference unknown project %s (%s); months not queued for recalculation',
                   v_unresolved.ext_project_id, ARRAY_TO_STRING(v_unresolved.months, ', ')),
            JSONB_BUILD_OBJECT('entity_type', 'external_project',
                               'ext_project_id', v_unresolved.ext_project_id,
                               'months', TO_JSONB(v_unresolved.months),
                               'reason', p_reason),
            'error');
    END LOOP;

    WITH offered AS (
        SELECT DISTINCT s.canonical_id, s.queue_month
          FROM rollup_project_month_pairs(p_ext_project_ids, p_work_dates) s
         WHERE s.canonical_id IS NOT NULL
    ), ins AS (
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        SELECT o.canonical_id, o.queue_month, p_reason FROM offered o
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM offered;

    RETURN v_count;
END;
$function$;

-- INSERT path (trigger trg_enqueue_recalc_on_sync, unchanged definition).
CREATE OR REPLACE FUNCTION public.enqueue_affected_months()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ids   TEXT[];
    v_dates DATE[];
BEGIN
    SELECT ARRAY_AGG(n.project_id), ARRAY_AGG(n.work_date)
      INTO v_ids, v_dates
      FROM new_rows n
     WHERE n.work_date IS NOT NULL
       AND n.total_minutes > 0;

    PERFORM enqueue_rollup_project_months(v_ids, v_dates, 'sync');
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_rollup_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_ids   TEXT[];
    v_dates DATE[];
BEGIN
    WITH changed AS (
        SELECT o.project_id AS old_project_id, o.work_date AS old_work_date, o.total_minutes AS old_minutes,
               n.project_id AS new_project_id, n.work_date AS new_work_date, n.total_minutes AS new_minutes
          FROM old_rows o
          JOIN new_rows n ON n.id = o.id
         WHERE (o.project_id, o.work_date, o.total_minutes, o.rounded_minutes, o.task_name, o.client_id)
               IS DISTINCT FROM
               (n.project_id, n.work_date, n.total_minutes, n.rounded_minutes, n.task_name, n.client_id)
    ), sides AS (
        SELECT old_project_id AS project_id, old_work_date AS work_date FROM changed WHERE old_minutes > 0
        UNION ALL
        SELECT new_project_id, new_work_date FROM changed WHERE new_minutes > 0
    )
    SELECT ARRAY_AGG(s.project_id), ARRAY_AGG(s.work_date)
      INTO v_ids, v_dates
      FROM sides s;

    PERFORM enqueue_rollup_project_months(v_ids, v_dates, 'sync_update');
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_rollup_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_ids   TEXT[];
    v_dates DATE[];
BEGIN
    SELECT ARRAY_AGG(o.project_id), ARRAY_AGG(o.work_date)
      INTO v_ids, v_dates
      FROM old_rows o
     WHERE o.total_minutes > 0;

    PERFORM enqueue_rollup_project_months(v_ids, v_dates, 'sync_delete');
    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_recalc_on_rollup_update ON public.timesheet_daily_rollups;
CREATE TRIGGER trg_enqueue_recalc_on_rollup_update
    AFTER UPDATE ON public.timesheet_daily_rollups
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_rollup_update();

DROP TRIGGER IF EXISTS trg_enqueue_recalc_on_rollup_delete ON public.timesheet_daily_rollups;
CREATE TRIGGER trg_enqueue_recalc_on_rollup_delete
    AFTER DELETE ON public.timesheet_daily_rollups
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_rollup_delete();

REVOKE ALL ON FUNCTION public.canonical_project_uuid(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rollup_project_month_pairs(TEXT[], DATE[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_rollup_project_months(TEXT[], DATE[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_rollup_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_rollup_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_project_uuid(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_rollup_project_months(TEXT[], DATE[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollup_project_month_pairs(TEXT[], DATE[]) TO service_role;

COMMIT;
