-- ============================================================================
-- Migration 131: Workbook-native taxonomy (Task 9)
-- ============================================================================
-- USER DIRECTIVE (verbatim): "can you categorize the transactions in the same
-- exact categories I use in the excel spreadsheets instead of making up new
-- ones?" This replaces the engineered 15+2 category set with the user's OWN
-- workbook tab names (the human-curated AP workbooks, 5 files, 2024-2025) plus
-- Owner Payments elevated to first-class (shipped in migration 130).
--
-- CONFIG ONLY — never writes public.expenses. Standing rules upheld
-- (manifest-expenses-fix-rules-not-data, manifest-expenses-past-classifications-
-- are-authority). Prod expenses is at 0 rows (deliberate reset; the user is
-- holding their re-upload until this ships), so the full category swap is
-- FK-safe. A guard (§5) ABORTS the whole migration if any expense still
-- references a legacy category, so a mis-timed apply can never orphan an FK.
--
-- ENGINE UNCHANGED: categorize.ts (both byte-identical copies) is NOT touched.
-- The fallback constant FALLBACK_CATEGORY_ID = 15 is preserved by DESIGN — we
-- KEEP category id 15 as the technical fallback (renamed sort only), so the
-- engine keeps returning a valid id for rule-miss rows with zero code change.
-- There is no workbook-native name for "uncategorized", so 15 'Miscellaneous'
-- (is_fallback=true) remains the fallback bucket (needs_review) — documented.
--
-- TAXONOMY (ids 20-31 fresh; 15 kept as fallback; legacy 1-14,16,17 removed):
--   sort_order follows the dominant workbook tab order (4/5 workbooks agree;
--   APAprJun2024 orders Taggable after the project tabs — dominant order used).
--   overhead_type is NULL for every tab: the workbook tab taxonomy does not
--   carry the Fixed/Variable overhead dimension (that was an artifact of the
--   old 15-set). >> FLAG for Task 6/7: the Fixed/Variable overhead split is now
--   orthogonal to categories and must be re-derived separately if reporting
--   still needs it.
--
-- RULE RETARGET — old category -> workbook tab. Where the curated workbooks
-- carry direct vendor->tab evidence it beats double-mapping (per-vendor
-- overrides in §2b/§3b); otherwise the category-level default below applies.
-- Mapping + evidence (curated-tab hit counts where available):
--   1  Payroll                    -> 23 Employees            (kw ЗАПЛАТА/SALARY 539->Employees)
--   2  Payroll Taxes              -> 22 Taxes and Fees        (НАП statutory; user-confirmed)
--   3  Software & AI Tools        -> 24 Office                (vendor 194 + kw 261 -> Office)
--   4  Bank & Transfer Fees       -> 22 Taxes and Fees        (kw 59 -> Taxes and Fees)
--   5  Vehicle & Mobility         -> 24 Office                (vendor 11 -> Office)
--   6  Office Supplies & Food     -> 24 Office                (31 -> Office)
--   7  Contractors & Agency Fees  -> 20 Business Expenses     (kw 30 -> Business Expenses)  [FLAG: some may be Production Contractors]
--   8  Employee Benefits          -> 23 Employees            (Multisport 17 -> Employees; user-confirmed)
--   9  Office Operations          -> 24 Office                (42 -> Office)
--   10 Utilities & Facilities     -> 24 Office                (Elektrohold -> Office)        [FLAG: thin evidence]
--   11 Telecom & Internet         -> 24 Office                (A1 21 -> Office)
--   12 Treasury & Wallet Transfers-> 20 Business Expenses     [FLAG: no workbook tab; internal Wise/UniCredit transfers — user may exclude]
--   13 Accounting & Compliance    -> 22 Taxes and Fees        [FLAG: could be Business Expenses]
--   14 Debt Service               -> 22 Taxes and Fees        [FLAG: loan interest/fees; evidence contaminated by salary transfers]
--   16 Advertising & Marketing    -> 21 Marketing and Client  (FACEBK etc.; user-confirmed)
--   17 Owner Payments             -> 31 Owner Payments        (elevated; migration 130)
--   15 Miscellaneous              -> 15 (kept, fallback)
-- Per-vendor/keyword overrides to PROJECT tabs (strong, exclusive curated
-- evidence — the user files these tools under a project, not generic Office):
--   DROPBOX* -> 25 Taggable (54);  TAGGABLE PHOTOS/WWW.TWILIO.COM/TWILIO -> 25 Taggable;
--   SUPERHOSTING.BG -> 25 Taggable (19);  EMAILOCTOPUS -> 28 Auxmedica (30).
-- >> FLAG: no rule auto-routes to Project Expenses(26), Production Contractors(27),
--    Office Purchase and Buildout(29), BAKr(30) — historically these tabs were
--    hand-sorted by the user; they exist for manual assignment. Auxmedica(28)
--    receives only EmailOctopus automatically.
--
-- Idempotent: bulk UPDATEs key off legacy ids (no-ops once migrated); overrides
-- key off pattern; category INSERT ON CONFLICT DO NOTHING; guarded DELETE.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. GUARD (fail-closed, runs FIRST). Abort cleanly if any expense still
--    references a legacy category, BEFORE touching categories/rules — so a
--    mis-timed apply on populated data yields this clear message instead of a
--    confusing downstream unique-constraint / FK error. (Prod currently has
--    812 expenses referencing the legacy 15+2, so 131 fails closed here until
--    the coordinator resets the uploads.)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    legacy_ids int[] := ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17];
    orphaned   int;
