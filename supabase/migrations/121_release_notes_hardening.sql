-- ============================================================================
-- Migration 121: release_notes hardening (post-review polish)
-- ============================================================================
-- Two non-blocking items from the security review of migration 120:
--   1. Guarantee `highlights` is always a JSON array, so the public page's
--      `highlights.map(...)` can never hit a non-array value (admin/service-role
--      inserting a non-array would otherwise render "[object Object]").
--   2. Stamp `updated_by` on every UPDATE (direct admin edits via RLS AND the
--      publish/unpublish RPCs), so the audit trail is complete. `auth.uid()`
--      reads the JWT claim and is correct even inside SECURITY DEFINER RPCs.
--
-- Additive and reversible. Applied via the Management API (no db push).
-- All existing rows already store JSON arrays, so the CHECK validates cleanly.
-- ============================================================================

BEGIN;

-- 1. highlights must be a JSON array
ALTER TABLE public.release_notes
  ADD CONSTRAINT chk_release_notes_highlights_array
  CHECK (jsonb_typeof(highlights) = 'array');

-- 2. updated_by stamped on every update
CREATE OR REPLACE FUNCTION public.set_release_notes_updated_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_release_notes_updated_by() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_release_notes_set_updated_by ON public.release_notes;
CREATE TRIGGER trg_release_notes_set_updated_by
  BEFORE UPDATE ON public.release_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_release_notes_updated_by();

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (manual)
-- ----------------------------------------------------------------------------
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_release_notes_set_updated_by ON public.release_notes;
--   DROP FUNCTION IF EXISTS public.set_release_notes_updated_by();
--   ALTER TABLE public.release_notes DROP CONSTRAINT IF EXISTS chk_release_notes_highlights_array;
--   COMMIT;
-- ============================================================================
