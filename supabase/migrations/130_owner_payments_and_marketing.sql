-- ============================================================================
-- Migration 130: Owner Payments & Advertising/Marketing (Task 8)
-- ============================================================================
-- Adds two expense categories (16 Advertising & Marketing, 17 Owner Payments)
-- and the rule-table changes that route the relevant transactions to them at
-- INGEST. This migration touches CONFIG ONLY (expense_categories +
-- expense_vendor_rules + expense_keyword_rules). It never writes to
-- public.expenses — per the standing rules:
--   * manifest-expenses-fix-rules-not-data ("fix the rules, never the data")
--   * manifest-expenses-past-classifications-are-authority
-- Prod expenses is deliberately empty; the user re-uploads after ship and the
-- ingest categorizer (src/lib/expenses/categorize.ts, copied byte-identical to
-- supabase/functions/ingest-expenses/_lib/categorize.ts) must classify these
-- rows correctly from these rules alone. categorize.ts is UNCHANGED — this is
-- purely rule-driven (verified by scripts/expenses-tests/task8-owner-marketing).
--
-- Evidence base: the human-curated AP workbooks (5 files, 2024-2025). Every
-- keyword/vendor pattern below was verified against the raw bank exports
-- (description_original is Cyrillic at ingest) for exact form and over-match
-- dominance. Hit counts in comments are corpus occurrences of the pattern.
--
-- ENGINE SEMANTICS THAT SHAPE THIS DESIGN (categorize.ts, locked order):
--   1. ALL vendor rules run first, lowest `priority` wins (match on counterparty
--      = beneficiary for debits). 2. THEN all keyword rules, lowest `priority`
--      wins (match on description_original). 3. Fallback -> 15 + needs_review.
--   => A keyword can NEVER beat a vendor rule. Any "split" that must key off the
--      description cannot be done while a vendor rule already catches the row.
--
-- Idempotent: BEGIN/COMMIT, ON CONFLICT DO UPDATE (retarget-or-insert) and a
-- pattern-scoped UPDATE. Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. New categories. overhead_type NULL is an already-supported case (cats 5,
--    15 are NULL today); the accordion Badge only renders when overhead_type is
--    truthy, so NULL renders cleanly with no UI change.
-- ----------------------------------------------------------------------------
INSERT INTO public.expense_categories (id, name, overhead_type, sort_order, is_fallback)
VALUES
    (16, 'Advertising & Marketing', NULL, 16, FALSE),
    (17, 'Owner Payments',          NULL, 17, FALSE)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Owner-entity vendor rules at PRIORITY 1 (immune to every mined rule, which
--    all sit at priority 100/200). match_type 'contains' so legal-suffix
--    variants (ЕООД / EOOD / LTD / INTERAKTIV) resolve to Owner Payments (17).
--    Provenance: user-mandated owner entities (Main Assembly / Catalyst /
--    Kamen Kamenov / Matthew G. Madey) + human-curated AP workbooks, which file
--    these payees as owner distributions (Owner Benefits + Catalyst_MainAssembly
--    tabs). hits_in_reference = beneficiary-string occurrences in the corpus;
--    the English legal-name forms (CATALYST / KATALYST / MADEJ / MAIN ASSEMBLY)
--    are future-proofing — the corpus books the Bulgarian transliterations
--    (MEYN ASEMBLI / KATALIST / MADEY), handled by the exact-rule retarget in 3.
--    ON CONFLICT retargets-or-inserts so a re-run is a no-op.
-- ----------------------------------------------------------------------------
INSERT INTO public.expense_vendor_rules (match_type, pattern, category_id, priority, source, hits_in_reference)
VALUES
    ('contains', 'МЕЙН АСЕМБЛИ',             17, 1, 'raw_cyrillic', 27),   -- Main Assembly (cyr) — МЕЙН АСЕМБЛИ ЕООД
    ('contains', 'КАТАЛИСТ',                 17, 1, 'raw_cyrillic', 28),   -- Catalyst (cyr) — КАТАЛИСТ ЕООД + КАТАЛИСТ ИНТЕРАКТИВ ЕООД
    ('contains', 'МАТЮ ДЖИ МАДЕЙ',           17, 1, 'raw_cyrillic', 15),   -- Matthew G. Madey (cyr)
    ('contains', 'КАМЕН БОРИСЛАВОВ КАМЕНОВ',  17, 1, 'raw_cyrillic', 15),   -- Kamen Kamenov (cyr)
    ('contains', 'MAIN ASSEMBLY',            17, 1, 'romanized_en', 0),    -- English legal name (future-proof; corpus uses MEYN ASEMBLI)
    ('contains', 'CATALYST',                 17, 1, 'romanized_en', 0),    -- English legal name (future-proof; corpus uses KATALIST)
    ('contains', 'KATALIST',                 17, 1, 'romanized_en', 132),  -- Catalyst transliteration — KATALIST EOOD + KATALIST INTERAKTIV EOOD
    ('contains', 'KATALYST',                 17, 1, 'romanized_en', 0),    -- alt English spelling (future-proof)
    ('contains', 'MADEY',                    17, 1, 'romanized_en', 66),   -- Madey surname — MATYu DZhI MADEY
    ('contains', 'MADEJ',                    17, 1, 'romanized_en', 0)     -- alt surname spelling (future-proof)
