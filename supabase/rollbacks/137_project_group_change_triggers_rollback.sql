-- ============================================================================
-- Rollback for migration 137: project group change triggers
-- ============================================================================
-- Run rollbacks in reverse order (140 -> 134). Function bodies restored here
-- are the LIVE prod definitions captured verbatim with pg_get_functiondef on
-- 2026-11-03 (md5-checked against the prod catalog), not repo migration files.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_enqueue_on_pgm_insert ON public.project_group_members;
DROP TRIGGER IF EXISTS trg_enqueue_on_pgm_delete ON public.project_group_members;
DROP TRIGGER IF EXISTS trg_enqueue_on_pg_primary_change ON public.project_groups;
DROP TRIGGER IF EXISTS trg_enqueue_on_pg_delete ON public.project_groups;

DROP FUNCTION IF EXISTS public.enqueue_on_project_group_member_change();
DROP FUNCTION IF EXISTS public.enqueue_on_project_group_change();
DROP FUNCTION IF EXISTS public.enqueue_project_group_months(UUID[], UUID[], TEXT);
DROP FUNCTION IF EXISTS public.billing_project_activity_months(UUID[]);

COMMIT;
