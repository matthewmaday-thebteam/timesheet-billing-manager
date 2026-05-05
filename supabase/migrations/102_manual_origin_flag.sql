-- ============================================================================
-- Migration 102: Manual origin flag for companies and projects
-- ============================================================================
-- Date: 2026-05-05
--
-- Purpose:
--   Mark manually-created companies and projects so they can be distinguished
--   from sync-originated rows. Enables manual create flows for clients with
--   milestone billings before any time is tracked.
--
--   Manually-created rows use a 'manual_' prefix on their external id
--   (companies.client_id, projects.project_id) to guarantee they cannot
--   collide with sync IDs. The Clockify auto-create trigger uses
--   ON CONFLICT (project_id) DO UPDATE with a name-change guard, and never
--   touches the manual_origin column, so manual rows are stable across syncs.
--
--   INSERT is gated to admins via is_admin(), matching the financial-table
--   security posture established in migration 062 (billings,
--   project_monthly_billing_limits).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Add manual_origin column to companies and projects
-- ----------------------------------------------------------------------------

ALTER TABLE companies
    ADD COLUMN manual_origin BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE projects
    ADD COLUMN manual_origin BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 2. Enforce 'manual_' prefix on the external id when manual_origin = true
-- ----------------------------------------------------------------------------

ALTER TABLE companies
    ADD CONSTRAINT companies_manual_origin_id_format
    CHECK (manual_origin = false OR client_id LIKE 'manual\_%' ESCAPE '\');

ALTER TABLE projects
    ADD CONSTRAINT projects_manual_origin_id_format
    CHECK (manual_origin = false OR project_id LIKE 'manual\_%' ESCAPE '\');

-- ----------------------------------------------------------------------------
-- 3. Admin-only INSERT policies (matches billings, project_monthly_billing_limits)
-- ----------------------------------------------------------------------------

-- Table-level grants must precede the policy. PostgreSQL evaluates GRANTs
-- before RLS — without these, even admins receive "permission denied for
-- table ...".
GRANT INSERT ON companies TO authenticated;
GRANT INSERT ON projects TO authenticated;

CREATE POLICY companies_admin_insert ON companies
    FOR INSERT TO authenticated
    WITH CHECK (is_admin());

CREATE POLICY projects_admin_insert ON projects
    FOR INSERT TO authenticated
    WITH CHECK (is_admin());

-- ----------------------------------------------------------------------------
-- 4. Column comments
-- ----------------------------------------------------------------------------

COMMENT ON COLUMN companies.manual_origin IS
    'True when the company was created manually via the app (not via Clockify sync). Manually-created rows use a ''manual_'' prefix on client_id to avoid collision with sync IDs.';

COMMENT ON COLUMN projects.manual_origin IS
    'True when the project was created manually via the app (not via Clockify sync). Manually-created rows use a ''manual_'' prefix on project_id to avoid collision with sync IDs.';

COMMIT;

-- ============================================================================
-- DOWN MIGRATION (manual revert):
-- DROP POLICY companies_admin_insert ON companies;
-- DROP POLICY projects_admin_insert ON projects;
-- ALTER TABLE companies DROP CONSTRAINT companies_manual_origin_id_format;
-- ALTER TABLE projects DROP CONSTRAINT projects_manual_origin_id_format;
-- ALTER TABLE companies DROP COLUMN manual_origin;
-- ALTER TABLE projects DROP COLUMN manual_origin;
-- ============================================================================
