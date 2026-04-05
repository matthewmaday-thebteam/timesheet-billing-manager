-- ============================================================================
-- Migration 039: Move Type and Linked Project from Transaction to Billing
-- ============================================================================
-- Purpose: Type and linked project belong at the billing level, not transaction.
-- A billing has a type and optional project association.
-- Transactions are just amounts with dates and descriptions.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add columns to billings table
-- ============================================================================

ALTER TABLE billings
ADD COLUMN IF NOT EXISTS type transaction_type NOT NULL DEFAULT 'service_fee';

ALTER TABLE billings
ADD COLUMN IF NOT EXISTS linked_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billings_type ON billings(type);
CREATE INDEX IF NOT EXISTS idx_billings_linked_project_id ON billings(linked_project_id);

COMMENT ON COLUMN billings.type IS 'Classification: revenue_milestone, service_fee, subscription, license, reimbursement.';
COMMENT ON COLUMN billings.linked_project_id IS 'Optional link to a project (only valid for revenue_milestone type).';

-- ============================================================================
-- STEP 2: Migrate existing data from transactions to billings
-- ============================================================================
-- For each billing, take the type from its first transaction (if any)

UPDATE billings b
SET type = (
    SELECT bt.type
    FROM billing_transactions bt
    WHERE bt.billing_id = b.id
    ORDER BY bt.created_at ASC
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1 FROM billing_transactions bt WHERE bt.billing_id = b.id
);

UPDATE billings b
SET linked_project_id = (
    SELECT bt.linked_project_id
    FROM billing_transactions bt
    WHERE bt.billing_id = b.id AND bt.linked_project_id IS NOT NULL
    ORDER BY bt.created_at ASC
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1 FROM billing_transactions bt
    WHERE bt.billing_id = b.id AND bt.linked_project_id IS NOT NULL
);

-- ============================================================================
-- STEP 3: Drop columns from billing_transactions
-- ============================================================================

DROP INDEX IF EXISTS idx_billing_transactions_type;
DROP INDEX IF EXISTS idx_billing_transactions_linked_project_id;

ALTER TABLE billing_transactions DROP COLUMN IF EXISTS type;
ALTER TABLE billing_transactions DROP COLUMN IF EXISTS linked_project_id;

-- ============================================================================
-- STEP 4: Update constraint validation trigger for billings
-- ============================================================================

DROP TRIGGER IF EXISTS trg_validate_transaction_constraints ON billing_transactions;
DROP FUNCTION IF EXISTS validate_transaction_constraints();

CREATE OR REPLACE FUNCTION validate_billing_constraints()
RETURNS TRIGGER AS $$
DECLARE
    v_project_company_id UUID;
BEGIN
    -- Rule 1: Only revenue_milestone can have linked_project_id
    IF NEW.type != 'revenue_milestone' AND NEW.linked_project_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only revenue_milestone billings can have a linked project. Type "%" cannot have linked_project_id.', NEW.type;
    END IF;

    -- Rule 2: If linked_project_id is set, project must belong to same company as billing
    IF NEW.linked_project_id IS NOT NULL THEN
        SELECT company_id INTO v_project_company_id
        FROM projects
        WHERE id = NEW.linked_project_id;

        IF v_project_company_id IS NULL THEN
            RAISE EXCEPTION 'Linked project % not found.', NEW.linked_project_id;
        END IF;

        IF v_project_company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Linked project must belong to the same company as the billing. Project company: %, Billing company: %',
                v_project_company_id, NEW.company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_billing_constraints
    BEFORE INSERT OR UPDATE ON billings
    FOR EACH ROW
    EXECUTE FUNCTION validate_billing_constraints();

-- ============================================================================
-- STEP 5: Update create_billing RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS create_billing(UUID, TEXT);

CREATE OR REPLACE FUNCTION create_billing(
    p_company_id UUID,
    p_name TEXT,
    p_type transaction_type DEFAULT 'service_fee',
    p_linked_project_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO billings (company_id, name, type, linked_project_id)
    VALUES (p_company_id, p_name, p_type, p_linked_project_id)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_billing IS 'Create a new billing container under a company with type and optional project link.';

-- ============================================================================
-- STEP 6: Update update_billing RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS update_billing(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION update_billing(
    p_id UUID,
    p_name TEXT DEFAULT NULL,
    p_company_id UUID DEFAULT NULL,
    p_type transaction_type DEFAULT NULL,
    p_linked_project_id UUID DEFAULT NULL,
    p_clear_linked_project BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE billings
    SET
        name = COALESCE(p_name, name),
        company_id = COALESCE(p_company_id, company_id),
        type = COALESCE(p_type, type),
        linked_project_id = CASE
            WHEN p_clear_linked_project THEN NULL
            WHEN p_linked_project_id IS NOT NULL THEN p_linked_project_id
            ELSE linked_project_id
        END
    WHERE id = p_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_billing IS 'Update a billing name, company, type, or project link.';

-- ============================================================================
-- STEP 7: Update create_billing_transaction RPC function (simplified)
-- ============================================================================

DROP FUNCTION IF EXISTS create_billing_transaction(UUID, DATE, BIGINT, TEXT, transaction_type, UUID);

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

-- ============================================================================
-- STEP 8: Update update_billing_transaction RPC function (simplified)
-- ============================================================================

DROP FUNCTION IF EXISTS update_billing_transaction(UUID, DATE, BIGINT, TEXT, transaction_type, UUID, BOOLEAN);

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

-- ============================================================================
-- STEP 9: Update get_billings_with_transactions RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS get_billings_with_transactions(DATE, DATE);

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
    billing_type transaction_type,
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
    'Fetch all billings with their transactions within a date range. Type and project link are on billing level.';

-- ============================================================================
-- STEP 10: Re-grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION create_billing(UUID, TEXT, transaction_type, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing(UUID, TEXT, UUID, transaction_type, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION create_billing_transaction(UUID, DATE, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing_transaction(UUID, DATE, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_billings_with_transactions(DATE, DATE) TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '039 Move Type to Billing migration complete:';
    RAISE NOTICE '  - Added type and linked_project_id to billings table';
    RAISE NOTICE '  - Migrated existing data from transactions';
    RAISE NOTICE '  - Removed type and linked_project_id from billing_transactions';
    RAISE NOTICE '  - Updated constraint validation trigger';
    RAISE NOTICE '  - Updated RPC functions';
END $$;

COMMIT;
