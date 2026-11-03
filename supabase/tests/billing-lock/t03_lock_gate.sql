-- t03: lock predicates (invoice log, persisted invoice locks, date, manual,
-- company family); locked months are never written automatically; exactly
-- one alert; accepted variances stay silent only while they still match;
-- open months recalc; fixed billing gate (also as `authenticated`);
-- eom_report_stale from fixed billing; explicit owner override
-- (migrations 134, 135, 138).
\ir lib/assert.sql
\ir fixtures/scenario.sql

-- Lock predicates on a separate company cZ ------------------------------------
INSERT INTO companies (client_id, client_name) VALUES ('cZ', 'Z Co'), ('cZold', 'Z Old Co');
SELECT t.ok(NOT is_company_month_locked(t.cid('cZ'), '2027-03-01'), 'cZ open before any invoice');
SELECT t.ok(is_company_month_locked(t.cid('cZ'), '2026-09-01'), 'month <= billing_closed_through locked by date');
SELECT t.ok(is_company_month_locked(NULL, '2026-05-01'), 'date lock applies even without a company');

-- pending locks while pending, is not persisted; pending -> error (no QBO id) unlocks
INSERT INTO qbo_invoice_log (company_id, report_year, report_month, qbo_customer_id, status)
VALUES (t.cid('cZ'), 2027, 3, 'qbo-test', 'pending');
SELECT t.ok(is_company_month_locked(t.cid('cZ'), '2027-03-01'), 'pending invoice locks its month');
SELECT t.ok(is_company_month_locked(t.cid('cZ'), '2027-02-01'), 'pending invoice locks earlier months');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM billing_month_locks WHERE company_id = t.cid('cZ')), 'pending is not persisted as a lock');
UPDATE qbo_invoice_log SET status = 'error' WHERE company_id = t.cid('cZ');
SELECT t.ok(NOT is_company_month_locked(t.cid('cZ'), '2027-03-01'), 'pending -> error without QBO id unlocks');

-- pending -> error WITH a QBO invoice id stays locked (invoice exists in QBO), persisted
UPDATE qbo_invoice_log SET status = 'pending' WHERE company_id = t.cid('cZ');
UPDATE qbo_invoice_log SET status = 'error', qbo_invoice_id = 'QB-77', invoice_number = '1077' WHERE company_id = t.cid('cZ');
SELECT t.ok(is_company_month_locked(t.cid('cZ'), '2027-03-01'), 'pending -> error with a QBO id stays locked');
SELECT t.eq((SELECT reason || '|' || source FROM billing_month_locks WHERE company_id = t.cid('cZ')), 'qbo_invoice 1077 error|qbo_invoice',
            'lock persisted from the QBO id');

-- persisted lock survives deletion of the log row and locks earlier months
DELETE FROM qbo_invoice_log WHERE company_id = t.cid('cZ');
SELECT t.ok(is_company_month_locked(t.cid('cZ'), '2027-03-01'), 'persisted invoice lock survives log deletion');
SELECT t.ok(is_company_month_locked(t.cid('cZ'), '2027-01-01'), 'persisted invoice lock locks earlier months');
SELECT t.ok(NOT is_company_month_locked(t.cid('cZ'), '2027-04-01'), 'later month open');
SELECT t.eq(billing_month_lock_reason(t.cid('cZ'), '2027-01-01'), 'invoice_lock:2027-03', 'lock reason names the invoice month');

-- 'sent' persists a lock via the trigger
SELECT t.invoice(t.cid('cZ'), '2027-05-01');
SELECT t.eq((SELECT source FROM billing_month_locks WHERE company_id = t.cid('cZ') AND month = '2027-05-01'), 'qbo_invoice', 'sent invoice persisted');

-- Company family: invoice under a MEMBER company locks the primary's months
INSERT INTO company_groups (id, primary_company_id) VALUES ('00000000-0000-0000-0000-0000000000c2', t.cid('cZ'));
INSERT INTO company_group_members (group_id, member_company_id) VALUES ('00000000-0000-0000-0000-0000000000c2', t.cid('cZold'));
SELECT t.invoice(t.cid('cZold'), '2027-08-01');
SELECT t.ok(is_company_month_locked(t.cid('cZ'), '2027-07-01'), 'invoice under member company locks the primary family');

