-- t04: hardened drain — failure isolation, stale TMT rebuild, TMT rebuild
-- failure, member retargeting, eom_report_stale, cascade limit (migration 138).
\ir lib/assert.sql
\ir fixtures/scenario.sql

-- Injected failure: one project-month fails, the others continue -------------
CREATE OR REPLACE FUNCTION t.boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_id = (SELECT id FROM projects WHERE project_id = 'extP2') THEN
        RAISE EXCEPTION 'injected failure for P2';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER t_boom BEFORE INSERT OR UPDATE ON project_monthly_summary
    FOR EACH ROW EXECUTE FUNCTION t.boom();

SELECT t.upsert('tP2a', 'extP2', '2027-01-12', 45);
SELECT t.upsert('tP1a', 'extP1', '2027-01-10', 75);
SELECT t.upsert('tPXa', 'extPX', '2027-03-03', 75);
SELECT t.eq(drain_recalculation_queue(), 3, 'drain handled all three items');
SELECT t.eq((SELECT outcome || '|' || error FROM recalculation_queue WHERE project_id = t.pid('extP2') AND processed_at IS NOT NULL ORDER BY queued_at DESC LIMIT 1),
            'failed|P0001: injected failure for P2', 'failed item has outcome failed + error text');
SELECT t.eq(t.alerts('recalc_failed'), 1, 'recalc_failed alert raised');
SELECT t.eq((t.pms(t.pid('extP2'), '2027-01-01')).rounded_minutes, 30, 'failed project-month rolled back (unchanged)');
SELECT t.eq((t.pms(t.pid('extP1'), '2027-01-01')).rounded_minutes, 75, 'other item before it recalculated');
SELECT t.eq((t.pms(t.pid('extPX'), '2027-03-01')).rounded_minutes, 75, 'later item after the failure recalculated');
DROP TRIGGER t_boom ON project_monthly_summary;

-- Stale TMT is rebuilt before recalculating ----------------------------------
-- Change a rollup with triggers bypassed, then queue the month by hand: TMT is
-- now stale and only the drain's freshness step can fix it.
SET session_replication_role = replica;
UPDATE timesheet_daily_rollups SET total_minutes = 240, rounded_minutes = 240 WHERE task_id = 'tP1b';
SET session_replication_role = origin;
SELECT t.ok(EXISTS (SELECT 1 FROM validate_task_monthly_totals_vs_rollups('2027-02-01', '2027-02-01')), 'TMT stale for Feb');
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extP1'), '2027-02-01', 'manual');
SELECT drain_recalculation_queue();
SELECT t.ok(NOT EXISTS (SELECT 1 FROM validate_task_monthly_totals_vs_rollups('2027-02-01', '2027-02-01')), 'drain rebuilt Feb TMT');
SELECT t.eq((t.pms(t.pid('extP1'), '2027-02-01')).rounded_minutes, 240, 'recalc used the rebuilt TMT');

-- TMT that cannot be rebuilt -> tmt_rebuild_failed, nothing recalculated -----
CREATE OR REPLACE FUNCTION t.swallow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.summary_month = '2027-03-01' THEN RETURN NULL; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER t_swallow BEFORE INSERT ON task_monthly_totals FOR EACH ROW EXECUTE FUNCTION t.swallow();
SELECT t.upsert('tP1c', 'extP1', '2027-03-10', 135);
SELECT t.eq(drain_recalculation_queue(), 0, 'drain returns 0 when TMT cannot be made fresh');
SELECT t.eq(t.alerts('tmt_rebuild_failed'), 1, 'tmt_rebuild_failed alert');
SELECT t.eq(t.pending(), ARRAY['extP1:2027-03:sync_update'], 'queue left pending');
SELECT t.eq((t.pms(t.pid('extP1'), '2027-03-01')).rounded_minutes, 90, 'March not recalculated from bad totals');
DROP TRIGGER t_swallow ON task_monthly_totals;
SELECT drain_recalculation_queue();
SELECT t.eq((t.pms(t.pid('extP1'), '2027-03-01')).rounded_minutes, 135, 'recovers once TMT can be rebuilt');

-- Member item is retargeted to the primary ------------------------------------
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extPM'), '2027-02-01', 'rate_change');
SELECT drain_recalculation_queue();
SELECT t.eq((SELECT outcome FROM recalculation_queue WHERE project_id = t.pid('extPM') AND queue_month = '2027-02-01' AND reason = 'rate_change'), 'retargeted', 'member item retargeted');
SELECT t.eq((SELECT outcome FROM recalculation_queue WHERE project_id = t.pid('extPG') AND queue_month = '2027-02-01' AND reason = 'rate_change'), 'recalculated', 'primary recalculated instead');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM project_monthly_summary WHERE project_id = t.pid('extPM')), 'no summary row written for the member');

-- Open month with an EOM report -> eom_report_stale (only on real change) -----
INSERT INTO eom_reports (report_year, report_month, company_id, company_name, total_hours, total_revenue_cents, project_count, storage_path)
VALUES (2027, 3, t.cid('cA'), 'Client cA', 1, 1, 1, 'x.csv');
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extP1'), '2027-03-01', 'rate_change');
SELECT drain_recalculation_queue();
SELECT t.eq(t.alerts('eom_report_stale'), 0, 'no eom_report_stale when the recalc changes nothing');
SELECT t.upsert('tPXa', 'extPX', '2027-03-03', 120);
SELECT drain_recalculation_queue();
SELECT t.eq(t.alerts('eom_report_stale'), 1, 'eom_report_stale raised when an open reported month changes');
SELECT t.eq((SELECT entity_id FROM sync_alerts WHERE alert_type = 'eom_report_stale'), t.cid('cA')::TEXT || ':2027-03', 'entity is <company>:<YYYY-MM>');
SELECT t.eq((SELECT COUNT(*)::INT FROM eom_reports), 1, 'report not regenerated / touched');

-- Cascade depth limit ---------------------------------------------------------
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extP1'), '2027-04-01', 'cascade');
SELECT drain_recalculation_queue(0);
SELECT t.eq(t.alerts('recalc_cascade_limit'), 1, 'recalc_cascade_limit alert');
SELECT t.eq(t.pending(), ARRAY['extP1:2027-04:cascade'], 'item beyond the limit stays pending');