ON CONFLICT (match_type, pattern) DO UPDATE
    SET category_id = EXCLUDED.category_id,
        priority    = EXCLUDED.priority;

-- ----------------------------------------------------------------------------
-- 3. Retarget the pre-existing EXACT owner-entity vendor rules to 17, BY PATTERN
--    (never by fragile numeric id). This is what actually moves the two forms
--    the priority-1 contains rules do NOT cover: the Bulgarian transliteration
--    'MEYN ASEMBLI EOOD' (127 rows — "MAIN ASSEMBLY" contains does not match it)
--    and the romanized 'KAMEN BORISLAVOV KAMENOV' (no romanized contains anchor
--    for Kamen). Also explicitly re-homes КАТАЛИСТ ЕООД (was 5), КАТАЛИСТ
--    ИНТЕРАКТИВ ЕООД (was 7) and МЕЙН АСЕМБЛИ ЕООД (was 5). Idempotent.
-- ----------------------------------------------------------------------------
UPDATE public.expense_vendor_rules
   SET category_id = 17
 WHERE match_type = 'exact'
   AND pattern IN (
        'МЕЙН АСЕМБЛИ ЕООД', 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', 'МАТЮ ДЖИ МАДЕЙ',
        'КАТАЛИСТ ЕООД', 'КАТАЛИСТ ИНТЕРАКТИВ ЕООД',
        'MEYN ASEMBLI EOOD', 'KAMEN BORISLAVOV KAMENOV', 'MATYu DZhI MADEY',
        'KATALIST EOOD', 'KATALIST INTERAKTIV EOOD'
   );

-- ----------------------------------------------------------------------------
-- 4. Owner keyword rules on description_original (these transactions carry a
--    BLANK beneficiary, so no vendor rule can fire — keyword is the only lever).
--
--    (a) AZV-MAIN ASSEMBLY principal → Owner Payments (17), priority 1.
--        Blank-beneficiary GPP settlements to the owner entity Main Assembly
--        (Cyprus). Form: 'AZV-MAIN ASSEMBLY CYPRUS LTD, payment on invoice for
--        agent services, GPP Ref...'. 238 corpus rows (machine mislabels them
--        Contractors 206/206). Priority 1 so it beats the existing keyword rules
--        'MAIN ASSEMBLY'->7 and 'AGENT SERVIC'->7 (both priority 20), which the
--        same line also contains.
--        AZV COMMISSION vs PRINCIPAL — verified mutually exclusive in the corpus:
--        653 commission lines ('AZV-Commission ... for GPP transaction') and 238
--        principal lines, ZERO rows contain BOTH substrings. So the existing
--        'AZV-COMMISSION'->4 keyword keeps classifying commission lines as Bank &
--        Transfer Fees, untouched. No priority-0 fee keyword is needed; the
--        €0.82 planning concern does not occur in the reference data.
--
--    (b) FACEBK → Advertising & Marketing (16), priority 20.
--        USER-INSTRUCTED ("FACEBK is marketing. it is facebook") + planner
--        observed 67 FACEBK card lines in prod before the reset. NOT present in
--        the 5 curated workbooks (they predate the card-ads period), hence
--        hits_in_reference 0; 'FACEBK' is the distinctive card-descriptor token
--        for Facebook/Meta ad spend and is over-match-safe.
--
--    (c) BLINK interbank transfer fee → Bank & Transfer Fees (4), priority 20.
--        USER-INSTRUCTED ("BLINK TAKSA ZA MEZHDUBANKOV PREVOD is clearly a bank
--        fee") + human-curated workbook precedent (Taxes and Fees) + overrides
--        report(3)'s machine labeling (698/698 of these were Miscellaneous).
--        Anchored on the CYRILLIC original as it appears in description_original;
--        the single anchor 'ТАКСА ЗА МЕЖДУБАНКОВ ПРЕВОД' covers BOTH the
--        'BLINK Такса за междубанков превод' and bare 'Такса за междубанков
--        превод' forms (952 corpus rows; 100% Miscellaneous, i.e. no competing
--        real category — full dominance). The transliterated twin is a
--        future-proof no-op on Cyrillic ingest (precedent: the existing
--        'TAKSA ZA OUTGOING SEPA TRANSFER' twin from migration 128).
--
--    (d) Corporate profit tax → Accounting & Compliance (13), priority 10.
--        USER-INSTRUCTED ("only genuinely corporate tax → Accounting") + workbook
--        precedent. Anchored on 'ДАНЪК ПЕЧАЛБА' (advance corporate profit tax).
--        See §5 for why this cannot override the НАП vendor rule and what it DOES
--        cover. 5 corpus rows.
--
--    (e) Office coffee vending → Office Supplies & Food (6), priority 20.
--        USER-INSTRUCTED ("COFFEE OFFICE is an office food expense"). Recurring
--        vending orders from СТРЕЗОВ ВЕНДИНГ ЕООД; the phrase is LATIN literal
--        inside the otherwise-Cyrillic description ('поръчка ESH... office coffee'
--        / invoice-note 'ф-ра ... coffee office'). Human-filed Office in every
--        curated workbook; machine mislabels Miscellaneous. Both literal forms
--        anchored; ~27 corpus rows, full Office dominance. NOTE: the separately
--        requested "SWEET BREAD FOR EMPLOYEES" is a SINGLE non-recurring xmas-
--        party line with no safe recurring anchor — intentionally NOT ruled here
--        (see report; do-not-guess). The KaffeKapslen coffee-capsule POS lines
--        are already covered by the existing 'KAFFEK'->6 rule (migration 128).
-- ----------------------------------------------------------------------------
INSERT INTO public.expense_keyword_rules (keyword, category_id, priority, hits_in_reference, force_review)
VALUES
    ('AZV-MAIN ASSEMBLY',            17,  1, 238, FALSE),  -- (a) owner GPP principal; beats MAIN ASSEMBLY/AGENT SERVIC ->7
    ('FACEBK',                       16, 20,   0, FALSE),  -- (b) Facebook/Meta ads; user-instructed + planner 67 prod rows
    ('ТАКСА ЗА МЕЖДУБАНКОВ ПРЕВОД',   4, 20, 952, FALSE),  -- (c) BLINK interbank fee; user-instructed; overrides Misc 698/698
    ('TAKSA ZA MEZHDUBANKOV PREVOD',  4, 20,   0, FALSE),  -- (c) transliterated future-proof twin (inert on Cyrillic ingest)
    ('ДАНЪК ПЕЧАЛБА',                13, 10,   5, FALSE),  -- (d) corporate profit tax -> Accounting & Compliance
    ('OFFICE COFFEE',                 6, 20,  27, FALSE),  -- (e) СТРЕЗОВ ВЕНДИНГ office coffee (order-text form)
    ('COFFEE OFFICE',                 6, 20,  13, FALSE)   -- (e) same vending orders (invoice-note form)
