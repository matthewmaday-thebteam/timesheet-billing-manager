-- Synthetic scenario shared by the billing-lock tests (no production data).
-- All months are 2027-xx so nothing is date-locked by billing_closed_through
-- (2026-09-01) unless a test locks it.
--
--   Company cA:  P1 (extP1), P2 (extP2), PX (extPX) standalone
--                group: primary PG (extPG) + member PM (extPM)
--   Rollups:     P1  2027-01 60m, 2027-02 120m, 2027-03 90m
--                P2  2027-01 30m
--                PG  2027-01 60m;  PM 2027-01 45m, 2027-02 30m
--                PX  2027-03 60m
-- Ends with a full drain so every test starts with summaries computed and an
-- empty queue.
SELECT t.upsert('tP1a', 'extP1', '2027-01-10', 60);
SELECT t.upsert('tP1b', 'extP1', '2027-02-10', 120);
SELECT t.upsert('tP1c', 'extP1', '2027-03-10', 90);
SELECT t.upsert('tP2a', 'extP2', '2027-01-12', 30);
SELECT t.upsert('tPGa', 'extPG', '2027-01-05', 60);
SELECT t.upsert('tPMa', 'extPM', '2027-01-06', 45);
SELECT t.upsert('tPMb', 'extPM', '2027-02-06', 30);
SELECT t.upsert('tPXa', 'extPX', '2027-03-03', 60);

INSERT INTO project_groups (id, primary_project_id) VALUES ('00000000-0000-0000-0000-0000000000a1', t.pid('extPG'));
INSERT INTO project_group_members (group_id, member_project_id) VALUES ('00000000-0000-0000-0000-0000000000a1', t.pid('extPM'));

SELECT drain_recalculation_queue();
SELECT t.eq(CARDINALITY(t.pending()), 0, 'scenario: queue drained');
SELECT t.eq((t.pms(t.pid('extPG'), '2027-01-01')).rounded_minutes, 105, 'scenario: PG Jan includes member PM (60+45)');
DELETE FROM sync_alerts;