-- Manual lock: exact month only
INSERT INTO billing_month_locks (company_id, month, reason) VALUES (t.cid('cA'), '2027-06-01', 'test');
SELECT t.ok(is_company_month_locked(t.cid('cA'), '2027-06-01'), 'manual lock locks its month');
SELECT t.ok(NOT is_company_month_locked(t.cid('cA'), '2027-05-01'), 'manual lock does not lock earlier months');
DELETE FROM billing_month_locks WHERE company_id = t.cid('cA');
SELECT t.clear_queue();
DELETE FROM sync_alerts;

-- Company cA: Feb invoiced -> Jan, Feb locked; Mar open ------------------------
SELECT t.invoice(t.cid('cA'), '2027-02-01');
SELECT t.ok(is_billing_month_locked(t.pid('extPM'), '2027-01-01'), 'member project resolves to primary''s company');

-- Locked month: source change -> no write, one alert
CREATE TEMP TABLE before_state AS SELECT t.billing_state(t.pid('extP1')) AS s, t.month_state(t.pid('extP1'), '2027-01-01') AS jan;
SELECT t.upsert('tP1a', 'extP1', '2027-01-10', 90);           -- Jan (locked) 60 -> 90
SELECT drain_recalculation_queue();
SELECT t.eq(t.billing_state(t.pid('extP1')), (SELECT s FROM before_state), 'locked Jan PMS/carryover byte-identical');
SELECT t.eq((SELECT outcome FROM recalculation_queue WHERE project_id = t.pid('extP1') AND queue_month = '2027-01-01' ORDER BY queued_at DESC LIMIT 1),
            'skipped_locked', 'queue outcome skipped_locked');
