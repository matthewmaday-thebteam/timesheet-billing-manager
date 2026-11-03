-- t02: project grouping changes queue the affected canonical months
-- (migration 137).
\ir lib/assert.sql
\ir fixtures/scenario.sql

-- Add P2 (Jan activity) to the PG group -> primary queued for P2's months.
INSERT INTO project_group_members (group_id, member_project_id)
VALUES ('00000000-0000-0000-0000-0000000000a1', t.pid('extP2'));
SELECT t.eq(t.pending(), ARRAY['extPG:2027-01:group_change'], 'adding a member queues the primary for the member''s months');
SELECT drain_recalculation_queue();
SELECT t.eq((t.pms(t.pid('extPG'), '2027-01-01')).rounded_minutes, 135, 'primary Jan now includes the new member (60+45+30)');

-- Remove P2 (group keeps PM) -> primary and P2 queued.
DELETE FROM project_group_members WHERE member_project_id = t.pid('extP2');
SELECT t.eq(t.pending(), ARRAY['extP2:2027-01:group_change', 'extPG:2027-01:group_change'],
            'removing a member queues primary and the member');
SELECT drain_recalculation_queue();
SELECT t.eq((t.pms(t.pid('extPG'), '2027-01-01')).rounded_minutes, 105, 'primary Jan back to 105 after removal');

-- Change primary PG -> PX: old and new primary queued for every group project's months.
UPDATE project_groups SET primary_project_id = t.pid('extPX') WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT t.eq(t.pending_pm(),
            ARRAY['extPG:2027-01', 'extPG:2027-02', 'extPG:2027-03', 'extPX:2027-01', 'extPX:2027-02', 'extPX:2027-03'],
            'primary change queues old and new primary for all group months');
SELECT t.ok((SELECT bool_and(reason = 'group_change') FROM recalculation_queue WHERE processed_at IS NULL), 'reason group_change');
SELECT t.clear_queue();
UPDATE project_groups SET primary_project_id = t.pid('extPG') WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT drain_recalculation_queue();

-- Remove the LAST member -> trg_pgm_auto_dissolve deletes the group; primary
-- and member are both queued (BEFORE DELETE runs while the group exists).
DELETE FROM project_group_members WHERE member_project_id = t.pid('extPM');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM project_groups WHERE id = '00000000-0000-0000-0000-0000000000a1'), 'group auto-dissolved');
-- (PG also has a 2027-03 summary row from the primary-swap step above; the
-- auto-dissolve's project_groups BEFORE DELETE queues the primary's own months too.)
SELECT t.ok(t.pending_pm() @> ARRAY['extPG:2027-01', 'extPG:2027-02', 'extPM:2027-01', 'extPM:2027-02'],
            'last-member removal queues primary (incl. member months) and the member');
SELECT drain_recalculation_queue();
SELECT t.eq((t.pms(t.pid('extPG'), '2027-01-01')).rounded_minutes, 60, 'dissolved primary Jan = own 60');
SELECT t.eq((t.pms(t.pid('extPM'), '2027-02-01')).rounded_minutes, 30, 'standalone ex-member Feb = 30');

-- Deleting a whole group (FK cascade to members) queues the primary as well.
INSERT INTO project_groups (id, primary_project_id) VALUES ('00000000-0000-0000-0000-0000000000a2', t.pid('extP1'));
INSERT INTO project_group_members (group_id, member_project_id) VALUES ('00000000-0000-0000-0000-0000000000a2', t.pid('extP2'));
SELECT drain_recalculation_queue();
DELETE FROM project_groups WHERE id = '00000000-0000-0000-0000-0000000000a2';
SELECT t.ok(t.pending_pm() @> ARRAY['extP1:2027-01', 'extP2:2027-01'], 'group delete queues primary and cascaded member');
