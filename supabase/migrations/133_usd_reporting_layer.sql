-- ============================================================================
-- Migration 133: USD Reporting Layer (month-dependent EUR→USD)
-- ============================================================================
-- Purpose: Manifest's reporting currency is USD, not EUR. EUR remains the exact
-- bank-truth NORMALIZATION layer (untouched by this migration). This ADDS a USD
-- REPORTING layer on top:
--   1. expense_fx_rates — one authoritative EUR→USD rate per 'YYYY-MM' month,
--      because the books apply the ECB monthly-average rate for the transaction's
--      month (a partial-month daily average for the current, unpublished month).
--   2. expenses.usd_amount / usd_rate / usd_rate_source — the per-row USD value
--      stored AT INGEST for auditability. All THREE are NULLABLE: a row whose
--      month has no known rate ingests with USD "pending" (never blocks ingest,
--      same graceful-degradation contract as translation).
--   3. fill_pending_usd() — set-based, self-healing backfill: once a month's rate
--      becomes known, any pending rows for that month are completed on the next
--      ingest run. usd_amount = round(eur_amount * eur_usd, 2), matching the
--      JS convertToUsd (round2, half away from zero) used for freshly-ingested
--      rows. Each row is computed exactly once (fill only touches usd_amount IS
--      NULL), so the two paths never disagree on a row.
--
-- Mirrors existing precedent:
--   - migration 125 (expenses core: is_admin() write RLS, authenticated SELECT,
--     ENABLE + FORCE RLS, anon revoked, service_role GRANT ALL).
--   - update_updated_at_column() shared trigger already on public.expenses.
--
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Fully idempotent (IF NOT EXISTS / guarded constraint /
-- CREATE OR REPLACE / ON CONFLICT DO NOTHING). Category-AGNOSTIC by construction:
-- rates key on month only, so the parallel taxonomy amendments do not touch it.
--
-- SEED PROVENANCE (precedent-authority — the rates the books actually used):
--   Mined from the FX_Rates + Notes sheets of the reference reports at
--   /The B Team/Financials/2025-AP/report(1|2|3)_english.xlsx. "Eur To Usd" is
--   USD per 1 EUR (ECB SP00). report(2)/report(3) agree on all 2025 months;
--   report(1) supplies 2026-01..03. Cross-checked live against the ECB monthly
--   series (M.USD.EUR.SP00.A): 2025-01..2026-02 match to 6dp.
--   ** 2026-03 = 1.161363 is a PARTIAL-MONTH ECB daily average (2026-03-02..
--      2026-03-11) per report(1)'s Notes, used because the monthly aggregate was
--      not yet published. It is seeded as 'workbook_seed' (precedent-authority)
--      and DELIBERATELY overrides the now-published ECB monthly value (~1.155832)
--      to keep the books consistent. Flagged for the audit gate. **
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE: expense_fx_rates — one EUR→USD reporting rate per month
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.expense_fx_rates (
    month       TEXT PRIMARY KEY CHECK (month ~ '^\d{4}-\d{2}$'),  -- 'YYYY-MM'
    eur_usd     NUMERIC(18,8) NOT NULL CHECK (eur_usd > 0),        -- USD per 1 EUR
    source      TEXT NOT NULL
                    CHECK (source IN ('workbook_seed', 'ecb_monthly', 'ecb_daily_avg', 'manual')),
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.expense_fx_rates IS
    'Month-dependent EUR->USD reporting rates (USD per 1 EUR, ECB SP00 convention). '
    'One row per YYYY-MM. usd_amount = round(eur_amount * eur_usd, 2). '
    'source: workbook_seed = mined from the historical books (precedent-authority '
    'for its month, overrides later revisions); ecb_monthly = ECB monthly EXR '
    'series fetched at ingest; ecb_daily_avg = partial-month ECB daily average for '
    'the current, not-yet-published month; manual = operator override. Seeds are '
    'protected: ingest inserts fetched months ON CONFLICT (month) DO NOTHING.';

COMMENT ON COLUMN public.expense_fx_rates.eur_usd IS
    'USD per 1 EUR (ECB M.USD.EUR.SP00.A). BGN needs no separate rate: USD derives '
    'from the already peg-normalized eur_amount.';

-- ---- Seed: precedent-authority rates (2025-01 .. 2026-03) ------------------
-- 2025-01..2025-12: report(2)/report(3) FX_Rates (identical). 2026-01..2026-03:
-- report(1) FX_Rates. 2026-03 is the documented partial-month daily average.
INSERT INTO public.expense_fx_rates (month, eur_usd, source) VALUES
    ('2025-01', 1.03537300, 'workbook_seed'),
    ('2025-02', 1.04125000, 'workbook_seed'),
    ('2025-03', 1.08068100, 'workbook_seed'),
    ('2025-04', 1.12139500, 'workbook_seed'),
    ('2025-05', 1.12780500, 'workbook_seed'),
    ('2025-06', 1.15161900, 'workbook_seed'),
    ('2025-07', 1.16768700, 'workbook_seed'),
    ('2025-08', 1.16314300, 'workbook_seed'),
    ('2025-09', 1.17322300, 'workbook_seed'),
    ('2025-10', 1.16304300, 'workbook_seed'),
    ('2025-11', 1.15602000, 'workbook_seed'),
    ('2025-12', 1.17087100, 'workbook_seed'),
    ('2026-01', 1.17382400, 'workbook_seed'),
    ('2026-02', 1.18239500, 'workbook_seed'),
    ('2026-03', 1.16136300, 'workbook_seed')   -- partial-month daily avg (see header)
ON CONFLICT (month) DO NOTHING;

-- ============================================================================
-- ALTER expenses: additive USD reporting columns (all NULLABLE — pending allowed)
-- ============================================================================

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS usd_amount      NUMERIC(14,2);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS usd_rate        NUMERIC(18,8);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS usd_rate_source TEXT;

-- Guarded CHECK (idempotent: only added once).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'expenses_usd_rate_source_check'
    ) THEN
        ALTER TABLE public.expenses
            ADD CONSTRAINT expenses_usd_rate_source_check
            CHECK (usd_rate_source IS NULL
                   OR usd_rate_source IN ('workbook_seed', 'ecb_monthly', 'ecb_daily_avg', 'manual'));
    END IF;
