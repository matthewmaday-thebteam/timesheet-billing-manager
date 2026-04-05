-- ============================================================================
-- Migration 062: Restrict financial table writes to admin users only
-- ============================================================================
-- Previously, all authenticated users could UPDATE projects (rates, names,
-- target hours) and INSERT/UPDATE billing limits, active status, and billing
-- month status. This allowed any logged-in user to corrupt financial data.
--
-- Fix: Replace permissive write policies with is_admin() checks.
-- SELECT remains open to all authenticated users.
-- service_role access is unchanged.
-- ============================================================================

-- ============================================================================
-- STEP 1: projects — UPDATE restricted to admin
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated update access to projects" ON projects;
CREATE POLICY "Allow admin update access to projects"
    ON projects FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ============================================================================
-- STEP 2: project_monthly_billing_limits — INSERT/UPDATE restricted to admin
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated insert billing limits" ON project_monthly_billing_limits;
CREATE POLICY "Allow admin insert billing limits"
    ON project_monthly_billing_limits FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow authenticated update billing limits" ON project_monthly_billing_limits;
CREATE POLICY "Allow admin update billing limits"
    ON project_monthly_billing_limits FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ============================================================================
-- STEP 3: project_monthly_active_status — INSERT/UPDATE restricted to admin
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated insert active status" ON project_monthly_active_status;
CREATE POLICY "Allow admin insert active status"
    ON project_monthly_active_status FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow authenticated update active status" ON project_monthly_active_status;
CREATE POLICY "Allow admin update active status"
    ON project_monthly_active_status FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ============================================================================
-- STEP 4: billing_month_status — INSERT/UPDATE restricted to admin
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated insert billing status" ON billing_month_status;
CREATE POLICY "Allow admin insert billing status"
    ON billing_month_status FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow authenticated update billing status" ON billing_month_status;
CREATE POLICY "Allow admin update billing status"
    ON billing_month_status FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
    v_policy_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE policyname LIKE 'Allow admin%'
      AND tablename IN ('projects', 'project_monthly_billing_limits',
                        'project_monthly_active_status', 'billing_month_status');

    RAISE NOTICE 'Migration 062 Complete:';
    RAISE NOTICE '  - % admin-only write policies created', v_policy_count;
    RAISE NOTICE '  - projects: UPDATE restricted to admin';
    RAISE NOTICE '  - project_monthly_billing_limits: INSERT/UPDATE restricted to admin';
    RAISE NOTICE '  - project_monthly_active_status: INSERT/UPDATE restricted to admin';
    RAISE NOTICE '  - billing_month_status: INSERT/UPDATE restricted to admin';
    RAISE NOTICE '  - SELECT remains open to all authenticated users';
END $$;
