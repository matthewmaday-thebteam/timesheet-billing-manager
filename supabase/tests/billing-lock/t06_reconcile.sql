-- t06: v_billing_month_drift + reconcile_billing_months: dry run writes
-- nothing, real run heals open drift and alerts locked drift, second run is
-- idempotent, persisting drift fails loudly (migration 139).
\ir lib/assert.sql
\ir fixtures/scenario.sql

-- Create drift the way RC1-RC3 did: rollups change while no trigger queues
-- anything (replica mode), and TMT is rebuilt by the next sync.
SELECT t.invoice(t.cid('cA'), '2027-01-01');                  -- Jan locked, Feb+ open
SET session_replication_role = replica;
UPDATE timesheet_daily_rollups SET total_minutes = 120, rounded_minutes = 120 WHERE task_id = 'tP1a';  -- Jan (locked)
UPDATE timesheet_daily_rollups SET total_minutes = 180, rounded_minutes = 180 WHERE task_id = 'tP1b';  -- Feb (open)
DELETE FROM timesheet_daily_rollups WHERE task_id = 'tPXa';                                            -- Mar (open) deleted at source
SET session_replication_role = origin;
SELECT populate_task_monthly_totals('ws', '2027-01-01', '2027-03-31');
INSERT INTO billing_accepted_variances (project_id, month, reason, decided_by) VALUES (t.pid('extP2'), '2027-01-01', 'test', 'owner');
SET session_replication_role = replica;
UPDATE timesheet_daily_rollups SET total_minutes = 90, rounded_minutes = 90 WHERE task_id = 'tP2a';    -- Jan (locked, accepted)
SET session_replication_role = origin;
SELECT populate_task_monthly_totals('ws', '2027-01-01', '2027-01-31');

SELECT t.eq((SELECT ARRAY_AGG(project_name || ':' || TO_CHAR(summary_month, 'YYYY-MM') || ':' || is_locked || ':' || is_accepted ORDER BY project_name, summary_month)
               FROM v_billing_month_drift),
            ARRAY['Project extP1:2027-01:true:false', 'Project extP1:2027-02:false:false',
                  'Project extP2:2027-01:true:true', 'Project extPX:2027-03:false:false'],
            'drift view lists the four drifted project-months with lock/accepted flags');

-- Dry run: correct classification, zero writes.
CREATE TEMP TABLE w AS SELECT (SELECT COUNT(*) FROM recalculation_queue) q, (SELECT COUNT(*) FROM sync_alerts) a,
       (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s) pms,
       (SELECT STRING_AGG(x::TEXT, '|' ORDER BY id) FROM task_monthly_totals x) tmt;
CREATE TEMP TABLE dry AS SELECT reconcile_billing_months('2027-01-01', '2027-03-01', TRUE) r;
SELECT t.eq((SELECT r->>'status' FROM dry), 'ok', 'dry run status ok');
SELECT t.eq((SELECT (r->>'recalculated')::INT * 100 + (r->>'locked_alerts')::INT * 10 + (r->>'accepted')::INT FROM dry), 211,
            'dry run: 2 recalc, 1 locked alert, 1 accepted');
SELECT t.ok((SELECT q = (SELECT COUNT(*) FROM recalculation_queue)
                AND a = (SELECT COUNT(*) FROM sync_alerts)
                AND pms = (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s)
                AND tmt = (SELECT STRING_AGG(x::TEXT, '|' ORDER BY id) FROM task_monthly_totals x) FROM w),
            'dry run wrote nothing (queue, alerts, PMS, TMT)');

-- Range bounds are inclusive first-of-month bounds.
SELECT t.eq((reconcile_billing_months('2027-02-01', '2027-02-01', TRUE)->>'recalculated')::INT, 1, 'month range is inclusive');

-- Real run.
CREATE TEMP TABLE real1 AS SELECT reconcile_billing_months('2027-01-01', '2027-03-01', FALSE) r;
SELECT t.eq((SELECT r->>'status' FROM real1), 'ok', 'real run status ok');
SELECT t.eq((SELECT (r->>'recalculated')::INT * 100 + (r->>'locked_alerts')::INT * 10 + (r->>'persisting')::INT FROM real1), 210,
            'real run: 2 recalculated, 1 locked alert, 0 persisting');
SELECT t.eq((t.pms(t.pid('extP1'), '2027-02-01')).rounded_minutes, 180, 'open Feb healed');
SELECT t.eq((t.pms(t.pid('extPX'), '2027-03-01')).billed_revenue_cents, 0::BIGINT, 'deleted-at-source open month drops to $0');
SELECT t.eq((t.pms(t.pid('extP1'), '2027-01-01')).rounded_minutes, 60, 'locked Jan untouched');
SELECT t.eq((SELECT reason FROM recalculation_queue WHERE project_id = t.pid('extP1') AND queue_month = '2027-02-01' ORDER BY queued_at DESC LIMIT 1),
            'reconcile_drift', 'open drift queued with reason reconcile_drift');
