-- ============================================================================
-- Migration 040: Add client_id to get_billings_with_transactions RPC
-- ============================================================================
-- Purpose: Include client_id in the billing query result so billings can be
-- matched to companies in the Revenue table (which uses client_id for grouping).
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Update get_billings_with_transactions RPC function
-- ============================================================================

DROP FUNCTION IF EXISTS get_billings_with_transactions(DATE, DATE);

CREATE OR REPLACE FUNCTION get_billings_with_transactions(
    p_start_month DATE,
    p_end_month DATE
)
RETURNS TABLE (
    billing_id UUID,
    company_id UUID,
    company_client_id TEXT,
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
        c.client_id AS company_client_id,
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
    'Fetch all billings with their transactions within a date range. Includes client_id for Revenue page matching.';

-- ============================================================================
-- STEP 2: Re-grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_billings_with_transactions(DATE, DATE) TO authenticated;

-- ============================================================================
-- Migration complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '040 Add client_id to billings RPC migration complete:';
    RAISE NOTICE '  - Added company_client_id to get_billings_with_transactions result';
END $$;

COMMIT;
