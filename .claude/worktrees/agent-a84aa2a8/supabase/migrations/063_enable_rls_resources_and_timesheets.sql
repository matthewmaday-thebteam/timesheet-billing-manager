-- ============================================================================
-- Migration 063: Enable RLS on resources and timesheet_daily_rollups
-- ============================================================================
-- Both tables predate the migration system and never had RLS enabled.
-- Without RLS, any authenticated user can read and write all rows.
--
-- resources: contains employee names, billing rates, hourly rates, employment
--   types, external IDs. Frontend reads as any user; writes only from admin
--   edit modal or service_role (n8n sync, auto-create trigger).
--
-- timesheet_daily_rollups: contains all historical timesheet data. Frontend
--   reads via v_timesheet_entries view; writes only from service_role (n8n
--   sync) and SECURITY DEFINER triggers.
-- ============================================================================

-- ============================================================================
-- STEP 1: resources — enable RLS with read-all, admin-write
-- ============================================================================

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Allow authenticated read resources"
    ON resources FOR SELECT
    TO authenticated
    USING (true);

-- Only admins can insert
CREATE POLICY "Allow admin insert resources"
    ON resources FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

-- Only admins can update
CREATE POLICY "Allow admin update resources"
    ON resources FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- Only admins can delete
CREATE POLICY "Allow admin delete resources"
    ON resources FOR DELETE
    TO authenticated
    USING (is_admin());

-- Service role: full access (n8n sync, auto-create trigger)
CREATE POLICY "Allow service role full access resources"
    ON resources FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 2: timesheet_daily_rollups — enable RLS with read-all, service-write
-- ============================================================================

ALTER TABLE timesheet_daily_rollups ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed for v_timesheet_entries view)
CREATE POLICY "Allow authenticated read timesheet_daily_rollups"
    ON timesheet_daily_rollups FOR SELECT
    TO authenticated
    USING (true);

-- Service role: full access (n8n sync is the only writer)
CREATE POLICY "Allow service role full access timesheet_daily_rollups"
    ON timesheet_daily_rollups FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- No INSERT/UPDATE/DELETE for authenticated users on timesheet_daily_rollups.
-- All writes come from n8n sync (service_role) or SECURITY DEFINER triggers.

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    v_resources_rls BOOLEAN;
    v_timesheets_rls BOOLEAN;
BEGIN
    SELECT relrowsecurity INTO v_resources_rls
    FROM pg_class WHERE relname = 'resources';

    SELECT relrowsecurity INTO v_timesheets_rls
    FROM pg_class WHERE relname = 'timesheet_daily_rollups';

    RAISE NOTICE 'Migration 063 Complete:';
    RAISE NOTICE '  - resources RLS enabled: %', v_resources_rls;
    RAISE NOTICE '  - timesheet_daily_rollups RLS enabled: %', v_timesheets_rls;
    RAISE NOTICE '  - resources: read=all, write=admin, full=service_role';
    RAISE NOTICE '  - timesheet_daily_rollups: read=all, write=service_role only';
END $$;
