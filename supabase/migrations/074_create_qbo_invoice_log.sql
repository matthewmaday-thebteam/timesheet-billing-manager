-- ============================================================================
-- Migration 074: QuickBooks Online Invoice Log
-- ============================================================================
-- Purpose: Create a log table that tracks invoices sent to QuickBooks Online
-- from Manifest's EOM billing workflow. Each row represents one invoice for
-- a company-month, recording the QBO invoice ID, total amount, line items,
-- and delivery status.
--
-- Changes:
--   1. qbo_invoice_log table (invoice tracking metadata)
--   2. Indexes for common query patterns
--   3. Updated_at trigger (reuses existing update_updated_at_column)
--   4. RLS policies (authenticated SELECT, service_role full access)
--   5. Grants
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE qbo_invoice_log TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS qbo_invoice_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eom_report_id       UUID REFERENCES eom_reports(id) ON DELETE SET NULL,
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    report_year         INTEGER NOT NULL,
    report_month        INTEGER NOT NULL CHECK (report_month BETWEEN 1 AND 12),
    qbo_customer_id     TEXT NOT NULL,
    qbo_invoice_id      TEXT,              -- QBO's Invoice Id
    invoice_number      TEXT,              -- QBO's DocNumber
    total_amount_cents  INTEGER NOT NULL DEFAULT 0,
    line_item_count     INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'error')),
    error_message       TEXT,
    sent_at             TIMESTAMPTZ,
    sent_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_qbo_invoice_log_company_month
        UNIQUE (company_id, report_year, report_month)
);

COMMENT ON TABLE qbo_invoice_log IS
    'Tracks invoices sent to QuickBooks Online from the Manifest EOM billing '
    'workflow. One row per company-month. Records QBO invoice ID, totals, '
    'line item count, and delivery status (pending/sent/error).';

COMMENT ON COLUMN qbo_invoice_log.qbo_invoice_id IS
    'QBO Invoice.Id returned after successful creation. NULL until sent.';

COMMENT ON COLUMN qbo_invoice_log.invoice_number IS
    'QBO DocNumber (human-readable invoice number). NULL until sent.';

COMMENT ON COLUMN qbo_invoice_log.total_amount_cents IS
    'Total invoice amount in USD cents. Matches sum of line items.';

COMMENT ON COLUMN qbo_invoice_log.status IS
    'Delivery status: pending (not yet sent), sent (successfully created in QBO), '
    'error (QBO API returned an error).';

-- ============================================================================
-- STEP 2: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qbo_invoice_log_company
    ON qbo_invoice_log (company_id);

CREATE INDEX IF NOT EXISTS idx_qbo_invoice_log_year_month
    ON qbo_invoice_log (report_year, report_month);

CREATE INDEX IF NOT EXISTS idx_qbo_invoice_log_status
    ON qbo_invoice_log (status);

-- ============================================================================
-- STEP 3: UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_qbo_invoice_log_updated_at ON qbo_invoice_log;
CREATE TRIGGER trg_qbo_invoice_log_updated_at
    BEFORE UPDATE ON qbo_invoice_log
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: RLS POLICIES
-- ============================================================================

ALTER TABLE qbo_invoice_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read the invoice log (status display in UI)
DROP POLICY IF EXISTS "Authenticated read qbo_invoice_log" ON qbo_invoice_log;
CREATE POLICY "Authenticated read qbo_invoice_log"
    ON qbo_invoice_log FOR SELECT
    TO authenticated
    USING (true);

-- Service role: full access (Edge Functions handle writes)
DROP POLICY IF EXISTS "Service role full access qbo_invoice_log" ON qbo_invoice_log;
CREATE POLICY "Service role full access qbo_invoice_log"
    ON qbo_invoice_log FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 5: GRANTS
-- ============================================================================

GRANT SELECT ON qbo_invoice_log TO authenticated;
GRANT ALL ON qbo_invoice_log TO service_role;

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
        WHERE table_schema = 'public' AND table_name = 'qbo_invoice_log'
    ) INTO v_table_exists;

    -- Count policies
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE tablename = 'qbo_invoice_log';

    RAISE NOTICE 'Migration 074 Complete:';
    RAISE NOTICE '  - qbo_invoice_log table: %', CASE WHEN v_table_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - RLS policies: %', v_policy_count;
    RAISE NOTICE '  - updated_at trigger attached';
    RAISE NOTICE '  - Authenticated SELECT + service_role ALL';

    IF NOT v_table_exists THEN
        RAISE WARNING 'qbo_invoice_log table was not created!';
    END IF;
END $$;

COMMIT;
