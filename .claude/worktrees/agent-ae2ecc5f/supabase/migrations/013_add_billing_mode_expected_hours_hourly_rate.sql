-- ============================================================================
-- 013: Add Billing Mode, Expected Hours, and Hourly Rate to Resources
-- Enables accurate cost tracking for contractors and part-time employees
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add new columns with safe defaults
-- ============================================================================

ALTER TABLE resources
ADD COLUMN IF NOT EXISTS billing_mode TEXT DEFAULT 'monthly';

ALTER TABLE resources
ADD COLUMN IF NOT EXISTS expected_hours DECIMAL(5,2) DEFAULT NULL;

ALTER TABLE resources
ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2) DEFAULT NULL;

-- ============================================================================
-- STEP 2: Backfill existing data
-- ============================================================================

UPDATE resources
SET billing_mode = 'monthly'
WHERE billing_mode IS NULL;

-- ============================================================================
-- STEP 3: Add constraints
-- ============================================================================

ALTER TABLE resources
ADD CONSTRAINT chk_billing_mode_values
CHECK (billing_mode IN ('monthly', 'hourly'));

ALTER TABLE resources
ALTER COLUMN billing_mode SET NOT NULL;

ALTER TABLE resources
ADD CONSTRAINT chk_hourly_requires_rate
CHECK (billing_mode != 'hourly' OR hourly_rate IS NOT NULL);

ALTER TABLE resources
ADD CONSTRAINT chk_hourly_no_monthly_data
CHECK (billing_mode != 'hourly' OR (monthly_cost IS NULL AND expected_hours IS NULL));

-- ============================================================================
-- STEP 4: Add documentation
-- ============================================================================

COMMENT ON COLUMN resources.billing_mode IS
    'Cost calculation mode: "monthly" uses monthly_cost/expected_hours, "hourly" uses hourly_rate';

COMMENT ON COLUMN resources.expected_hours IS
    'Expected monthly hours. NULL defaults to 160 (full-time) in application logic.';

COMMENT ON COLUMN resources.hourly_rate IS
    'Hourly billing rate. Only applicable when billing_mode = "hourly".';

-- ============================================================================
-- STEP 5: Create index (optional, for filtering)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_resources_billing_mode
ON resources(billing_mode);

-- ============================================================================
-- Migration report
-- ============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_monthly INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM resources;
    SELECT COUNT(*) INTO v_monthly FROM resources WHERE billing_mode = 'monthly';

    RAISE NOTICE '013 migration complete:';
    RAISE NOTICE '  - Total resources: %', v_total;
    RAISE NOTICE '  - Monthly billing: %', v_monthly;
    RAISE NOTICE '  - New columns: billing_mode, expected_hours, hourly_rate';
END $$;

COMMIT;
