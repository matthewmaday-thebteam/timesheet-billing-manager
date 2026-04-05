-- Migration 021: Migrate Existing Rates to project_monthly_rates
-- This migration creates rate records from existing projects.rate values
-- Task: 027 - Monthly Project Rates

-- ============================================================================
-- STEP 1: CREATE BASELINE SNAPSHOT FOR VERIFICATION
-- ============================================================================

CREATE TEMP TABLE migration_baseline AS
SELECT
    p.id AS project_id,
    p.project_name,
    p.rate AS old_rate,
    p.first_seen_month
FROM projects p;

-- ============================================================================
-- STEP 2: MIGRATE EXISTING RATES
-- ============================================================================

-- For each project, create a rate record for first_seen_month
-- Use existing rate if set, otherwise use default
INSERT INTO project_monthly_rates (project_id, rate_month, rate)
SELECT
    p.id,
    p.first_seen_month,
    COALESCE(p.rate, get_default_rate())
FROM projects p
WHERE p.first_seen_month IS NOT NULL
ON CONFLICT (project_id, rate_month) DO NOTHING;

-- ============================================================================
-- STEP 3: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_mismatch_count INTEGER;
    v_projects_count INTEGER;
    v_rates_count INTEGER;
    v_with_rate_count INTEGER;
    v_default_count INTEGER;
BEGIN
    -- Check for rate value mismatches
    SELECT COUNT(*) INTO v_mismatch_count
    FROM migration_baseline b
    JOIN projects p ON p.id = b.project_id
    LEFT JOIN project_monthly_rates pmr
        ON pmr.project_id = p.id
       AND pmr.rate_month = p.first_seen_month
    WHERE b.old_rate IS NOT NULL
      AND b.old_rate != pmr.rate;

    IF v_mismatch_count > 0 THEN
        RAISE WARNING 'Found % rate mismatches after migration', v_mismatch_count;
    END IF;

    -- Count stats
    SELECT COUNT(*) INTO v_projects_count FROM projects WHERE first_seen_month IS NOT NULL;
    SELECT COUNT(*) INTO v_rates_count FROM project_monthly_rates;
    SELECT COUNT(*) INTO v_with_rate_count FROM migration_baseline WHERE old_rate IS NOT NULL;
    SELECT COUNT(*) INTO v_default_count FROM migration_baseline WHERE old_rate IS NULL;

    RAISE NOTICE '==== Migration 021 Complete ====';
    RAISE NOTICE '  Projects with first_seen_month: %', v_projects_count;
    RAISE NOTICE '  Rate records created: %', v_rates_count;
    RAISE NOTICE '  Projects with existing rate: %', v_with_rate_count;
    RAISE NOTICE '  Projects using default rate: %', v_default_count;

    IF v_projects_count != v_rates_count THEN
        RAISE WARNING 'Mismatch: expected % rate records, got %', v_projects_count, v_rates_count;
    END IF;

    IF v_mismatch_count = 0 THEN
        RAISE NOTICE '  Verification: PASSED (all rates match)';
    ELSE
        RAISE WARNING '  Verification: FAILED (% mismatches)', v_mismatch_count;
    END IF;
END $$;

-- ============================================================================
-- STEP 4: REVENUE CALCULATION COMPARISON (Sample verification)
-- ============================================================================

-- Compare old vs new revenue calculation for a sample month
-- This helps verify the migration didn't change revenue calculations
DO $$
DECLARE
    v_old_revenue NUMERIC;
    v_new_revenue NUMERIC;
    v_difference NUMERIC;
    v_sample_month DATE := DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')::DATE;
BEGIN
    -- Old calculation method (using projects.rate directly)
    SELECT COALESCE(SUM(r.total_minutes / 60.0 * COALESCE(p.rate, get_default_rate())), 0)
    INTO v_old_revenue
    FROM timesheet_daily_rollups r
    JOIN projects p ON p.project_id = r.project_id
    WHERE DATE_TRUNC('month', r.work_date) = v_sample_month;

    -- New calculation method (using monthly rates)
    SELECT COALESCE(SUM(r.total_minutes / 60.0 * rates.effective_rate), 0)
    INTO v_new_revenue
    FROM timesheet_daily_rollups r
    JOIN projects p ON p.project_id = r.project_id
    JOIN get_effective_rates_for_range(v_sample_month, v_sample_month) rates
        ON rates.project_id = p.id AND rates.rate_month = v_sample_month
    WHERE DATE_TRUNC('month', r.work_date) = v_sample_month;

    v_difference := ABS(COALESCE(v_old_revenue, 0) - COALESCE(v_new_revenue, 0));

    RAISE NOTICE '==== Revenue Comparison for % ====', v_sample_month;
    RAISE NOTICE '  Old calculation: $%', ROUND(v_old_revenue, 2);
    RAISE NOTICE '  New calculation: $%', ROUND(v_new_revenue, 2);
    RAISE NOTICE '  Difference: $%', ROUND(v_difference, 2);

    IF v_difference > 0.01 THEN
        RAISE WARNING '  Revenue calculation MISMATCH! Difference: $%', ROUND(v_difference, 2);
    ELSE
        RAISE NOTICE '  Revenue verification: PASSED';
    END IF;
END $$;

-- ============================================================================
-- STEP 5: CLEANUP
-- ============================================================================

DROP TABLE migration_baseline;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE '==== Migration 021 Finished ====';
    RAISE NOTICE 'Backup table preserved: projects_backup_task027';
    RAISE NOTICE 'To rollback, run: supabase/rollbacks/020_021_rollback.sql';
END $$;