ON CONFLICT (keyword) DO UPDATE
    SET category_id = EXCLUDED.category_id,
        priority    = EXCLUDED.priority;

-- ----------------------------------------------------------------------------
-- 5. НАП (Natsionalna Agentsiya za Prihodite) split — DESIGN DECISION + EVIDENCE
--
--    The existing exact vendor rules 'Национална Агенция за Приходите'->2 and
--    'Natsionalna Agentsiya za Prihodite'->2 are KEPT UNCHANGED. Evidence from
--    the full 2024-2025 corpus: every НАП remittance to that beneficiary is a
--    statutory payroll charge and is correctly Payroll Taxes (2) —
--        Вноски за ДОО   (social security)            -> 2
--        Вноски за ЗО    (statutory health / ЗО)       -> 2   [user: statutory health = payroll taxes]
--        Вноски за ДЗПО  (supplementary/mandatory pension, ДЗПО) -> 2  [user: additional pension = payroll taxes]
--        ДОД / ЗДДФЛ     (income-tax withholding)      -> 2
--        Ав данък граждански договори (civil-contract withholding) -> 2
--    User-instructed + workbook precedent (Taxes and Fees::Employees). There are
--    ZERO 'корпоративен данък' rows to НАП in the entire corpus; the ONLY
--    corporate-tax signal is a SINGLE 'Данък печалба авансов' (advance profit
--    tax) row, also to beneficiary НАП.
--
--    Because categorize.ts runs ALL vendor rules before ANY keyword rule, a
--    description keyword CANNOT override the НАП vendor rule. Removing/narrowing
--    the vendor rule to let 'ДАНЪК ПЕЧАЛБА'->13 fire would put 190+ correctly
--    classified statutory rows at the mercy of exhaustive per-phrase keyword
--    coverage (fragile; any new НАП reason phrase -> fallback 15). That trade is
--    not justified by one advance row in two years (reconciled at annual filing).
--    DECISION: keep НАП vendor->2; the 'ДАНЪК ПЕЧАЛБА'->13 keyword (§4d) still
--    correctly classifies any corporate-profit-tax row that arrives with a BLANK
--    or non-НАП counterparty. The single НАП-beneficiary advance-profit-tax row
--    resolves to 2 — a documented, accepted imprecision.
--
--    Health/pension statutory-vs-voluntary fork (user-instructed): PRIVATE
--    employee health/benefit policies are already correctly Employee Benefits
--    (8) via the existing vendor rules 'ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД'
--    ->8 and 'БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД'->8 (Multisport) — verified against
--    the corpus (Employee Benefits 182/182). No new rule needed; no voluntary
--    (ДДПО) private-pension payee exists separately in the data.
-- ----------------------------------------------------------------------------

COMMIT;
