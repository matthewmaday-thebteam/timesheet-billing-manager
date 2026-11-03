-- ============================================================================
-- Rollback for migration 136: rollup UPDATE/DELETE triggers
-- ============================================================================
-- Run rollbacks in reverse order (140 -> 134). Function bodies restored here
-- are the LIVE prod definitions captured verbatim with pg_get_functiondef on
-- 2026-11-03 (md5-checked against the prod catalog), not repo migration files.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_enqueue_recalc_on_rollup_update ON public.timesheet_daily_rollups;
DROP TRIGGER IF EXISTS trg_enqueue_recalc_on_rollup_delete ON public.timesheet_daily_rollups;

-- Live enqueue_affected_months (pre-136; trigger trg_enqueue_recalc_on_sync
-- itself was never changed)
CREATE OR REPLACE FUNCTION public.enqueue_affected_months()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO recalculation_queue (project_id, queue_month, reason)
    SELECT DISTINCT
        -- Resolve member projects to their primary; standalone projects stay as-is
        COALESCE(pg.primary_project_id, p.id),
        DATE_TRUNC('month', n.work_date)::DATE,
        'sync'
    FROM new_rows n
    JOIN projects p ON p.project_id = n.project_id
    LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
    LEFT JOIN project_groups pg ON pg.id = pgm.group_id
    WHERE n.work_date IS NOT NULL
        AND n.total_minutes > 0
    ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
    DO NOTHING;

    RETURN NULL;
END;
$function$;

DROP FUNCTION IF EXISTS public.enqueue_rollup_update();
DROP FUNCTION IF EXISTS public.enqueue_rollup_delete();
DROP FUNCTION IF EXISTS public.enqueue_rollup_project_months(TEXT[], DATE[], TEXT);
DROP FUNCTION IF EXISTS public.rollup_project_month_pairs(TEXT[], DATE[]);
DROP FUNCTION IF EXISTS public.canonical_project_uuid(TEXT);

COMMIT;
