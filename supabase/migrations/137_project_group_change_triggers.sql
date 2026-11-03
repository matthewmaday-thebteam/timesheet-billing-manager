-- ============================================================================
-- Migration 137: Queue recalculation when project grouping changes
-- ============================================================================
-- Purpose:
--   RC1: adding a project to a group queued nothing, so the primary's
--   summaries kept excluding the new member's hours (ACE Oct). Any change to
--   project_groups / project_group_members changes which rollups feed which
--   canonical project, so the affected months are queued (reason
--   'group_change'):
--
--     project_group_members AFTER INSERT   -> primary, for the member's months
--     project_group_members BEFORE DELETE  -> primary (while the group still
--                                             exists, i.e. before
--                                             trg_pgm_auto_dissolve) and the
--                                             member itself (now standalone)
--     project_groups AFTER UPDATE OF primary_project_id
--                                          -> old and new primary, for the
--                                             months of every project in the
--                                             group
--     project_groups BEFORE DELETE         -> the primary, for the months of
--                                             every project in the group
--                                             (members deleted by the FK
--                                             cascade no longer see the group)
--
--   "Months of a project" = months with rollups (total_minutes > 0) or with a
--   project_monthly_summary row. Locked months are queued too; the drain
--   skips and alerts them (migration 138).
--
-- Depends on: 134.
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
-- Rollback: supabase/rollbacks/137_project_group_change_triggers_rollback.sql
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.billing_project_activity_months(p_project_ids UUID[])
RETURNS TABLE(month DATE)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT DATE_TRUNC('month', t.work_date)::DATE
      FROM timesheet_daily_rollups t
      JOIN projects p ON p.project_id = t.project_id
     WHERE p.id = ANY(p_project_ids)
       AND t.total_minutes > 0
       AND t.work_date IS NOT NULL
    UNION
    SELECT s.summary_month
      FROM project_monthly_summary s
     WHERE s.project_id = ANY(p_project_ids);
$function$;

-- Queue p_target_ids x (months of p_source_ids).
CREATE OR REPLACE FUNCTION public.enqueue_project_group_months(
    p_target_ids UUID[],
    p_source_ids UUID[],
    p_reason     TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_count INTEGER;
BEGIN
    WITH offered AS (
        SELECT DISTINCT t.id AS project_id, m.month
          FROM UNNEST(p_target_ids) AS t(id)
          CROSS JOIN billing_project_activity_months(p_source_ids) m
         WHERE t.id IS NOT NULL
    ), ins AS (
        INSERT INTO recalculation_queue (project_id, queue_month, reason)
        SELECT o.project_id, o.month, p_reason FROM offered o
        ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
        DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM offered;
    RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_on_project_group_member_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_primary UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT g.primary_project_id INTO v_primary FROM project_groups g WHERE g.id = NEW.group_id;
        PERFORM enqueue_project_group_months(ARRAY[v_primary], ARRAY[NEW.member_project_id], 'group_change');
        RETURN NEW;
    END IF;

    -- DELETE (BEFORE): the group may already be gone when this is an FK
    -- cascade from project_groups; its own trigger queued the primary then.
    SELECT g.primary_project_id INTO v_primary FROM project_groups g WHERE g.id = OLD.group_id;
    PERFORM enqueue_project_group_months(ARRAY[v_primary, OLD.member_project_id],
                                         ARRAY[OLD.member_project_id], 'group_change');
    RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_on_project_group_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_projects UUID[];
BEGIN
    SELECT ARRAY_AGG(m.member_project_id) INTO v_projects
      FROM project_group_members m
     WHERE m.group_id = OLD.id;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.primary_project_id IS DISTINCT FROM NEW.primary_project_id THEN
            PERFORM enqueue_project_group_months(
                ARRAY[OLD.primary_project_id, NEW.primary_project_id],
                COALESCE(v_projects, '{}') || ARRAY[OLD.primary_project_id, NEW.primary_project_id],
                'group_change');
        END IF;
        RETURN NEW;
    END IF;

    -- DELETE (BEFORE)
    PERFORM enqueue_project_group_months(
        ARRAY[OLD.primary_project_id],
        COALESCE(v_projects, '{}') || ARRAY[OLD.primary_project_id],
        'group_change');
    RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_on_pgm_insert ON public.project_group_members;
CREATE TRIGGER trg_enqueue_on_pgm_insert
    AFTER INSERT ON public.project_group_members
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_on_project_group_member_change();

DROP TRIGGER IF EXISTS trg_enqueue_on_pgm_delete ON public.project_group_members;
CREATE TRIGGER trg_enqueue_on_pgm_delete
    BEFORE DELETE ON public.project_group_members
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_on_project_group_member_change();

DROP TRIGGER IF EXISTS trg_enqueue_on_pg_primary_change ON public.project_groups;
CREATE TRIGGER trg_enqueue_on_pg_primary_change
    AFTER UPDATE OF primary_project_id ON public.project_groups
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_on_project_group_change();

DROP TRIGGER IF EXISTS trg_enqueue_on_pg_delete ON public.project_groups;
CREATE TRIGGER trg_enqueue_on_pg_delete
    BEFORE DELETE ON public.project_groups
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_on_project_group_change();

REVOKE ALL ON FUNCTION public.billing_project_activity_months(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enqueue_project_group_months(UUID[], UUID[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_on_project_group_member_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_on_project_group_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_project_activity_months(UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_project_group_months(UUID[], UUID[], TEXT) TO service_role;

COMMIT;
