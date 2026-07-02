-- ============================================================================
-- Migration 126: Expenses Domain — Mapping Tables (vendor rules, keyword rules,
--                translation dictionary)
-- ============================================================================
-- Purpose: Lookup tables that drive automatic categorization and description
-- translation during expense ingestion. These are structure-only; the data is
-- seeded (idempotently) by the generated migration 127_expense_mapping_seed.sql.
--
-- Mirrors the same precedent as migration 125:
--   - migration 062 / 120  (admin-only write RLS via is_admin(), authenticated SELECT)
--   - migration 053 / 120  (REVOKE ALL ... FROM anon)
--
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Fully idempotent.
--
-- RLS: ENABLE + FORCE on every table. SELECT for authenticated; INSERT/UPDATE/
-- DELETE only where is_admin(). anon has no access.
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE 1: expense_vendor_rules — Vendor pattern -> Category
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expense_vendor_rules (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    match_type        TEXT NOT NULL CHECK (match_type IN ('exact', 'contains')),
    pattern           TEXT NOT NULL,
    category_id       SMALLINT NOT NULL REFERENCES public.expense_categories(id),
    priority          INTEGER NOT NULL DEFAULT 100,   -- lower = evaluated first
    hits_in_reference INTEGER,
    source            TEXT NOT NULL DEFAULT 'raw_cyrillic'
                          CHECK (source IN ('raw_cyrillic', 'romanized_en')),
    UNIQUE (match_type, pattern)
);

COMMENT ON TABLE public.expense_vendor_rules IS
    'Vendor -> Category rules for ingest-time categorization. Matching is '
    'case-insensitive. priority ascending (lower evaluated first). source records '
    'provenance: ''raw_cyrillic'' = mined from the raw bank Бенефициент field '
    '(priority 100, what ingest matches on today); ''romanized_en'' = mined from '
    'the enriched english Vendor field (priority 200, kept for future pre-romanized '
    'xlsx uploads). Seeded by migration 127 (majority category per vendor).';

-- ============================================================================
-- TABLE 2: expense_keyword_rules — description keyword -> Category (fallback)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expense_keyword_rules (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    keyword           TEXT NOT NULL,   -- matched case-insensitively as a substring of the description
    category_id       SMALLINT NOT NULL REFERENCES public.expense_categories(id),
    priority          INTEGER NOT NULL DEFAULT 100,
    hits_in_reference INTEGER,
    force_review      BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (keyword)
);

COMMENT ON TABLE public.expense_keyword_rules IS
    'Description-keyword fallback rules, used when no vendor rule matches (~45% '
    'of reference rows have Unknown Vendor). Curated, high-confidence keywords '
    'only (each backed by >=3 consistent reference rows). force_review = TRUE '
    'marks a keyword whose matches must be flagged for human review at ingest '
    '(e.g. broad bank-name substrings like ''UNICREDIT BULBANK'' that map to Debt '
    'Service but could misfile unrelated mentions); the rule still applies, but '
    'ingest sets needs_review on its matches. Seeded by migration 127.';

-- ============================================================================
-- TABLE 3: expense_translation_dict — normalized Cyrillic description -> form
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expense_translation_dict (
    normalized_key text PRIMARY KEY,
    bg_sample      text,
    en_translation text NOT NULL,
    occurrences    integer,
    source         text NOT NULL DEFAULT 'mined'
                       CHECK (source IN ('mined', 'manual', 'ai'))
);

COMMENT ON TABLE public.expense_translation_dict IS
    'Translation dictionary keyed by the shared normalizeDescription() template '
    '(NFC -> uppercase -> digit runs collapsed to ''#'' -> whitespace collapsed). '
    'en_translation is the most-frequent normalized target form. Seeded by '
    'migration 127 from row-aligned Cyrillic (processed) + romanized (english) exports.';

-- ============================================================================
-- ROW LEVEL SECURITY — ENABLE + FORCE on every table (mirrors 062/120 policies)
-- ============================================================================