SELECT t.eq(t.alerts('invoiced_month_source_changed'), 1, 'exactly one invoiced_month_source_changed alert');
SELECT t.eq((SELECT entity_id FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'),
            t.pid('extP1')::TEXT || ':2027-01', 'entity_id is <project uuid>:<YYYY-MM>');
SELECT t.ok((SELECT metadata ?& ARRAY['pms_min', 'tmt_min', 'reason', 'company_id'] FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'),
            'metadata has pms_min, tmt_min, reason, company_id');
SELECT t.eq((SELECT (metadata->>'pms_min')::INT * 1000 + (metadata->>'tmt_min')::INT FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'),
            60 * 1000 + 90, 'pms_min 60 / tmt_min 90');

-- Second change + second drain -> still exactly one alert (upsert), dismissal cleared
UPDATE sync_alerts SET dismissed_at = NOW() WHERE alert_type = 'invoiced_month_source_changed';
SELECT t.upsert('tP1a', 'extP1', '2027-01-10', 105);
SELECT drain_recalculation_queue();
SELECT t.eq(t.alerts('invoiced_month_source_changed'), 1, 'still exactly one alert after a second drain');
SELECT t.ok((SELECT dismissed_at IS NULL FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'),
            'changed title re-surfaces a dismissed alert');
-- Same source, drained again with the same reason -> alert untouched
CREATE TEMP TABLE alert_before AS SELECT updated_at FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed';
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extP1'), '2027-01-01', 'sync_update');
SELECT drain_recalculation_queue();
SELECT t.ok((SELECT a.updated_at = b.updated_at FROM sync_alerts a, alert_before b WHERE a.alert_type = 'invoiced_month_source_changed'),
            'identical repeat leaves the alert untouched');
SELECT t.eq(t.billing_state(t.pid('extP1')), (SELECT s FROM before_state), 'locked Jan still byte-identical');

-- Config trigger on a locked month with NO effective change: no write, no alert
INSERT INTO project_monthly_rates (project_id, rate_month, rate) VALUES (t.pid('extP2'), '2027-01-01', 45);
CREATE TEMP TABLE p2_before AS SELECT t.billing_state(t.pid('extP2')) AS s;
SELECT drain_recalculation_queue();
SELECT t.eq(t.billing_state(t.pid('extP2')), (SELECT s FROM p2_before), 'locked month untouched by rate trigger');
SELECT t.eq(t.alerts('invoiced_month_source_changed'), 1, 'no alert when the would-be result is unchanged');
-- ...and WITH an effective change: alert, still no write
UPDATE project_monthly_rates SET rate = 100 WHERE project_id = t.pid('extP2');
SELECT drain_recalculation_queue();
SELECT t.eq(t.billing_state(t.pid('extP2')), (SELECT s FROM p2_before), 'locked month untouched by effective rate change');
SELECT t.eq(t.alerts('invoiced_month_source_changed'), 2, 'rate change on locked month alerts');

-- Direct writer calls (materialize-billing-floor / recalculate_month path) are gated too
SELECT recalculate_project_month(t.pid('extP2'), '2027-01-01');
SELECT recalculate_month('2027-02-01');
SELECT t.eq(t.billing_state(t.pid('extP2')), (SELECT s FROM p2_before), 'direct recalculate_project_month / recalculate_month gated');

-- Accepted variance: silent only while the accepted values still match ------
SELECT t.upsert('tPMb', 'extPM', '2027-02-06', 75);   -- member change -> primary PG Feb (locked)
SELECT drain_recalculation_queue();
SELECT t.eq((SELECT COUNT(*)::INT FROM sync_alerts WHERE entity_id = t.pid('extPG')::TEXT || ':2027-02'), 1, 'PG Feb alerts before acceptance');
DELETE FROM sync_alerts WHERE entity_id = t.pid('extPG')::TEXT || ':2027-02';
SELECT accept_billing_variance(t.pid('extPG'), '2027-02-01', 'test: leave it', 'owner');
SELECT t.eq((SELECT accepted_pms_min || '/' || accepted_tmt_min FROM billing_accepted_variances WHERE project_id = t.pid('extPG')),
            '30/75', 'accepted values recorded (stored 30, source 75)');
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extPG'), '2027-02-01', 'sync_update');
SELECT drain_recalculation_queue();
SELECT t.eq((SELECT COUNT(*)::INT FROM sync_alerts WHERE entity_id = t.pid('extPG')::TEXT || ':2027-02'), 0, 'matching accepted variance raises no alert');
SELECT t.upsert('tPMb', 'extPM', '2027-02-06', 90);   -- source moves again
SELECT drain_recalculation_queue();
SELECT t.eq((SELECT COUNT(*)::INT FROM sync_alerts WHERE entity_id = t.pid('extPG')::TEXT || ':2027-02'), 1, 'further change after acceptance alerts again');
SELECT t.eq((t.pms(t.pid('extPG'), '2027-02-01')).rounded_minutes, 30, 'accepted-variance month never written');

-- Open month recalculates normally
SELECT t.upsert('tP1c', 'extP1', '2027-03-10', 150);
SELECT drain_recalculation_queue();
SELECT t.eq((t.pms(t.pid('extP1'), '2027-03-01')).rounded_minutes, 150, 'open month recalculated');
SELECT t.eq((SELECT outcome FROM recalculation_queue WHERE project_id = t.pid('extP1') AND queue_month = '2027-03-01' ORDER BY queued_at DESC LIMIT 1),
            'recalculated', 'outcome recalculated');

-- Fixed billing + milestone gate, edited as an authenticated admin -----------
INSERT INTO billings (id, company_id, name, type) VALUES ('00000000-0000-0000-0000-0000000000b1', t.cid('cA'), 'Retainer', 'service_fee');
INSERT INTO billings (id, company_id, name, type, linked_project_id) VALUES ('00000000-0000-0000-0000-0000000000b2', t.cid('cA'), 'Milestone', 'revenue_milestone', t.pid('extP1'));
INSERT INTO eom_reports (report_year, report_month, company_id, company_name, total_hours, total_revenue_cents, project_count, storage_path)
VALUES (2027, 3, t.cid('cA'), 'Client cA', 1, 1, 1, 'x.csv');
DELETE FROM sync_alerts WHERE alert_type = 'eom_report_stale';
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ('00000000-0000-0000-0000-00000000ad01', 'admin@test', '{"role":"admin"}');
-- (a) the UI path: SECURITY DEFINER RPC called by an authenticated admin
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ad01';
SELECT create_billing_transaction('00000000-0000-0000-0000-0000000000b1', '2027-02-01', 50000, 'locked month fee');
SELECT create_billing_transaction('00000000-0000-0000-0000-0000000000b1', '2027-03-01', 70000, 'open month fee');
SELECT create_billing_transaction('00000000-0000-0000-0000-0000000000b2', '2027-03-01', 12300, 'open milestone');
COMMIT;
-- (b) a direct RLS write (admin policy) into a LOCKED month: the invoker-rights
-- recalculate_fixed_billing_month must alert without a permission error
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ad01';
INSERT INTO billing_transactions (billing_id, transaction_month, amount_cents, description)
VALUES ('00000000-0000-0000-0000-0000000000b2', '2027-02-01', 99900, 'locked milestone');
COMMIT;
SELECT t.ok(TRUE, 'authenticated admin can edit billing transactions of a locked month (no permission error)');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM monthly_fixed_billing_summary WHERE summary_month = '2027-02-01'), 'locked month fixed billing not written');
SELECT t.ok(EXISTS (SELECT 1 FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'
                     AND entity_id = t.cid('cA')::TEXT || ':2027-02' AND metadata->>'scope' = 'fixed_billing'),
            'fixed billing alert for locked company-month');
SELECT t.ok(EXISTS (SELECT 1 FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'
                     AND entity_id = t.pid('extP1')::TEXT || ':2027-02' AND metadata ? 'milestone_override_new_cents'),
            'milestone alert for locked project-month');
SELECT t.ok((t.pms(t.pid('extP1'), '2027-02-01')).milestone_override_cents IS NULL, 'locked month milestone override not written');
SELECT t.eq((SELECT jsonb_object_keys_count FROM (SELECT COUNT(*)::INT AS jsonb_object_keys_count FROM sync_alerts a, JSONB_OBJECT_KEYS(a.metadata->'changes')
              WHERE a.alert_type = 'eom_report_stale' AND a.entity_id = t.cid('cA')::TEXT || ':2027-03') x), 2,
            'open reported month: fixed + milestone change raise one eom_report_stale (2 changes)');
SELECT t.eq((SELECT fixed_billing_cents FROM monthly_fixed_billing_summary WHERE summary_month = '2027-03-01'), 70000::BIGINT, 'open month fixed billing written');
SELECT t.eq((t.pms(t.pid('extP1'), '2027-03-01')).milestone_override_cents, 12300::BIGINT, 'open month milestone override written');
SELECT t.ok(NOT has_function_privilege('authenticated', 'billing_lock_gate(uuid,date,text,jsonb)', 'EXECUTE'), 'authenticated cannot call billing_lock_gate');
SELECT t.ok(NOT has_function_privilege('authenticated', 'billing_project_month_compare(uuid,date)', 'EXECUTE'), 'authenticated cannot call compare');
SELECT t.ok(NOT has_function_privilege('authenticated', 'sync_project_carryover(uuid,date,numeric,numeric,numeric)', 'EXECUTE'), 'authenticated cannot call sync_project_carryover');
SELECT t.ok(NOT has_function_privilege('anon', 'drain_recalculation_queue_authenticated(integer)', 'EXECUTE'), 'anon cannot call the drain wrapper');
SELECT t.ok(has_function_privilege('authenticated', 'drain_recalculation_queue_authenticated(integer)', 'EXECUTE'), 'authenticated keeps the drain wrapper');

-- Manual override -------------------------------------------------------------
SELECT recalculate_project_month(t.pid('extP1'), '2027-01-01');
SELECT t.eq(t.month_state(t.pid('extP1'), '2027-01-01'), (SELECT jan FROM before_state), 'no override => locked month untouched');
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bl_api_like') THEN CREATE ROLE bl_api_like LOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA t TO bl_api_like;
GRANT authenticated TO bl_api_like;   -- like PostgREST's authenticator -> authenticated
BEGIN;
SET LOCAL manifest.allow_locked_recalc = 'on';
SET LOCAL SESSION AUTHORIZATION bl_api_like;
SELECT t.ok(NOT billing_locked_recalc_override(), 'override ignored for a non-postgres login (API sessions)');
RESET SESSION AUTHORIZATION;
COMMIT;
BEGIN;
SET LOCAL manifest.allow_locked_recalc = 'on';
SELECT t.ok(billing_locked_recalc_override(), 'override active for postgres login with SET LOCAL');
SELECT recalculate_project_month(t.pid('extP1'), '2027-01-01');
COMMIT;
SELECT t.eq((t.pms(t.pid('extP1'), '2027-01-01')).rounded_minutes, 105, 'override recalculated the locked month (60 -> 105)');
SELECT t.eq(t.alerts('locked_month_override_recalc'), 1, 'override use recorded as an alert');
SELECT t.ok(NOT billing_locked_recalc_override(), 'override does not outlive its transaction');
BEGIN;
SET LOCAL manifest.allow_locked_recalc = 'on';
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extP2'), '2027-01-01', 'manual');
SELECT drain_recalculation_queue();
COMMIT;
SELECT t.eq((SELECT outcome FROM recalculation_queue WHERE project_id = t.pid('extP2') AND reason = 'manual'), 'recalculated_override', 'drain outcome recalculated_override');
