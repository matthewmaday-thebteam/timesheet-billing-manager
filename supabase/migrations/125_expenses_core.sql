-- ============================================================================
-- Migration 125: Expenses Domain — Core Tables (source files, categories, expenses)
-- ============================================================================
-- Purpose: Foundation for the approved "Expenses" domain. Stores parsed bank
-- expense exports, a fixed category taxonomy, and the normalized expense ledger.
-- This migration is ADDITIVE and independent of the billing/revenue tables.
--
-- Mirrors existing precedent:
--   - migration 062 / 120  (admin-only write RLS via is_admin(), authenticated SELECT)
--   - migration 010        (is_admin() helper)
--   - migration 053 / 120  (REVOKE ALL ... FROM anon)
--   - update_updated_at_column() shared trigger function (009/014/067)
--
-- APPLICATION NOTE: This project does NOT use `supabase db push`. This file is
-- applied via the Supabase Management API. It is written to be fully idempotent
-- (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE /
-- ON CONFLICT DO NOTHING).
--
-- RLS: ENABLE + FORCE on every table. SELECT for authenticated; INSERT/UPDATE/
-- DELETE only where is_admin(). anon has no access. These tables are NOT added
-- to migration 112's public-select grant list, nor to any investor RPC/view.
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE 1: expense_source_files — one row per ingested bank export file
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expense_source_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name       TEXT NOT NULL,
    file_sha256     TEXT NOT NULL UNIQUE,
    byte_size       INTEGER,
    source_format   TEXT CHECK (source_format IN ('html_xls', 'binary_xls', 'xlsx')),
    row_count       INTEGER,                    -- total rows parsed from the file
    inserted_count  INTEGER,                    -- rows newly inserted this upload
    duplicate_count INTEGER,                    -- rows skipped as already-ingested duplicates
    rejected_count  INTEGER,                    -- rows rejected (e.g. unresolved currency); TRUE total
    rejected_rows   JSONB,                      -- summary of rejected rows: array of
                                                --   {reference, value_date, amount, reason},
                                                --   capped to the first 200 (count carries the total)
    detected_account TEXT,
    observed_from   DATE,
    observed_to     DATE,
    uploaded_by     UUID DEFAULT auth.uid(),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT NOT NULL DEFAULT 'parsed'
                        CHECK (status IN ('parsed', 'processed', 'processed_with_rejections', 'failed'))
);