END $$;

COMMENT ON COLUMN public.expenses.usd_amount IS
    'USD REPORTING value = round(eur_amount * eur_usd, 2) using the month rate '
    '(expense_fx_rates keyed by assigned_month). NULL = pending (rate not yet '
    'known); completed later by fill_pending_usd(). Never affects EUR math.';

-- Partial index to make the self-healing pending-fill cheap.
CREATE INDEX IF NOT EXISTS idx_expenses_usd_pending
    ON public.expenses (assigned_month)
    WHERE usd_amount IS NULL;

-- ============================================================================
-- FUNCTION: fill_pending_usd() — self-healing, set-based backfill
-- ============================================================================
-- Completes every row whose month rate is now known but whose usd_amount is still
-- NULL. Cheap and idempotent (only touches pending rows). The edge function calls
-- this at the start of each ingest run. round(x, 2) is half away from zero, i.e.
-- identical to the JS round2 used for freshly-ingested rows.
CREATE OR REPLACE FUNCTION public.fill_pending_usd()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_filled integer;
BEGIN
    WITH updated AS (
        UPDATE public.expenses e
        SET usd_amount      = round(e.eur_amount * r.eur_usd, 2),
            usd_rate        = r.eur_usd,
            usd_rate_source = r.source
        FROM public.expense_fx_rates r
        WHERE e.assigned_month = r.month
          AND e.usd_amount IS NULL
        RETURNING 1
    )
    SELECT count(*) INTO v_filled FROM updated;
    RETURN v_filled;
END $$;

COMMENT ON FUNCTION public.fill_pending_usd() IS
    'Set-based self-healing backfill of expenses.usd_amount for rows whose month '
    'rate is now present in expense_fx_rates. Idempotent (only usd_amount IS NULL '
    'rows). Called by ingest-expenses at run start. service_role only.';

-- ============================================================================
-- ROW LEVEL SECURITY — expense_fx_rates (mirrors 125: authenticated SELECT,
-- admin-only writes, anon revoked)
-- ============================================================================

ALTER TABLE public.expense_fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_fx_rates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read expense fx rates" ON public.expense_fx_rates;
CREATE POLICY "Allow authenticated read expense fx rates"
    ON public.expense_fx_rates FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "Allow admin insert expense fx rates" ON public.expense_fx_rates;
CREATE POLICY "Allow admin insert expense fx rates"
    ON public.expense_fx_rates FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin update expense fx rates" ON public.expense_fx_rates;
CREATE POLICY "Allow admin update expense fx rates"
    ON public.expense_fx_rates FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Allow admin delete expense fx rates" ON public.expense_fx_rates;
CREATE POLICY "Allow admin delete expense fx rates"
    ON public.expense_fx_rates FOR DELETE
    TO authenticated
    USING (is_admin());

-- ============================================================================
-- GRANTS (mirrors 125: broad table grant, RLS narrows; anon revoked). The edge
-- function ingests fx rows via service_role (RLS-exempt).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_fx_rates TO authenticated;
GRANT ALL ON public.expense_fx_rates TO service_role;
REVOKE ALL ON public.expense_fx_rates FROM anon;

-- fill_pending_usd is an ingest-side (service_role) concern: it performs an
-- unrestricted UPDATE across expenses, so it is NOT exposed to authenticated/anon.
-- NOTE: Supabase default privileges grant EXECUTE to anon/authenticated on
-- function creation, so revoking PUBLIC alone is insufficient — revoke all three.
REVOKE ALL ON FUNCTION public.fill_pending_usd() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_pending_usd() TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_rates    INTEGER;
    v_cols     INTEGER;
    v_policies INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_rates FROM public.expense_fx_rates;
    SELECT COUNT(*) INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses'
      AND column_name IN ('usd_amount', 'usd_rate', 'usd_rate_source');
    SELECT COUNT(*) INTO v_policies
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'expense_fx_rates';

    RAISE NOTICE 'Migration 133 Complete:';
    RAISE NOTICE '  - expense_fx_rates created; seeded rates: % (expected 15)', v_rates;
    RAISE NOTICE '  - expenses USD columns present: % (expected 3)', v_cols;
    RAISE NOTICE '  - fill_pending_usd() created (service_role only)';
    RAISE NOTICE '  - expense_fx_rates RLS policies: % (expected 4)', v_policies;
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (run manually if needed — NOT executed by this migration)
-- ============================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.fill_pending_usd();
--   DROP INDEX IF EXISTS public.idx_expenses_usd_pending;
--   ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_usd_rate_source_check;
--   ALTER TABLE public.expenses DROP COLUMN IF EXISTS usd_rate_source;
--   ALTER TABLE public.expenses DROP COLUMN IF EXISTS usd_rate;
--   ALTER TABLE public.expenses DROP COLUMN IF EXISTS usd_amount;
--   DROP TABLE IF EXISTS public.expense_fx_rates;
-- COMMIT;
-- ============================================================================
