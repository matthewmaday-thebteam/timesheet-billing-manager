-- Synthetic base data required BEFORE migrations 134-140 are applied to an
-- empty prod-schema database. Contains no production data.
--   * employment_types 'Full-time' (rollup trigger auto_create_resource needs it)
--   * the two projects whose uuids migration 134 seeds as accepted variances
--     (NeoCurrency 2026-07, FoodCycler Hypercare 2026-06), with synthetic names.
INSERT INTO employment_types (name) VALUES ('Full-time') ON CONFLICT (name) DO NOTHING;

INSERT INTO projects (id, project_id, project_name, client_id, client_name, first_seen_month)
VALUES ('a93b6d26-89b3-4a04-b13e-dd07b838928c', 'ext-neo', 'Neo (synthetic)', 'c-neo', 'Neo Client', '2026-01-01'),
       ('eec6792f-214b-4796-8d5b-d02660b35962', 'ext-fc', 'FC Hypercare (synthetic)', 'c-fc', 'FC Client', '2026-01-01')
ON CONFLICT (id) DO NOTHING;
