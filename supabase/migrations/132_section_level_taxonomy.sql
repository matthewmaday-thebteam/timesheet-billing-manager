-- ============================================================================
-- Migration 132: Section-level (Tab-Section) taxonomy (Task 10)
-- ============================================================================
-- USER REFINEMENT (verbatim): "I want the worksheet labels but also the
-- subcategories ... Business Expenses-Accounting / ... / Taxes and Fees-Employees
-- / Taxes and Fees-Company / Employees-Employees / Employees-Employee Benefits ...
-- This captures a traceable 1 to 1 auditable look as the source data."
-- Supersedes migration 131's tab-level set with compound <Tab>-<Section>
-- categories mined from the in-sheet section labels of the human-curated AP
-- workbooks (5 files). Category name = EXACT source spelling (incl. the
-- workbook's own 'Office Furnature' and 'Office Meals (lunch and Learns)'). Tabs
-- with no section labels stay bare tab names (Marketing and Client, Taggable,
-- Project Expenses, Production Contractors, Auxmedica, Office Purchase and
-- Buildout, BAKr). Owner Payments -> 'Business Expenses-Owner Payments' (1:1
-- source naming supersedes the 130/131 elevation; still a first-class row; the
-- ordinary-expense contract + anti-drift test carry over).
--
-- CONFIG ONLY — never writes public.expenses. Standing rules upheld
-- (manifest-expenses-fix-rules-not-data, ...-past-classifications-are-authority).
-- categorize.ts UNCHANGED; id 15 stays the fallback so FALLBACK_CATEGORY_ID=15
-- needs no code change. There is no workbook-native 'uncategorized' section, so
-- 15 'Miscellaneous' (is_fallback) remains the technical fallback.
--
-- Reuses the proven 131 swap pattern, made state-independent so it is correct
-- whether the prior state is the 130 rule set (ids 1-17) or the 131 set (20-31):
--   * fail-closed legacy guard FIRST;
--   * rename any non-target category out of the way (name-unique collisions with
--     the 131 set are certain — e.g. 'Marketing and Client');
--   * rule RETARGET keyed on pattern/keyword (NOT on source category_id), so it
--     is correct regardless of the prior id scheme;
--   * guarded delete of everything except the fallback + the section set.
-- Idempotent in fresh AND re-apply states.
--
-- overhead_type NULL for all (the tab/section taxonomy carries no Fixed/Variable
-- dimension; re-derive separately if reporting needs it — Task 6/7).
-- ============================================================================

BEGIN;

-- 0. GUARD (fail-closed, first): abort if any expense references a non-section
--    category. Prod holds 812 expenses on the 130 ids, so 132 fails closed here
--    until the coordinator resets uploads.
DO $$
DECLARE orphaned int;
BEGIN
    SELECT count(*) INTO orphaned FROM public.expenses WHERE NOT (category_id = ANY(ARRAY[15,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68]));
    IF orphaned > 0 THEN
        RAISE EXCEPTION 'Migration 132 aborted: % expenses row(s) reference non-section categories — reset uploads before applying 132.', orphaned;
    END IF;
END $$;

-- 0b. Rename any existing non-target categories out of the way (frees names the
--     section set reuses; handles either prior state). Transient; deleted in 3.
UPDATE public.expense_categories SET name = name || ' (superseded)'
 WHERE NOT (id = ANY(ARRAY[15,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68])) AND name NOT LIKE '% (superseded)';

-- 1. Insert the section-level compound categories. Names use corrected English
--    spelling, sensible casing, and NO parentheses (user amendments); the 1:1
--    structural Tab-Section mapping is unchanged. sort_order = tab order then
--    in-sheet section order. Keep 15 as fallback (sorted last).
INSERT INTO public.expense_categories (id, name, overhead_type, sort_order, is_fallback)
VALUES
    (40, 'Business Expenses-Accounting', NULL, 1, FALSE),
    (41, 'Business Expenses-Legal', NULL, 2, FALSE),
    (42, 'Business Expenses-Asset Purchases', NULL, 3, FALSE),
    (43, 'Business Expenses-Owner Payments', NULL, 4, FALSE),
    (44, 'Marketing and Client', NULL, 5, FALSE),
    (45, 'Taxes and Fees-Employees', NULL, 6, FALSE),
    (46, 'Taxes and Fees-Company', NULL, 7, FALSE),
    (47, 'Taxes and Fees-Bank', NULL, 8, FALSE),
    (48, 'Employees-Employees', NULL, 9, FALSE),
    (49, 'Employees-Employee Benefits', NULL, 10, FALSE),
    (50, 'Employees-Recruiter Costs', NULL, 11, FALSE),
    (51, 'Office-Utilities', NULL, 12, FALSE),
    (52, 'Office-Office', NULL, 13, FALSE),
    (53, 'Office-Developer Software', NULL, 14, FALSE),
    (54, 'Office-Office Software', NULL, 15, FALSE),
    (55, 'Office-Office Furniture', NULL, 16, FALSE),
    (56, 'Office-Phone', NULL, 17, FALSE),
    (57, 'Office-Supplies', NULL, 18, FALSE),
    (58, 'Office-Credit Card Security', NULL, 19, FALSE),
    (59, 'Office-Office Meals', NULL, 20, FALSE),
    (60, 'Office-Computer Equipment', NULL, 21, FALSE),
    (61, 'Office-Mortgage', NULL, 22, FALSE),
    (62, 'Office-Hosting', NULL, 23, FALSE),
    (63, 'Taggable', NULL, 24, FALSE),
    (64, 'Project Expenses', NULL, 25, FALSE),
    (65, 'Production Contractors', NULL, 26, FALSE),
    (66, 'Auxmedica', NULL, 27, FALSE),
    (67, 'Office Purchase and Buildout', NULL, 28, FALSE),
    (68, 'BAKr', NULL, 29, FALSE)
ON CONFLICT (id) DO NOTHING;

UPDATE public.expense_categories SET sort_order = 99 WHERE id = 15;

-- 2. Retarget EVERY vendor + keyword rule to its compound category, keyed on the
--    rule's pattern/keyword (source-state independent). See report for anchors,
--    per-vendor section evidence, and flagged low-confidence assignments.
--    NOTE (user): internal treasury transfers (Wise Europe) are TAXES -> routed
--    to Taxes and Fees-Bank (47); no workbook section precedent exists, so 'Bank'
--    is the flagged default section.
UPDATE public.expense_vendor_rules SET category_id = 40 WHERE pattern IN ('Оптимум Акаунтинг ЕООД', 'КОНСУЛТАНТСКА КЪЩА АМРИТА ООД', 'Optimum Akaunting EOOD', 'KONSULTANTSKA KAShtA AMRITA OOD');  -- Business Expenses-Accounting
UPDATE public.expense_vendor_rules SET category_id = 43 WHERE pattern IN ('МЕЙН АСЕМБЛИ ЕООД', 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', 'МАТЮ ДЖИ МАДЕЙ', 'КАТАЛИСТ ЕООД', 'КАТАЛИСТ ИНТЕРАКТИВ ЕООД', 'MEYN ASEMBLI EOOD', 'KAMEN BORISLAVOV KAMENOV', 'MATYu DZhI MADEY', 'KATALIST EOOD', 'KATALIST INTERAKTIV EOOD', 'МЕЙН АСЕМБЛИ', 'КАТАЛИСТ', 'МАТЮ ДЖИ МАДЕЙ', 'КАМЕН БОРИСЛАВОВ КАМЕНОВ', 'MAIN ASSEMBLY', 'CATALYST', 'KATALIST', 'KATALYST', 'MADEY', 'MADEJ');  -- Business Expenses-Owner Payments
UPDATE public.expense_vendor_rules SET category_id = 45 WHERE pattern IN ('Национална Агенция за Приходите', 'ТД на НОИ София-окръг', 'Natsionalna Agentsiya za Prihodite', 'TD na NOI Sofiya-okrag');  -- Taxes and Fees-Employees
UPDATE public.expense_vendor_rules SET category_id = 47 WHERE pattern IN ('UNICREDIT BULBANK', 'Wise Europe SA', 'Wise Europe SA/NV', 'UNICREDIT BULBANK AD', 'BORICA AD');  -- Taxes and Fees-Bank
UPDATE public.expense_vendor_rules SET category_id = 48 WHERE pattern IN ('СТАНИСЛАВ ВАСИЛЕВ ПЕЙКОВ', 'Милен Димитров Анастасов', 'АСПАРУХ РУМЕНОВ МАНЧЕВ', 'ДИМАНА БОЖИДАРОВА ТРОЕВА', 'Теодора Дилинска', 'Таня Иванова Ангелинова', 'АТАНАС МАРИОВ МАРИНОВ', 'Валери Николаев Стоянов', 'КАЛИН ЕМИЛОВ ТОМАНОВ', 'ТЕОДОР МАРИАНОВ ДИМИТРОВ', 'Надя Бориславова Василева', 'ФРАНК ШЕПАЦ', 'ДОБРОМИР ВАСИЛЕВ ПЕТРЕВСКИ', 'Станимир Христов Димитров', 'ТОДОР ЦВЕТКОВ ТОДОРОВ', 'РАДОСЛАВ ТОНЕВ ВАРТАНЯНОВ', 'АЛЕКСАНДЪР АЛЕКСАНДРОВ КЕРЕМИДАРОВ', 'Иван Стоянов Статев', 'Ивайло Станимиров Колев', 'Димитър Димитров Парпулов', 'Мартин Русев', 'ХРИСТО ПАВЛОВ ДЖАМБОВ', 'STANISLAV VASILEV PEYKOV', 'Milen Dimitrov Anastasov', 'ASPARUH RUMENOV MANChEV', 'DIMANA BOZhIDAROVA TROEVA', 'Teodora Dilinska', 'Tanya Ivanova Angelinova', 'ATANAS MARIOV MARINOV', 'KALIN EMILOV TOMANOV', 'Valeri Nikolaev Stoyanov', 'TEODOR MARIANOV DIMITROV', 'FRANK ShEPATs', 'Nadya Borislavova Vasileva', 'DOBROMIR VASILEV PETREVSKI', 'Stanimir Hristov Dimitrov', 'TODOR TsVETKOV TODOROV', 'RADOSLAV TONEV VARTANYaNOV', 'ALEKSANDAR ALEKSANDROV KEREMIDAROV', 'Ivan Stoyanov Statev', 'Ivaylo Stanimirov Kolev', 'Dimitar Dimitrov Parpulov', 'HRISTO PAVLOV DZhAMBOV', 'Martin Rusev');  -- Employees-Employees
UPDATE public.expense_vendor_rules SET category_id = 49 WHERE pattern IN ('ЗАСТРАХОВАТЕЛНА КОМПАНИЯ УНИКА ЖИВОТ АД', 'БЕНЕФИТ СИСТЕМС БЪЛГАРИЯ ООД', 'ZASTRAHOVATELNA KOMPANIYa UNIKA ZhIVOT AD', 'BENEFIT SISTEMS BALGARIYa OOD');  -- Employees-Employee Benefits
UPDATE public.expense_vendor_rules SET category_id = 51 WHERE pattern IN ('ЕЛЕКТРОХОЛД ПРОДАЖБИ ЕАД', 'УниКредит Булбанк АД', 'Столична Община Р-н Лозенец', 'ELEKTROHOLD PRODAZhBI EAD', 'UniKredit Bulbank AD', 'Stolichna Obshtina R-n Lozenets');  -- Office-Utilities
UPDATE public.expense_vendor_rules SET category_id = 53 WHERE pattern IN ('OPENAI *CHATGPT SUBSCR', 'CLAUDE.AI SUBSCRIPTION', 'FIGMA', 'MIDJOURNEY INC.', 'CLICKUP', 'FIGMA MONTHLY RENEWAL', 'OPENAI', 'HIGHLEVEL INC.', 'RELUME.IO', 'ANTHROPIC', 'MICROSOFT-G082412259', 'MICROSOFT-G086826006', 'MICROSOFT-G091453138', 'MICROSOFT-G095987214', 'MICROSOFT-G101135623', 'MICROSOFT-G106515158', 'MICROSOFT-G112474622', 'MICROSOFT-G117933017', 'MICROSOFT-G123023626', 'ANTHROPIC SAN FRANCISCO USA 710472', 'HIGHLEVEL * TRIAL OVER', 'MICROSOFT-G134242947', 'MICROSOFT-G139754016', 'MICROSOFT-G145720617');  -- Office-Developer Software
UPDATE public.expense_vendor_rules SET category_id = 54 WHERE pattern IN ('APR*APPRIVER', 'BAMBOOHR HRIS', 'INTUIT *QBOOKS ONLINE');  -- Office-Office Software
UPDATE public.expense_vendor_rules SET category_id = 55 WHERE pattern IN ('IKEA BULGARIA');  -- Office-Office Furniture
UPDATE public.expense_vendor_rules SET category_id = 56 WHERE pattern IN ('A1 BULGARIA LTD');  -- Office-Phone
UPDATE public.expense_vendor_rules SET category_id = 57 WHERE pattern IN ('Интра Бизнес Сървисиз ЕООД', 'Пейпър Конвъртинг ЕООД', 'ВИМАКС КЛИМА ООД', 'КООПЕРАЦИЯ ПАНДА', 'АБИС АЛБА ЕООД', 'Мит фрукт 2020 ЕООД', 'Хот Колор ЕООД', 'EPAY OFFICE1.BG', 'KAFFEKAPSLEN', 'Intra Biznes Sarvisiz EOOD', 'Peypar Konvarting EOOD', 'S PLYUS S-S. TIMEVA EOO', 'VIMAKS KLIMA OOD', 'KOOPERATsIYa PANDA', 'ABIS ALBA EOOD', 'Hot Kolor EOOD', 'Mit frukt 2020 EOOD', 'OMNIA PHARM', 'SUMUP *EBAG.BG', 'SUMUP *EBAG.BG SOFIIA BGR 010066');  -- Office-Supplies
UPDATE public.expense_vendor_rules SET category_id = 59 WHERE pattern IN ('ТОШИТОМО БГ ООД', 'Тошитомо БГ ООД', 'TOShITOMO BG OOD', 'INVEST - BG EOOD', 'Toshitomo BG OOD', 'ISTYLE.BG');  -- Office-Office Meals
UPDATE public.expense_vendor_rules SET category_id = 63 WHERE pattern IN ('TAGGABLE PHOTOS', 'WWW.TWILIO.COM', 'SUPERHOSTING.BG BGN', 'DROPBOX', 'DROPBOX*151WMP267V1K', 'DROPBOX*195YPL8VNXYG', 'DROPBOX*2K6LZV4LDK81', 'DROPBOX*44CTPN732ZMY', 'DROPBOX*5XYYCLN86W1F', 'DROPBOX*77FK5B3998XF', 'DROPBOX*7L462D8N84TH', 'DROPBOX*7N6GYM1HBPDD', 'DROPBOX*85LXG4R6VN8Q', 'DROPBOX*91FND589SXKW', 'DROPBOX*9L7964HZKC89', 'DROPBOX*BBMBQGVTVBWV', 'DROPBOX*CSF9GNLSB92Y', 'DROPBOX*D17Y7ZQBXSK5', 'DROPBOX*FCRH7W37L8TY', 'DROPBOX*H24JXYJCLZD8', 'DROPBOX*H2DDRM6Y74P8', 'DROPBOX*HVNFS5HLXS24', 'DROPBOX*JKG32PN2S7X6', 'DROPBOX*LV71DZFC7H16', 'DROPBOX*MVQ1N3R19H4G', 'DROPBOX*N9N97BTRMT3T', 'DROPBOX*T9V1F26PZKBG', 'DROPBOX*VXV7VD69H81H', 'DROPBOX*W1N1F2MD5WWM', 'DROPBOX*XC2P789Q2VHV', 'DROPBOX*2GYWV9D1B4NN', 'DROPBOX*3N2VFZLNNDFV', 'DROPBOX*C2B6GZ32DQZ9', 'DROPBOX*CQVNVTSF5B4L', 'DROPBOX*FHGWH1J4WQVG', 'DROPBOX*KN2LZ7VXBHZN', 'DROPBOX*KY219T357P5Y');  -- Taggable
UPDATE public.expense_vendor_rules SET category_id = 65 WHERE pattern IN ('ОРБИН ЕООД', 'КлаудСорс ООД', 'ORBIN EOOD', 'KlaudSors OOD');  -- Production Contractors
UPDATE public.expense_vendor_rules SET category_id = 66 WHERE pattern IN ('EMAILOCTOPUS');  -- Auxmedica
UPDATE public.expense_keyword_rules SET category_id = 42 WHERE keyword IN ('GODADDY');  -- Business Expenses-Asset Purchases
UPDATE public.expense_keyword_rules SET category_id = 43 WHERE keyword IN ('AZV-MAIN ASSEMBLY');  -- Business Expenses-Owner Payments
UPDATE public.expense_keyword_rules SET category_id = 44 WHERE keyword IN ('FACEBK');  -- Marketing and Client
UPDATE public.expense_keyword_rules SET category_id = 46 WHERE keyword IN ('ДАНЪК ПЕЧАЛБА');  -- Taxes and Fees-Company
UPDATE public.expense_keyword_rules SET category_id = 47 WHERE keyword IN ('UNICREDIT BULBANK', 'UNICREDIT BULBANK AD', 'AZV-COMMISSION', 'ТАКСИ ПОЛУЧЕНИ ВАЛУТНИ', 'RECURRING FEE DUE', 'TAKSA ZA OUTGOING SEPA TRANSFER', 'ПЕРИОДИЧНА ТАКСА', 'ТАКСА ЗА ИЗХ.ПРЕВОД SEPA', 'ТАКСА ЗА МЕЖДУБАНКОВ ПРЕВОД', 'TAKSA ZA MEZHDUBANKOV PREVOD');  -- Taxes and Fees-Bank
UPDATE public.expense_keyword_rules SET category_id = 48 WHERE keyword IN ('SALARY', 'ЗАПЛАТА');  -- Employees-Employees
UPDATE public.expense_keyword_rules SET category_id = 53 WHERE keyword IN ('OPENAI', 'CHATGPT', 'FIGMA', 'CLAUDE.AI', 'CURSOR', 'MICROSOFT', 'GITHUB', 'OPENAI *CHATGPT SUBSCR', 'CLAUDE.AI SUBSCRIPTION', 'MIDJOURNEY INC.', 'CLICKUP', 'FIGMA MONTHLY RENEWAL', 'ANTHROPIC', 'HIGHLEVEL INC.', 'RELUME.IO', 'HIGHLEVEL');  -- Office-Developer Software
UPDATE public.expense_keyword_rules SET category_id = 54 WHERE keyword IN ('APR*APPRIVER', 'BAMBOOHR HRIS', 'INTUIT *QBOOKS ONLINE');  -- Office-Office Software
UPDATE public.expense_keyword_rules SET category_id = 55 WHERE keyword IN ('IKEA BULGARIA');  -- Office-Office Furniture
UPDATE public.expense_keyword_rules SET category_id = 56 WHERE keyword IN ('A1 BULGARIA LTD', 'A1.BG');  -- Office-Phone
UPDATE public.expense_keyword_rules SET category_id = 57 WHERE keyword IN ('EPAY OFFICE1.BG', 'KAFFEKAPSLEN', 'S PLYUS S-S. TIMEVA EOO', 'KAFFEK', 'OFFICE1.BG', 'OFFICE COFFEE', 'COFFEE OFFICE');  -- Office-Supplies
UPDATE public.expense_keyword_rules SET category_id = 59 WHERE keyword IN ('INVEST - BG EOOD');  -- Office-Office Meals
UPDATE public.expense_keyword_rules SET category_id = 63 WHERE keyword IN ('TWILIO', 'DROPBOX', 'TAGGABLE PHOTOS', 'WWW.TWILIO.COM', 'SUPERHOSTING.BG BGN');  -- Taggable
UPDATE public.expense_keyword_rules SET category_id = 65 WHERE keyword IN ('AGENT SERVIC', 'MAIN ASSEMBLY');  -- Production Contractors
UPDATE public.expense_keyword_rules SET category_id = 66 WHERE keyword IN ('EMAILOCTOPUS');  -- Auxmedica

-- 2b. НАП short-form split, beneficiary-keyed (more-specific lower priority wins):
--     'НАП - Данъци' (central-budget taxes / VAT) -> Taxes and Fees-Company;
--     other 'НАП - ...' (social/health/pension) -> Taxes and Fees-Employees.
INSERT INTO public.expense_vendor_rules (match_type, pattern, category_id, priority, source, hits_in_reference)
VALUES ('contains', 'НАП - Данъци', 46, 90, 'raw_cyrillic', 5)
ON CONFLICT (match_type, pattern) DO UPDATE SET category_id = EXCLUDED.category_id, priority = EXCLUDED.priority;
INSERT INTO public.expense_vendor_rules (match_type, pattern, category_id, priority, source, hits_in_reference)
VALUES ('contains', 'НАП -', 45, 100, 'raw_cyrillic', 15)
ON CONFLICT (match_type, pattern) DO UPDATE SET category_id = EXCLUDED.category_id, priority = EXCLUDED.priority;

-- 3. Delete the superseded prior taxonomy (everything except fallback 15 + the
--    section set). Safe: guard cleared expenses; step 2 retargeted all rules.
DELETE FROM public.expense_categories WHERE NOT (id = ANY(ARRAY[15,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68]));

COMMIT;