SELECT t.eq(t.alerts('invoiced_month_source_changed'), 1, 'one locked-drift alert (accepted one suppressed)');
SELECT t.eq((SELECT entity_id FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'), t.pid('extP1')::TEXT || ':2027-01', 'alert on P1 Jan');

-- Second run: idempotent.
CREATE TEMP TABLE w2 AS SELECT (SELECT COUNT(*) FROM recalculation_queue) q,
       (SELECT STRING_AGG(a::TEXT, '|' ORDER BY id) FROM sync_alerts a) a,
       (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s) pms;
CREATE TEMP TABLE real2 AS SELECT reconcile_billing_months('2027-01-01', '2027-03-01', FALSE) r;
SELECT t.eq((SELECT (r->>'recalculated')::INT * 100 + (r->>'locked_alerts')::INT * 10 + (r->>'persisting')::INT FROM real2), 10,
            'second run: nothing to recalc, same single locked alert');
SELECT t.ok((SELECT q = (SELECT COUNT(*) FROM recalculation_queue)
                AND a = (SELECT STRING_AGG(x::TEXT, '|' ORDER BY id) FROM sync_alerts x)
                AND pms = (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s) FROM w2),
            'second run changed nothing (queue, alerts byte-identical, PMS)');

-- Stale TMT is rebuilt by a real run (and only reported by a dry run).
SET session_replication_role = replica;
UPDATE timesheet_daily_rollups SET total_minutes = 30, rounded_minutes = 30 WHERE task_id = 'tPMb';  -- member, Feb (open)
SET session_replication_role = origin;
SELECT t.eq((reconcile_billing_months('2027-02-01', '2027-02-01', TRUE)->'tmt_stale_months'), '[]'::JSONB, 'unchanged minutes => not stale');
SET session_replication_role = replica;
UPDATE timesheet_daily_rollups SET total_minutes = 60, rounded_minutes = 60 WHERE task_id = 'tPMb';
SET session_replication_role = origin;
SELECT t.eq((reconcile_billing_months('2027-02-01', '2027-02-01', TRUE)->'tmt_stale_months'), '["2027-02-01"]'::JSONB, 'dry run reports stale TMT month');
SELECT t.ok(EXISTS (SELECT 1 FROM validate_task_monthly_totals_vs_rollups('2027-02-01', '2027-02-01')), 'dry run left TMT stale');
CREATE TEMP TABLE real3 AS SELECT reconcile_billing_months('2027-02-01', '2027-02-01', FALSE) r;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM validate_task_monthly_totals_vs_rollups('2027-02-01', '2027-02-01')), 'real run rebuilt TMT');
SELECT t.eq((t.pms(t.pid('extPG'), '2027-02-01')).rounded_minutes, 60, 'and healed the member-fed primary month');

-- Persisting open drift -> status failed + alert.
CREATE OR REPLACE FUNCTION t.boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected'; END $$;
CREATE TRIGGER t_boom BEFORE UPDATE ON project_monthly_summary FOR EACH ROW EXECUTE FUNCTION t.boom();
SET session_replication_role = replica;
UPDATE timesheet_daily_rollups SET total_minutes = 240, rounded_minutes = 240 WHERE task_id = 'tP1b';
SET session_replication_role = origin;
CREATE TEMP TABLE real4 AS SELECT reconcile_billing_months('2027-02-01', '2027-02-01', FALSE) r;
SELECT t.eq((SELECT r->>'status' FROM real4), 'failed', 'persisting open drift => status failed');
SELECT t.eq((SELECT (r->>'persisting')::INT FROM real4), 1, 'persisting = 1');
SELECT t.eq(t.alerts('reconcile_drift_persisting'), 1, 'reconcile_drift_persisting alert');
SELECT t.eq(t.alerts('recalc_failed'), 1, 'and the underlying recalc_failed alert');
DROP TRIGGER t_boom ON project_monthly_summary;

-- Scheduled wrapper: an exception becomes a reconcile_failed alert.
SELECT t.eq((run_scheduled_billing_reconcile()->>'status'), 'ok', 'scheduled wrapper runs a full real reconcile');
ALTER FUNCTION reconcile_billing_months(DATE, DATE, BOOLEAN) RENAME TO reconcile_billing_months_hidden;
CREATE FUNCTION reconcile_billing_months(p_from DATE, p_to DATE, p_dry_run BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated outage'; END $$;
SELECT t.eq((run_scheduled_billing_reconcile()->>'status'), 'failed', 'wrapper returns failed on exception');
SELECT t.eq(t.alerts('reconcile_failed'), 1, 'reconcile_failed alert raised');

-- Privileges: only service_role may reconcile.
DROP FUNCTION reconcile_billing_months(DATE, DATE, BOOLEAN);
ALTER FUNCTION reconcile_billing_months_hidden(DATE, DATE, BOOLEAN) RENAME TO reconcile_billing_months;
SELECT t.ok(NOT has_function_privilege('authenticated', 'reconcile_billing_months(date,date,boolean)', 'EXECUTE'), 'authenticated cannot reconcile');
SELECT t.ok(NOT has_function_privilege('anon', 'reconcile_billing_months(date,date,boolean)', 'EXECUTE'), 'anon cannot reconcile');
SELECT t.ok(has_function_privilege('service_role', 'reconcile_billing_months(date,date,boolean)', 'EXECUTE'), 'service_role can reconcile');
SELECT t.ok(NOT has_function_privilege('anon', 'raise_billing_alert(text,text,text,jsonb,text)', 'EXECUTE'), 'anon cannot raise alerts');
SELECT t.ok(NOT has_function_privilege('anon', 'is_company_month_locked(uuid,date)', 'EXECUTE'), 'anon cannot probe locks');
