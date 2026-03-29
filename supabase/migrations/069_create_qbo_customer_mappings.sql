-- ============================================================================
-- Migration 069: QuickBooks Online Customer Mappings
-- ============================================================================
-- Purpose: Create a mapping table that links Manifest companies (from the
-- companies table) to QBO customers. Each company can be mapped to exactly
-- one QBO customer, enabling the EOM billing workflow to push invoices to
-- the correct QBO customer.
--
-- Changes:
--   1. qbo_customer_mappings table (company <-> QBO customer link)
--   2. Unique constraint on company_id (one mapping per company)
--   3. Index on qbo_customer_id for reverse lookups
--   4. Updated_at trigger
--   5. RLS policies (authenticated SELECT, service_role full access)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE qbo_customer_mappings TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS qbo_customer_mappings (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    qbo_customer_id      TEXT NOT NULL,
    qbo_customer_name    TEXT NOT NULL,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW(),

    -- One mapping per company
    CONSTRAINT uq_qbo_customer_mappings_company UNIQUE(company_id)
);

COMMENT ON TABLE qbo_customer_mappings IS
    'Links Manifest companies to QuickBooks Online customers. Each company '
    'can be mapped to exactly one QBO customer for invoice generation.';

COMMENT ON COLUMN qbo_customer_mappings.company_id IS
    'FK to companies.id. UNIQUE constraint ensures one QBO mapping per company.';

COMMENT ON COLUMN qbo_customer_mappings.qbo_customer_id IS
    'The QBO Customer.Id (string). Stored as TEXT because QBO IDs are opaque strings.';

COMMENT ON COLUMN qbo_customer_mappings.qbo_customer_name IS
    'Denormalized display name from QBO (Customer.DisplayName). Stored for '
    'reference so the UI can show the mapped name without re-fetching from QBO.';

-- ============================================================================
-- STEP 2: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qbo_customer_mappings_company
    ON qbo_customer_mappings (company_id);

CREATE INDEX IF NOT EXISTS idx_qbo_customer_mappings_qbo_customer
    ON qbo_customer_mappings (qbo_customer_id);

-- ============================================================================
-- STEP 3: UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_qbo_customer_mappings_updated_at ON qbo_customer_mappings;
CREATE TRIGGER trg_qbo_customer_mappings_updated_at
    BEFORE UPDATE ON qbo_customer_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: RLS POLICIES
-- ============================================================================
-- Authenticated users need to READ mappings so the frontend knows which
-- companies are mapped. All writes (INSERT/UPDATE/DELETE) are done via
-- Edge Functions using the service_role key, so only service_role needs
-- write access.

ALTER TABLE qbo_customer_mappings ENABLE ROW LEVEL SECURITY;

-- Authenticated users: read-only
DROP POLICY IF EXISTS "Authenticated read qbo_customer_mappings" ON qbo_customer_mappings;
CREATE POLICY "Authenticated read qbo_customer_mappings"
    ON qbo_customer_mappings FOR SELECT
    TO authenticated
    USING (true);

-- Service role: full access (Edge Functions use this for writes)
DROP POLICY IF EXISTS "Service role full access qbo_customer_mappings" ON qbo_customer_mappings;
CREATE POLICY "Service role full access qbo_customer_mappings"
    ON qbo_customer_mappings FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 5: GRANTS
-- ============================================================================

GRANT SELECT ON qbo_customer_mappings TO authenticated;
GRANT ALL ON qbo_customer_mappings TO service_role;

-- ============================================================================
-- STEP 6: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_policy_count INTEGER;
BEGIN
    -- Verify table
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'qbo_customer_mappings'
    ) INTO v_table_exists;

    -- Count policies
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE tablename = 'qbo_customer_mappings';

    RAISE NOTICE 'Migration 069 Complete:';
    RAISE NOTICE '  - qbo_customer_mappings table: %', CASE WHEN v_table_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - RLS policies: %', v_policy_count;
    RAISE NOTICE '  - updated_at trigger attached';
    RAISE NOTICE '  - Authenticated SELECT + service_role ALL';

    IF NOT v_table_exists THEN
        RAISE WARNING 'qbo_customer_mappings table was not created!';
    END IF;
END $$;

COMMIT;