BEGIN
    SELECT count(*) INTO orphaned
      FROM public.expenses
     WHERE category_id = ANY(legacy_ids);
    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'Migration 131 aborted: % expenses row(s) still reference legacy categories % — reset uploads before applying 131.',
            orphaned, legacy_ids;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 0b. RENAME legacy names OUT OF THE WAY (ordering fix for the name-unique
--     constraint). The new taxonomy reuses the name 'Owner Payments' (and,
--     defensively, we free every legacy name), which collides with the still-
--     present migration-130 rows on expense_categories_name_key. These rows are
--     deleted in step 5; the rename is a transient in-transaction step. No-op on
--     re-apply (legacy rows already removed). ON CONFLICT (id) on the insert
--     handles id reuse; this handles NAME reuse.
-- ----------------------------------------------------------------------------
UPDATE public.expense_categories
   SET name = name || ' (legacy 15+2)'
 WHERE id IN (1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17)
   AND name NOT LIKE '% (legacy 15+2)';

-- ----------------------------------------------------------------------------
-- 1. Workbook-native categories (exact tab spelling, verified consistent across
--    all 5 workbooks). overhead_type NULL (see header). Keep 15 as fallback.
-- ----------------------------------------------------------------------------
INSERT INTO public.expense_categories (id, name, overhead_type, sort_order, is_fallback)
VALUES
    (20, 'Business Expenses',            NULL,  1, FALSE),
    (21, 'Marketing and Client',         NULL,  2, FALSE),
    (22, 'Taxes and Fees',               NULL,  3, FALSE),
    (23, 'Employees',                    NULL,  4, FALSE),
    (24, 'Office',                       NULL,  5, FALSE),
    (25, 'Taggable',                     NULL,  6, FALSE),
    (26, 'Project Expenses',             NULL,  7, FALSE),
    (27, 'Production Contractors',       NULL,  8, FALSE),
    (28, 'Auxmedica',                    NULL,  9, FALSE),
    (29, 'Office Purchase and Buildout', NULL, 10, FALSE),
    (30, 'BAKr',                         NULL, 11, FALSE),
    (31, 'Owner Payments',               NULL, 12, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Keep 15 'Miscellaneous' as the technical fallback; sort it after the tabs.
UPDATE public.expense_categories SET sort_order = 99 WHERE id = 15;

-- ----------------------------------------------------------------------------
-- 2. VENDOR rules — bulk retarget legacy category -> workbook tab.
-- ----------------------------------------------------------------------------
UPDATE public.expense_vendor_rules SET category_id = 23 WHERE category_id = 1;   -- Payroll -> Employees
UPDATE public.expense_vendor_rules SET category_id = 22 WHERE category_id = 2;   -- Payroll Taxes -> Taxes and Fees
UPDATE public.expense_vendor_rules SET category_id = 24 WHERE category_id = 3;   -- Software & AI -> Office
UPDATE public.expense_vendor_rules SET category_id = 22 WHERE category_id = 4;   -- Bank & Transfer Fees -> Taxes and Fees
UPDATE public.expense_vendor_rules SET category_id = 24 WHERE category_id = 5;   -- Vehicle & Mobility -> Office
UPDATE public.expense_vendor_rules SET category_id = 24 WHERE category_id = 6;   -- Office Supplies & Food -> Office
UPDATE public.expense_vendor_rules SET category_id = 20 WHERE category_id = 7;   -- Contractors & Agency -> Business Expenses
UPDATE public.expense_vendor_rules SET category_id = 23 WHERE category_id = 8;   -- Employee Benefits -> Employees
UPDATE public.expense_vendor_rules SET category_id = 24 WHERE category_id = 9;   -- Office Operations -> Office
UPDATE public.expense_vendor_rules SET category_id = 24 WHERE category_id = 10;  -- Utilities & Facilities -> Office
UPDATE public.expense_vendor_rules SET category_id = 24 WHERE category_id = 11;  -- Telecom & Internet -> Office
UPDATE public.expense_vendor_rules SET category_id = 20 WHERE category_id = 12;  -- Treasury & Wallet -> Business Expenses
UPDATE public.expense_vendor_rules SET category_id = 22 WHERE category_id = 13;  -- Accounting & Compliance -> Taxes and Fees
UPDATE public.expense_vendor_rules SET category_id = 22 WHERE category_id = 14;  -- Debt Service -> Taxes and Fees
UPDATE public.expense_vendor_rules SET category_id = 21 WHERE category_id = 16;  -- Advertising & Marketing -> Marketing and Client
UPDATE public.expense_vendor_rules SET category_id = 31 WHERE category_id = 17;  -- Owner Payments -> Owner Payments

-- 2b. Per-vendor overrides to project tabs (direct curated workbook evidence).
UPDATE public.expense_vendor_rules SET category_id = 25 WHERE pattern ILIKE 'DROPBOX%';                                   -- Taggable
UPDATE public.expense_vendor_rules SET category_id = 25 WHERE pattern IN ('TAGGABLE PHOTOS', 'WWW.TWILIO.COM', 'SUPERHOSTING.BG BGN'); -- Taggable
UPDATE public.expense_vendor_rules SET category_id = 28 WHERE pattern = 'EMAILOCTOPUS';                                    -- Auxmedica

-- 2c. НАП SHORT-FORM vendor rule (auditor-required; gates the re-upload). The
--     real bank export writes НАП in a short beneficiary form the exact rules
--     miss: 'НАП - Данъци (…)', 'НАП - Вноски за държавно обществено осигуряване',
--     'НАП - Вноски за здравно осигуряване', 'НАП - Вноски за допълнително
--     задължително…'. Without this, 15 rows on the 812-row upload misfile to
--     Miscellaneous. The 'НАП -' prefix (space-dash) is distinctive: verified
--     against the real file (matches exactly those 15 rows; every other category
--     unchanged) and the corpus (no bare-НАП substring over-match). Priority 100,
--     consistent with the other Cyrillic НАП vendor rules. Idempotent upsert.
INSERT INTO public.expense_vendor_rules (match_type, pattern, category_id, priority, source, hits_in_reference)
VALUES ('contains', 'НАП -', 22, 100, 'raw_cyrillic', 15)
ON CONFLICT (match_type, pattern) DO UPDATE
    SET category_id = EXCLUDED.category_id,
        priority    = EXCLUDED.priority;

-- ----------------------------------------------------------------------------
-- 3. KEYWORD rules — same mapping (persists ALL user-instructed rules, re-homed:
--    owner->Owner Payments, FACEBK->Marketing and Client, interbank/SEPA/
--    recurring fees + НАП + corporate profit tax->Taxes and Fees, office coffee
--    ->Office, salary->Employees).
-- ----------------------------------------------------------------------------
UPDATE public.expense_keyword_rules SET category_id = 23 WHERE category_id = 1;
UPDATE public.expense_keyword_rules SET category_id = 22 WHERE category_id = 2;
UPDATE public.expense_keyword_rules SET category_id = 24 WHERE category_id = 3;
UPDATE public.expense_keyword_rules SET category_id = 22 WHERE category_id = 4;
UPDATE public.expense_keyword_rules SET category_id = 24 WHERE category_id = 5;
UPDATE public.expense_keyword_rules SET category_id = 24 WHERE category_id = 6;
UPDATE public.expense_keyword_rules SET category_id = 20 WHERE category_id = 7;
UPDATE public.expense_keyword_rules SET category_id = 23 WHERE category_id = 8;
UPDATE public.expense_keyword_rules SET category_id = 24 WHERE category_id = 9;
UPDATE public.expense_keyword_rules SET category_id = 24 WHERE category_id = 10;
UPDATE public.expense_keyword_rules SET category_id = 24 WHERE category_id = 11;
UPDATE public.expense_keyword_rules SET category_id = 20 WHERE category_id = 12;
UPDATE public.expense_keyword_rules SET category_id = 22 WHERE category_id = 13;
UPDATE public.expense_keyword_rules SET category_id = 22 WHERE category_id = 14;
UPDATE public.expense_keyword_rules SET category_id = 21 WHERE category_id = 16;
UPDATE public.expense_keyword_rules SET category_id = 31 WHERE category_id = 17;

-- 3b. Keyword project overrides (match the vendor treatment for the same tools).
UPDATE public.expense_keyword_rules SET category_id = 25
    WHERE keyword ILIKE 'DROPBOX%' OR keyword IN ('TAGGABLE PHOTOS', 'WWW.TWILIO.COM', 'TWILIO', 'SUPERHOSTING.BG BGN');
UPDATE public.expense_keyword_rules SET category_id = 28 WHERE keyword = 'EMAILOCTOPUS';

-- ----------------------------------------------------------------------------
-- 5. Remove the legacy 15+2 (minus the kept fallback 15). Safe here: expenses
--    were guaranteed free of legacy refs in step 0, and every vendor/keyword
--    rule was retargeted off the legacy ids in steps 2-4, so these rows are now
--    unreferenced. This also clears the transiently-renamed '(legacy 15+2)' rows
--    from step 0b. Idempotent: matches nothing on re-apply.
-- ----------------------------------------------------------------------------
DELETE FROM public.expense_categories
 WHERE id IN (1,2,3,4,5,6,7,8,9,10,11,12,13,14,16,17);

COMMIT;
