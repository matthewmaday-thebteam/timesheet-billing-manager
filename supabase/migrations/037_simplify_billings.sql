-- ============================================================================
-- Migration 037: Simplify Billings Table
-- ============================================================================
-- Purpose: Remove type, description, and linked_project_id from billings.
-- A billing is just a container (name) for grouping transactions.
-- Type, description, and project links belong at the transaction level.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Drop the constraint validation trigger (references removed columns)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_validate_billing_constraints ON billings;
DROP FUNCTION IF EXISTS validate_billing_constraints();

-- ============================================================================
-- STEP 2: Drop RPC functions that depend on billing_type
-- ============================================================================

DROP FUNCTION IF EXISTS create_billing(uuid, text, billing_type, text, uuid);
DROP FUNCTION IF EXISTS update_billing(uuid, text, billing_type, text, uuid, boolean);
DROP FUNCTION IF EXISTS get_billings_with_transactions(date, date);

-- ============================================================================
-- STEP 3: Drop indexes on columns being removed
-- ============================================================================

DROP INDEX IF EXISTS idx_billings_type;
DROP INDEX IF EXISTS idx_billings_linked_project_id;

-- ============================================================================
-- STEP 4: Drop columns from billings table
-- ============================================================================

ALTER TABLE billings DROP COLUMN IF EXISTS type;
ALTER TABLE billings DROP COLUMN IF EXISTS description;
ALTER TABLE billings DROP COLUMN IF EXISTS linked_project_id;

-- ============================================================================
-- STEP 5: Drop the billing_type enum (no longer needed)
-- ============================================================================

DROP TYPE IF EXISTS billing_type;

-- ============================================================================
-- STEP 6: Create simplified create_billing RPC function
-- ============================================================================

CREATE OR REPLACE FUNCTION create_billing(
    p_company_id UUID,
    p_name TEXT
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO billings (company_id, name)
    VALUES (p_company_id, p_name)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_billing IS 'Create a new billing container under a company.';

-- ============================================================================
-- STEP 7: Create simplified update_billing RPC function
-- ============================================================================

CREATE OR REPLACE FUNCTION update_billing(
    p_id UUID,
    p_name TEXT DEFAULT NULL,
    p_company_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE billings
    SET
        name = COALESCE(p_name, name),
        company_id = COALESCE(p_company_id, company_id)
    WHERE id = p_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_billing IS 'Update a billing name or move to different company.';

-- ============================================================================
-- STEP 8: Create simplified get_billings_with_transactions RPC function
-- ============================================================================

CREATE OR REPLACE FUNCTION get_billings_with_transactions(
    p_start_month DATE,
    p_end_month DATE
)
RETURNS TABLE (
    billing_id UUID,
    company_id UUID,
    company_name TEXT,
    company_display_name TEXT,
    billing_name TEXT,
    transaction_id UUID,
    transaction_month DATE,
    amount_cents BIGINT,
    transaction_description TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id AS billing_id,
        b.company_id,
        c.client_name AS company_name,
        c.display_name AS company_display_name,
        b.name AS billing_name,
        bt.id AS transaction_id,
        bt.transaction_month,
        bt.amount_cents,
        bt.description AS transaction_description
    FROM billings b
    JOIN companies c ON c.id = b.company_id
    LEFT JOIN billing_transactions bt ON bt.billing_id = b.id
        AND bt.transaction_month >= date_trunc('month', p_start_month)::DATE
        AND bt.transaction_month <= date_trunc('month', p_end_month)::DATE
    ORDER BY
        COALESCE(c.display_name, c.client_name),
        b.name,
        bt.transaction_month DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_billings_with_transactions IS
    'Fetch all billings with their transactions within a date range. Groups by company.';

-- ============================================================================
-- STEP 9: Re-grant permissions on new functions
-- ============================================================================

GRANT EXECUTE ON FUNCTION create_billing(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_billings_with_transactions(DATE, DATE) TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '037 Simplify Billings migration complete:';
    RAISE NOTICE '  - Dropped old RPC functions with billing_type dependency';
    RAISE NOTICE '  - Removed type, description, linked_project_id columns';
    RAISE NOTICE '  - Dropped billing_type enum';
    RAISE NOTICE '  - Created simplified RPC functions';
    RAISE NOTICE '';
    RAISE NOTICE 'Billings are now simple containers with just: id, company_id, name';
END $$;

COMMIT;
