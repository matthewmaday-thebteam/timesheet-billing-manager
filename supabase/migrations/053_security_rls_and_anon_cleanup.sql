-- Migration 053: Security cleanup — RLS on legacy tables + revoke anon from admin_users_view
-- Resolves Supabase linter findings: rls_disabled_in_public, auth_users_exposed

-- ============================================================================
-- 1. Enable RLS on legacy/backup tables (no policies = deny-all)
-- ============================================================================

-- Migration audit artifact — not used by the application
ALTER TABLE public._migration_audit_deleted_duplicates ENABLE ROW LEVEL SECURITY;

-- Legacy ClickUp data — superseded by Clockify integration
ALTER TABLE public.clickup_time_entries ENABLE ROW LEVEL SECURITY;

-- One-time backup from Task 027 — not used by the application
ALTER TABLE public.projects_backup_task027 ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Revoke anon access to admin_users_view
-- ============================================================================
-- The view was only granted to `authenticated` in migration 010, but anon
-- can still read it via PostgREST since it's in the public schema.
-- This explicitly revokes anon access.

REVOKE ALL ON public.admin_users_view FROM anon;

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '053 Security cleanup complete:';
    RAISE NOTICE '  - RLS enabled on _migration_audit_deleted_duplicates (deny-all)';
    RAISE NOTICE '  - RLS enabled on clickup_time_entries (deny-all)';
    RAISE NOTICE '  - RLS enabled on projects_backup_task027 (deny-all)';
    RAISE NOTICE '  - Revoked anon access to admin_users_view';
END $$;
