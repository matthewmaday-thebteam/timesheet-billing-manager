-- ============================================================================
-- 066: Pin search_path on all public functions
--
-- Problem: Supabase linter flags all public functions without an explicit
-- search_path as "function_search_path_mutable" (WARN / SECURITY).
--
-- Fix: ALTER FUNCTION ... SET search_path = public
-- This does NOT change function bodies, arguments, return types, or grants.
-- It only pins the search_path so it can't be manipulated by callers.
--
-- Functions that already have search_path set (e.g. admin_create_user from
-- migration 041) are automatically skipped.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
  fixed_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proconfig IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM unnest(p.proconfig) AS c WHERE c LIKE 'search_path=%'
           ))
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public',
      r.proname,
      r.args
    );
    RAISE NOTICE 'Pinned search_path for: public.%(%) ', r.proname, r.args;
    fixed_count := fixed_count + 1;
  END LOOP;

  RAISE NOTICE '066 Fix function search paths: pinned search_path on % functions', fixed_count;
END;
$$;

COMMIT;