-- ---- expense_vendor_rules --------------------------------------------------
ALTER TABLE public.expense_vendor_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_vendor_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read expense vendor rules" ON public.expense_vendor_rules;
CREATE POLICY "Allow authenticated read expense vendor rules"
    ON public.expense_vendor_rules FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Allow admin insert expense vendor rules" ON public.expense_vendor_rules;
CREATE POLICY "Allow admin insert expense vendor rules"
    ON public.expense_vendor_rules FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update expense vendor rules" ON public.expense_vendor_rules;
CREATE POLICY "Allow admin update expense vendor rules"
    ON public.expense_vendor_rules FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete expense vendor rules" ON public.expense_vendor_rules;
CREATE POLICY "Allow admin delete expense vendor rules"
    ON public.expense_vendor_rules FOR DELETE
    TO authenticated
    USING (is_admin());

-- ---- expense_keyword_rules -------------------------------------------------
ALTER TABLE public.expense_keyword_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_keyword_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read expense keyword rules" ON public.expense_keyword_rules;
CREATE POLICY "Allow authenticated read expense keyword rules"
    ON public.expense_keyword_rules FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Allow admin insert expense keyword rules" ON public.expense_keyword_rules;
CREATE POLICY "Allow admin insert expense keyword rules"
    ON public.expense_keyword_rules FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update expense keyword rules" ON public.expense_keyword_rules;
CREATE POLICY "Allow admin update expense keyword rules"
    ON public.expense_keyword_rules FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete expense keyword rules" ON public.expense_keyword_rules;
CREATE POLICY "Allow admin delete expense keyword rules"
    ON public.expense_keyword_rules FOR DELETE
    TO authenticated
    USING (is_admin());

-- ---- expense_translation_dict ----------------------------------------------
ALTER TABLE public.expense_translation_dict ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_translation_dict FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read expense translation dict" ON public.expense_translation_dict;
CREATE POLICY "Allow authenticated read expense translation dict"
    ON public.expense_translation_dict FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Allow admin insert expense translation dict" ON public.expense_translation_dict;
CREATE POLICY "Allow admin insert expense translation dict"
    ON public.expense_translation_dict FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update expense translation dict" ON public.expense_translation_dict;
CREATE POLICY "Allow admin update expense translation dict"
    ON public.expense_translation_dict FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete expense translation dict" ON public.expense_translation_dict;
CREATE POLICY "Allow admin delete expense translation dict"
    ON public.expense_translation_dict FOR DELETE
    TO authenticated
    USING (is_admin());

-- ============================================================================
-- GRANTS (mirrors migration 120: broad table grant, RLS narrows; anon revoked)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_vendor_rules      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_keyword_rules     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_translation_dict  TO authenticated;

GRANT ALL ON public.expense_vendor_rules     TO service_role;
GRANT ALL ON public.expense_keyword_rules    TO service_role;
GRANT ALL ON public.expense_translation_dict TO service_role;

-- NOTE: GENERATED ALWAYS AS IDENTITY columns advance their sequence internally,
-- so no explicit sequence USAGE grant is required for authenticated inserts.

REVOKE ALL ON public.expense_vendor_rules     FROM anon;
REVOKE ALL ON public.expense_keyword_rules    FROM anon;
REVOKE ALL ON public.expense_translation_dict FROM anon;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_policies INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_policies
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('expense_vendor_rules', 'expense_keyword_rules', 'expense_translation_dict');

    RAISE NOTICE 'Migration 126 Complete:';
    RAISE NOTICE '  - expense_vendor_rules / expense_keyword_rules / expense_translation_dict created';
    RAISE NOTICE '  - RLS policies across 3 tables: % (expected 12)', v_policies;
    RAISE NOTICE '  - RLS ENABLE + FORCE applied; anon revoked';
    RAISE NOTICE '  - data seeded separately by migration 127_expense_mapping_seed.sql';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (run manually if needed — NOT executed by this migration)
-- ============================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.expense_translation_dict;
--   DROP TABLE IF EXISTS public.expense_keyword_rules;
--   DROP TABLE IF EXISTS public.expense_vendor_rules;
-- COMMIT;
-- ============================================================================
