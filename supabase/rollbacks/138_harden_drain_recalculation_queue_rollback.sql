-- ============================================================================
-- Rollback for migration 138: harden drain_recalculation_queue
-- ============================================================================
-- Drops recalculation_queue.outcome / error (their history is lost; export
-- them first if needed).
-- Run rollbacks in reverse order (140 -> 134). Function bodies restored here
-- are the LIVE prod definitions captured verbatim with pg_get_functiondef on
-- 2026-11-03 (md5-checked against the prod catalog), not repo migration files.
-- ============================================================================

BEGIN;

-- Live drain_recalculation_queue (pre-138)
CREATE OR REPLACE FUNCTION public.drain_recalculation_queue(p_max_depth integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_item RECORD;
    v_processed INTEGER := 0;
    v_cascade_depth INTEGER := 0;
BEGIN
    -- Process in chronological order (oldest month first - critical for carryover)
    LOOP
        -- Get next unprocessed item, ordered by month (oldest first for carryover).
        -- The partial unique index guarantees at most one pending row per (project, month).
        SELECT id, project_id, queue_month, reason
        INTO v_item
        FROM recalculation_queue
        WHERE processed_at IS NULL
        ORDER BY queue_month ASC, queued_at ASC
        LIMIT 1;

        EXIT WHEN v_item IS NULL;

        -- Safety: prevent runaway cascades
        IF v_item.reason = 'cascade' THEN
            v_cascade_depth := v_cascade_depth + 1;
            IF v_cascade_depth > p_max_depth THEN
                RAISE WARNING 'Cascade depth limit reached (%) for project %',
                    p_max_depth, v_item.project_id;
                EXIT;
            END IF;
        ELSE
            v_cascade_depth := 0;
        END IF;

        -- Recalculate
        PERFORM recalculate_project_month(v_item.project_id, v_item.queue_month);

        -- Mark ALL pending items for this project+month as processed
        UPDATE recalculation_queue
        SET processed_at = NOW()
        WHERE project_id = v_item.project_id
            AND queue_month = v_item.queue_month
            AND processed_at IS NULL;

        v_processed := v_processed + 1;
    END LOOP;

    RETURN v_processed;
END;
$function$;

DROP FUNCTION IF EXISTS public.billing_alert_eom_stale(UUID, DATE, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.billing_pms_fingerprint(UUID, DATE);
DROP FUNCTION IF EXISTS public.billing_ensure_tmt_fresh(DATE[], TEXT);
DROP FUNCTION IF EXISTS public.billing_drain_lock_key();

ALTER TABLE public.recalculation_queue DROP CONSTRAINT IF EXISTS recalculation_queue_outcome_check;
ALTER TABLE public.recalculation_queue DROP COLUMN IF EXISTS error;
ALTER TABLE public.recalculation_queue DROP COLUMN IF EXISTS outcome;

COMMIT;