COMMENT ON TABLE public.expense_source_files IS
    'One row per ingested bank expense export. file_sha256 is unique to make '
    're-upload of an identical file idempotent. row_count/inserted_count/'
    'duplicate_count/rejected_count record "N rows in file, X newly inserted, '
    'Y skipped as already-ingested duplicates, Z rejected" so overlapping exports '
    '(YTD backfill then re-covering exports) are provably deduplicated. '
    'rejected != lost: every non-inserted row is durably counted (rejected_count '
    'is the true total) and summarized in rejected_rows (array of {reference, '
    'value_date, amount, reason}, capped to the first 200 entries). status '
    '''processed_with_rejections'' marks a file that ingested with rejected rows. '
    'Admin-only writes (mirrors 062).';

-- ============================================================================
-- TABLE 2: expense_categories — fixed taxonomy (ids are NOT generated)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expense_categories (
    id            SMALLINT PRIMARY KEY,        -- fixed ids, never auto-generated
    name          TEXT NOT NULL UNIQUE,
    overhead_type TEXT CHECK (overhead_type IN ('Fixed', 'Variable')),  -- nullable
    sort_order    INTEGER NOT NULL,
    is_fallback   BOOLEAN NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE public.expense_categories IS
    'Fixed expense category taxonomy (ids 1-15, hard-coded — do not auto-generate). '
    'overhead_type is the dominant Fixed/Variable classification mined from the '
    'reference exports; NULL where mixed (<90%) or for the fallback bucket.';

-- Seed the frozen 15 categories with FIXED ids. sort_order = id.
-- overhead_type derived from report(3) Overhead Type column (dominant, >=90%);
-- Vehicle & Mobility is 88% Fixed -> NULL (mixed); Miscellaneous is the fallback
-- catch-all -> NULL (never assert an overhead type on a mixed bucket).
INSERT INTO public.expense_categories (id, name, overhead_type, sort_order, is_fallback)
VALUES
    (1,  'Payroll',                     'Fixed',    1,  FALSE),
    (2,  'Payroll Taxes',              'Fixed',    2,  FALSE),
    (3,  'Software & AI Tools',        'Fixed',    3,  FALSE),
    (4,  'Bank & Transfer Fees',       'Variable', 4,  FALSE),
    (5,  'Vehicle & Mobility',          NULL,       5,  FALSE),
    (6,  'Office Supplies & Food',     'Variable', 6,  FALSE),
    (7,  'Contractors & Agency Fees',  'Variable', 7,  FALSE),
    (8,  'Employee Benefits',          'Fixed',    8,  FALSE),
    (9,  'Office Operations',          'Variable', 9,  FALSE),
    (10, 'Utilities & Facilities',     'Fixed',    10, FALSE),
    (11, 'Telecom & Internet',         'Fixed',    11, FALSE),
    (12, 'Treasury & Wallet Transfers','Variable', 12, FALSE),
    (13, 'Accounting & Compliance',    'Fixed',    13, FALSE),
    (14, 'Debt Service',               'Fixed',    14, FALSE),
    (15, 'Miscellaneous',               NULL,       15, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TABLE 3: expenses — normalized expense ledger (one row per bank transaction)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expenses (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file_id         UUID NOT NULL REFERENCES public.expense_source_files(id) ON DELETE CASCADE,
    row_hash               TEXT NOT NULL UNIQUE,
    account                TEXT,
    account_currency       TEXT NOT NULL CHECK (account_currency IN ('EUR', 'BGN')),
    original_amount        NUMERIC(14,2) NOT NULL,   -- bank-booked account-currency amount
    operation_currency     TEXT,                     -- informational only
    operation_amount       NUMERIC(14,2),            -- informational only
    eur_amount             NUMERIC(14,2) NOT NULL,
    conversion_rate        NUMERIC(18,8) NOT NULL,    -- 1.0 for EUR, 1.95583 for BGN (divisor)
    rate_source            TEXT NOT NULL
                               CHECK (rate_source IN ('identity', 'peg', 'ecb_monthly', 'ecb_daily', 'manual')),
    rate_date              DATE,                      -- null for identity/peg
    entry_type             TEXT CHECK (entry_type IN ('Debit', 'Credit')),
    description_original   TEXT,
    description_translated TEXT,
    translation_source     TEXT CHECK (translation_source IN ('dictionary', 'passthrough', 'manual', 'ai', 'none')),
    vendor                 TEXT,
    beneficiary            TEXT,
    reference              TEXT,
    category_id            SMALLINT NOT NULL DEFAULT 15 REFERENCES public.expense_categories(id),
    category_source        TEXT CHECK (category_source IN ('vendor_rule', 'keyword_rule', 'manual', 'fallback')),
    value_date             DATE NOT NULL,
    booking_date           DATE,
    txn_datetime           TIMESTAMPTZ,
    assigned_month         TEXT NOT NULL CHECK (assigned_month ~ '^\d{4}-\d{2}$'),  -- derived from value_date
    needs_review           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by             UUID DEFAULT auth.uid()
);

COMMENT ON TABLE public.expenses IS
    'Normalized expense ledger. row_hash is unique to make re-ingestion of the '
    'same transaction idempotent. eur_amount = original_amount / conversion_rate '
    '(BGN pegged at 1.95583). assigned_month (YYYY-MM) is derived from value_date. '
    'Admin-only writes (mirrors 062); never referenced by billing/revenue paths.';

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_expenses_assigned_month  ON public.expenses (assigned_month);
CREATE INDEX IF NOT EXISTS idx_expenses_category_id      ON public.expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_source_file_id   ON public.expenses (source_file_id);
CREATE INDEX IF NOT EXISTS idx_expenses_needs_review     ON public.expenses (needs_review) WHERE needs_review;

-- ============================================================================
-- UPDATED_AT TRIGGER (reuses existing update_updated_at_column)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
    BEFORE UPDATE ON public.expenses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY — ENABLE + FORCE on every table (mirrors 062/120 policies)
-- ============================================================================

-- ---- expense_source_files --------------------------------------------------
ALTER TABLE public.expense_source_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_source_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read expense source files" ON public.expense_source_files;
CREATE POLICY "Allow authenticated read expense source files"
    ON public.expense_source_files FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Allow admin insert expense source files" ON public.expense_source_files;
CREATE POLICY "Allow admin insert expense source files"
    ON public.expense_source_files FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update expense source files" ON public.expense_source_files;
CREATE POLICY "Allow admin update expense source files"
    ON public.expense_source_files FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete expense source files" ON public.expense_source_files;
CREATE POLICY "Allow admin delete expense source files"
    ON public.expense_source_files FOR DELETE
    TO authenticated
    USING (is_admin());

-- ---- expense_categories ----------------------------------------------------
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read expense categories" ON public.expense_categories;
CREATE POLICY "Allow authenticated read expense categories"
    ON public.expense_categories FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Allow admin insert expense categories" ON public.expense_categories;
CREATE POLICY "Allow admin insert expense categories"
    ON public.expense_categories FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update expense categories" ON public.expense_categories;
CREATE POLICY "Allow admin update expense categories"
    ON public.expense_categories FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete expense categories" ON public.expense_categories;
CREATE POLICY "Allow admin delete expense categories"
    ON public.expense_categories FOR DELETE
    TO authenticated
    USING (is_admin());

-- ---- expenses --------------------------------------------------------------
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read expenses" ON public.expenses;
CREATE POLICY "Allow authenticated read expenses"
    ON public.expenses FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Allow admin insert expenses" ON public.expenses;
CREATE POLICY "Allow admin insert expenses"
    ON public.expenses FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update expenses" ON public.expenses;
CREATE POLICY "Allow admin update expenses"
    ON public.expenses FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete expenses" ON public.expenses;
CREATE POLICY "Allow admin delete expenses"
    ON public.expenses FOR DELETE
    TO authenticated
    USING (is_admin());

-- ============================================================================
-- GRANTS (mirrors migration 120: broad table grant, RLS narrows; anon revoked)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_source_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_categories    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses              TO authenticated;

GRANT ALL ON public.expense_source_files TO service_role;
GRANT ALL ON public.expense_categories    TO service_role;
GRANT ALL ON public.expenses              TO service_role;

REVOKE ALL ON public.expense_source_files FROM anon;
REVOKE ALL ON public.expense_categories    FROM anon;
REVOKE ALL ON public.expenses              FROM anon;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_categories INTEGER;
    v_policies   INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_categories FROM public.expense_categories;
    SELECT COUNT(*) INTO v_policies
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('expense_source_files', 'expense_categories', 'expenses');

    RAISE NOTICE 'Migration 125 Complete:';
    RAISE NOTICE '  - expense_source_files / expense_categories / expenses created';
    RAISE NOTICE '  - seeded categories: % (expected 15)', v_categories;
    RAISE NOTICE '  - RLS policies across 3 tables: % (expected 12)', v_policies;
    RAISE NOTICE '  - RLS ENABLE + FORCE applied; anon revoked';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (run manually if needed — NOT executed by this migration)
-- ============================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.expenses;
--   DROP TABLE IF EXISTS public.expense_categories;
--   DROP TABLE IF EXISTS public.expense_source_files;
-- COMMIT;
-- ============================================================================
