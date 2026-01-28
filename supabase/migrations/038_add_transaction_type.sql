-- ============================================================================
-- Migration 038: Add Type and Linked Project to Transactions
-- ============================================================================
-- Purpose: Add transaction_type enum and linked_project_id to billing_transactions.
-- Type and project association belong at the transaction level, not billing level.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create transaction_type enum
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
        CREATE TYPE transaction_type AS ENUM (
            'revenue_milestone',
            'service_fee',
            'subscription',
            'license',
            'reimbursement'
        );
    END IF;
END $$;

COMMENT ON TYPE transaction_type IS 'Classification of transaction entries. revenue_milestone can link to projects.';

-- ============================================================================
-- STEP 2: Add columns to billing_transactions
-- ============================================================================

ALTER TABLE billing_transactions
ADD COLUMN IF NOT EXISTS type transaction_type NOT NULL DEFAULT 'service_fee';

ALTER TABLE billing_transactions
ADD COLUMN IF NOT EXISTS linked_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Create index for linked project lookups
CREATE INDEX IF NOT EXISTS idx_billing_transactions_linked_project_id
ON billing_transactions(linked_project_id);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_type
ON billing_transactions(type);

COMMENT ON COLUMN billing_transactions.type IS 'Classification: revenue_milestone, service_fee, subscription, license, reimbursement.';
COMMENT ON COLUMN billing_transactions.linked_project_id IS 'Optional link to a project (only valid for revenue_milestone type).';

-- ============================================================================
-- STEP 3: Create constraint validation trigger for transactions
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_transaction_constraints()
RETURNS TRIGGER AS $$
DECLARE
    v_project_company_id UUID;
    v_billing_company_id UUID;
BEGIN
    -- Rule 1: Only revenue_milestone can have linked_project_id
    IF NEW.type != 'revenue_milestone' AND NEW.linked_project_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only revenue_milestone transactions can have a linked project. Type "%" cannot have linked_project_id.', NEW.type;
    END IF;

    -- Rule 2: If linked_project_id is set, project must belong to same company as billing
    IF NEW.linked_project_id IS NOT NULL THEN
        -- Get the billing's company
        SELECT company_id INTO v_billing_company_id
        FROM billings
        WHERE id = NEW.billing_id;

        -- Get the project's company
        SELECT company_id INTO v_project_company_id
        FROM projects
        WHERE id = NEW.linked_project_id;

        IF v_project_company_id IS NULL THEN
            RAISE EXCEPTION 'Linked project % not found.', NEW.linked_project_id;
        END IF;

        IF v_project_company_id != v_billing_company_id THEN
            RAISE EXCEPTION 'Linked project must belong to the same company as the billing. Project company: %, Billing company: %',
                v_project_company_id, v_billing_company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_transaction_constraints ON billing_transactions;
CREATE TRIGGER trg_validate_transaction_constraints
    BEFORE INSERT OR UPDATE ON billing_transactions
    FOR EACH ROW
    EXECUTE FUNCTION validate_transaction_constraints();

-- ============================================================================
-- STEP 4: Update create_billing_transaction RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS create_billing_transaction(UUID, DATE, BIGINT, TEXT);

CREATE OR REPLACE FUNCTION create_billing_transaction(
    p_billing_id UUID,
    p_transaction_month DATE,
    p_amount_cents BIGINT,
    p_description TEXT,
    p_type transaction_type DEFAULT 'service_fee',
    p_linked_project_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO billing_transactions (billing_id, transaction_month, amount_cents, description, type, linked_project_id)
    VALUES (p_billing_id, p_transaction_month, p_amount_cents, p_description, p_type, p_linked_project_id)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_billing_transaction IS 'Create a new transaction under a billing. Amount in cents.';

-- ============================================================================
-- STEP 5: Update update_billing_transaction RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS update_billing_transaction(UUID, DATE, BIGINT, TEXT);

CREATE OR REPLACE FUNCTION update_billing_transaction(
    p_id UUID,
    p_transaction_month DATE DEFAULT NULL,
    p_amount_cents BIGINT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_type transaction_type DEFAULT NULL,
    p_linked_project_id UUID DEFAULT NULL,
    p_clear_linked_project BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE billing_transactions
    SET
        transaction_month = COALESCE(p_transaction_month, transaction_month),
        amount_cents = COALESCE(p_amount_cents, amount_cents),
        description = COALESCE(p_description, description),
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

COMMENT ON FUNCTION update_billing_transaction IS 'Update an existing transaction. Amount in cents.';

-- ============================================================================
-- STEP 6: Update get_billings_with_transactions RPC function
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
    transaction_id UUID,
    transaction_month DATE,
    amount_cents BIGINT,
    transaction_description TEXT,
    transaction_type transaction_type,
    linked_project_id UUID,
    linked_project_name TEXT
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
        bt.description AS transaction_description,
        bt.type AS transaction_type,
        bt.linked_project_id,
        p.project_name AS linked_project_name
    FROM billings b
    JOIN companies c ON c.id = b.company_id
    LEFT JOIN billing_transactions bt ON bt.billing_id = b.id
        AND bt.transaction_month >= date_trunc('month', p_start_month)::DATE
        AND bt.transaction_month <= date_trunc('month', p_end_month)::DATE
    LEFT JOIN projects p ON p.id = bt.linked_project_id
    ORDER BY
        COALESCE(c.display_name, c.client_name),
        b.name,
        bt.transaction_month DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_billings_with_transactions IS
    'Fetch all billings with their transactions within a date range. Groups by company.';

-- ============================================================================
-- STEP 7: Re-grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION create_billing_transaction(UUID, DATE, BIGINT, TEXT, transaction_type, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing_transaction(UUID, DATE, BIGINT, TEXT, transaction_type, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION get_billings_with_transactions(DATE, DATE) TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '038 Add Transaction Type migration complete:';
    RAISE NOTICE '  - Created transaction_type enum';
    RAISE NOTICE '  - Added type and linked_project_id columns to billing_transactions';
    RAISE NOTICE '  - Added constraint validation trigger';
    RAISE NOTICE '  - Updated RPC functions';
END $$;

COMMIT;
