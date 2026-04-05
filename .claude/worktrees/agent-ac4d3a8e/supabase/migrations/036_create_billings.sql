-- ============================================================================
-- Migration 036: Create Billings Tables
-- ============================================================================
-- Purpose: Create billings module for tracking fixed-fee milestones and
-- standalone revenue not tied to timesheets.
--
-- Key concepts:
--   - Billings are containers under companies
--   - Transactions carry the actual money (amount_cents as BIGINT)
--   - Revenue milestones can optionally link to projects
--   - All money stored as cents to avoid float precision issues
--
-- 4-tier hierarchy:
--   1. Company (existing)
--   2. Billing (new container)
--   3. Transaction (new money entry)
--   4. Transaction Month (date bucket for filtering)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create billing_type enum
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_type') THEN
        CREATE TYPE billing_type AS ENUM (
            'revenue_milestone',
            'service_fee',
            'subscription',
            'license',
            'reimbursement'
        );
    END IF;
END $$;

COMMENT ON TYPE billing_type IS 'Classification of billing entries. revenue_milestone can link to projects.';

-- ============================================================================
-- STEP 2: Create billings table
-- ============================================================================

CREATE TABLE IF NOT EXISTS billings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Company relationship (required)
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- Billing details
    name TEXT NOT NULL,
    type billing_type NOT NULL,
    description TEXT,

    -- Optional project link (only for revenue_milestone type)
    linked_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique billing name per company
    CONSTRAINT uq_billings_company_name UNIQUE(company_id, name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_billings_company_id ON billings(company_id);
CREATE INDEX IF NOT EXISTS idx_billings_type ON billings(type);
CREATE INDEX IF NOT EXISTS idx_billings_linked_project_id ON billings(linked_project_id);

COMMENT ON TABLE billings IS 'Container for fixed-fee revenue entries. Each billing belongs to a company.';
COMMENT ON COLUMN billings.company_id IS 'Parent company for this billing (required).';
COMMENT ON COLUMN billings.name IS 'Name of the billing entry (unique per company).';
COMMENT ON COLUMN billings.type IS 'Classification: revenue_milestone, service_fee, subscription, license, reimbursement.';
COMMENT ON COLUMN billings.description IS 'Optional description of the billing.';
COMMENT ON COLUMN billings.linked_project_id IS 'Optional link to a project (only valid for revenue_milestone type).';

-- ============================================================================
-- STEP 3: Create billing_transactions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS billing_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent billing (required)
    billing_id UUID NOT NULL REFERENCES billings(id) ON DELETE CASCADE,

    -- Transaction details
    transaction_month DATE NOT NULL,  -- Normalized to YYYY-MM-01
    amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
    description TEXT NOT NULL,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for filtering and aggregation
CREATE INDEX IF NOT EXISTS idx_billing_transactions_billing_id ON billing_transactions(billing_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_month ON billing_transactions(transaction_month);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_billing_month ON billing_transactions(billing_id, transaction_month);

COMMENT ON TABLE billing_transactions IS 'Individual money entries under a billing. Amounts stored as cents (BIGINT).';
COMMENT ON COLUMN billing_transactions.billing_id IS 'Parent billing container.';
COMMENT ON COLUMN billing_transactions.transaction_month IS 'Month for this transaction (normalized to first of month).';
COMMENT ON COLUMN billing_transactions.amount_cents IS 'Amount in cents (e.g., 100000 = $1000.00). BIGINT for precision.';
COMMENT ON COLUMN billing_transactions.description IS 'Description of this transaction entry.';

-- ============================================================================
-- STEP 4: Updated_at triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION update_billings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billings_updated_at ON billings;
CREATE TRIGGER trg_billings_updated_at
    BEFORE UPDATE ON billings
    FOR EACH ROW
    EXECUTE FUNCTION update_billings_updated_at();

CREATE OR REPLACE FUNCTION update_billing_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_transactions_updated_at ON billing_transactions;
CREATE TRIGGER trg_billing_transactions_updated_at
    BEFORE UPDATE ON billing_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_billing_transactions_updated_at();

-- ============================================================================
-- STEP 5: Normalize transaction_month to first of month
-- ============================================================================

CREATE OR REPLACE FUNCTION normalize_transaction_month()
RETURNS TRIGGER AS $$
BEGIN
    -- Always normalize to first day of month
    NEW.transaction_month = date_trunc('month', NEW.transaction_month)::DATE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_transaction_month ON billing_transactions;
CREATE TRIGGER trg_normalize_transaction_month
    BEFORE INSERT OR UPDATE OF transaction_month ON billing_transactions
    FOR EACH ROW
    EXECUTE FUNCTION normalize_transaction_month();

-- ============================================================================
-- STEP 6: Validate billing constraints
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_billing_constraints()
RETURNS TRIGGER AS $$
DECLARE
    v_project_company_id UUID;
BEGIN
    -- Rule 1: Only revenue_milestone can have linked_project_id
    IF NEW.type != 'revenue_milestone' AND NEW.linked_project_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only revenue_milestone billings can have a linked project. Type "%" cannot have linked_project_id.', NEW.type;
    END IF;

    -- Rule 2: If linked_project_id is set, project must belong to same company
    IF NEW.linked_project_id IS NOT NULL THEN
        SELECT company_id INTO v_project_company_id
        FROM projects
        WHERE id = NEW.linked_project_id;

        IF v_project_company_id IS NULL THEN
            RAISE EXCEPTION 'Linked project % not found.', NEW.linked_project_id;
        END IF;

        IF v_project_company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Linked project must belong to the same company. Project company: %, Billing company: %',
                v_project_company_id, NEW.company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_billing_constraints ON billings;
CREATE TRIGGER trg_validate_billing_constraints
    BEFORE INSERT OR UPDATE ON billings
    FOR EACH ROW
    EXECUTE FUNCTION validate_billing_constraints();

-- ============================================================================
-- STEP 7: RPC Functions for CRUD Operations
-- ============================================================================

-- Create billing
CREATE OR REPLACE FUNCTION create_billing(
    p_company_id UUID,
    p_name TEXT,
    p_type billing_type,
    p_description TEXT DEFAULT NULL,
    p_linked_project_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO billings (company_id, name, type, description, linked_project_id)
    VALUES (p_company_id, p_name, p_type, p_description, p_linked_project_id)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_billing IS 'Create a new billing entry under a company.';

-- Update billing
CREATE OR REPLACE FUNCTION update_billing(
    p_id UUID,
    p_name TEXT DEFAULT NULL,
    p_type billing_type DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_linked_project_id UUID DEFAULT NULL,
    p_clear_linked_project BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE billings
    SET
        name = COALESCE(p_name, name),
        type = COALESCE(p_type, type),
        description = COALESCE(p_description, description),
        linked_project_id = CASE
            WHEN p_clear_linked_project THEN NULL
            WHEN p_linked_project_id IS NOT NULL THEN p_linked_project_id
            ELSE linked_project_id
        END
    WHERE id = p_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_billing IS 'Update an existing billing entry. Use p_clear_linked_project=true to remove project link.';

-- Delete billing
CREATE OR REPLACE FUNCTION delete_billing(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM billings WHERE id = p_id;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION delete_billing IS 'Delete a billing and all its transactions (cascades).';

-- Create transaction
CREATE OR REPLACE FUNCTION create_billing_transaction(
    p_billing_id UUID,
    p_transaction_month DATE,
    p_amount_cents BIGINT,
    p_description TEXT
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO billing_transactions (billing_id, transaction_month, amount_cents, description)
    VALUES (p_billing_id, p_transaction_month, p_amount_cents, p_description)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_billing_transaction IS 'Create a new transaction under a billing. Amount in cents.';

-- Update transaction
CREATE OR REPLACE FUNCTION update_billing_transaction(
    p_id UUID,
    p_transaction_month DATE DEFAULT NULL,
    p_amount_cents BIGINT DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE billing_transactions
    SET
        transaction_month = COALESCE(p_transaction_month, transaction_month),
        amount_cents = COALESCE(p_amount_cents, amount_cents),
        description = COALESCE(p_description, description)
    WHERE id = p_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_billing_transaction IS 'Update an existing transaction. Amount in cents.';

-- Delete transaction
CREATE OR REPLACE FUNCTION delete_billing_transaction(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM billing_transactions WHERE id = p_id;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION delete_billing_transaction IS 'Delete a single transaction.';

-- ============================================================================
-- STEP 8: Query function for billings with transactions
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
    billing_type billing_type,
    billing_description TEXT,
    linked_project_id UUID,
    linked_project_name TEXT,
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
        b.type AS billing_type,
        b.description AS billing_description,
        b.linked_project_id,
        p.project_name AS linked_project_name,
        bt.id AS transaction_id,
        bt.transaction_month,
        bt.amount_cents,
        bt.description AS transaction_description
    FROM billings b
    JOIN companies c ON c.id = b.company_id
    LEFT JOIN projects p ON p.id = b.linked_project_id
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
-- STEP 9: RLS Policies
-- ============================================================================

ALTER TABLE billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_transactions ENABLE ROW LEVEL SECURITY;

-- Billings: Read for all authenticated users
DROP POLICY IF EXISTS "Allow authenticated read on billings" ON billings;
CREATE POLICY "Allow authenticated read on billings"
    ON billings
    FOR SELECT
    TO authenticated
    USING (true);

-- Billings: Admin-only write
DROP POLICY IF EXISTS "Allow admin write on billings" ON billings;
CREATE POLICY "Allow admin write on billings"
    ON billings
    FOR ALL
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- Billings: Service role full access
DROP POLICY IF EXISTS "Allow service role full access on billings" ON billings;
CREATE POLICY "Allow service role full access on billings"
    ON billings
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Transactions: Read for all authenticated users
DROP POLICY IF EXISTS "Allow authenticated read on billing_transactions" ON billing_transactions;
CREATE POLICY "Allow authenticated read on billing_transactions"
    ON billing_transactions
    FOR SELECT
    TO authenticated
    USING (true);

-- Transactions: Admin-only write
DROP POLICY IF EXISTS "Allow admin write on billing_transactions" ON billing_transactions;
CREATE POLICY "Allow admin write on billing_transactions"
    ON billing_transactions
    FOR ALL
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- Transactions: Service role full access
DROP POLICY IF EXISTS "Allow service role full access on billing_transactions" ON billing_transactions;
CREATE POLICY "Allow service role full access on billing_transactions"
    ON billing_transactions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 10: Grant Permissions
-- ============================================================================

GRANT SELECT ON billings TO authenticated;
GRANT SELECT ON billing_transactions TO authenticated;
GRANT ALL ON billings TO service_role;
GRANT ALL ON billing_transactions TO service_role;

-- Grant execute on RPC functions
GRANT EXECUTE ON FUNCTION create_billing TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing TO authenticated;
GRANT EXECUTE ON FUNCTION delete_billing TO authenticated;
GRANT EXECUTE ON FUNCTION create_billing_transaction TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing_transaction TO authenticated;
GRANT EXECUTE ON FUNCTION delete_billing_transaction TO authenticated;
GRANT EXECUTE ON FUNCTION get_billings_with_transactions TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '036 Create Billings migration complete:';
    RAISE NOTICE '  - billing_type enum created';
    RAISE NOTICE '  - billings table created with company FK';
    RAISE NOTICE '  - billing_transactions table created with amount_cents (BIGINT)';
    RAISE NOTICE '  - Transaction month normalization trigger';
    RAISE NOTICE '  - Billing constraint validation trigger';
    RAISE NOTICE '  - RPC functions for CRUD operations';
    RAISE NOTICE '  - RLS policies: read for all, write for admins';
    RAISE NOTICE '';
    RAISE NOTICE 'Money handling: All amounts stored as cents (BIGINT).';
    RAISE NOTICE 'Example: $1,234.56 = 123456 cents';
END $$;

COMMIT;
