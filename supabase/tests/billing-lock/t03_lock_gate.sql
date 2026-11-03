-- t03: locked months are never written automatically; exactly one alert;
-- accepted variances stay silent; open months recalc; explicit owner
-- override (migrations 134, 135, 138).
\ir lib/assert.sql
\ir fixtures/scenario.sql

-- Lock predicates -------------------------------------------------------------
SELECT t.invoice(t.cid('cA'), '2027-02-01');
SELECT t.ok(is_company_month_locked(t.cid('cA'), '2027-02-01'), 'invoiced month locked');
SELECT t.ok(is_company_month_locked(t.cid('cA'), '2027-01-15'), 'earlier month locked by a later invoice');
SELECT t.ok(NOT is_company_month_locked(t.cid('cA'), '2027-03-01'), 'later month open');
SELECT t.ok(is_company_month_locked(t.cid('cA'), '2026-09-01'), 'month <= billing_closed_through locked by date');
SELECT t.ok(is_company_month_locked(NULL, '2026-05-01'), 'date lock applies even without a company');
SELECT t.ok(is_billing_month_locked(t.pid('extPM'), '2027-01-01'), 'member project resolves to primary''s company');

-- 'failed'/'error' invoices do not lock; 'pending' does
INSERT INTO qbo_invoice_log (company_id, report_year, report_month, qbo_customer_id, status)
VALUES (t.cid('cA'), 2027, 3, 'qbo-test', 'error');
SELECT t.ok(NOT is_company_month_locked(t.cid('cA'), '2027-03-01'), 'error-status invoice does not lock');
UPDATE qbo_invoice_log SET status = 'pending' WHERE report_month = 3 AND report_year = 2027;
SELECT t.ok(is_company_month_locked(t.cid('cA'), '2027-03-01'), 'pending invoice locks');
DELETE FROM qbo_invoice_log WHERE report_month = 3 AND report_year = 2027;

-- Company family: an invoice logged under a MEMBER company locks the primary's projects
INSERT INTO companies (client_id, client_name) VALUES ('cOld', 'Old Co');
INSERT INTO company_groups (id, primary_company_id) VALUES ('00000000-0000-0000-0000-0000000000c1', t.cid('cA'));
INSERT INTO company_group_members (group_id, member_company_id) VALUES ('00000000-0000-0000-0000-0000000000c1', t.cid('cOld'));
SELECT t.clear_queue();
SELECT t.invoice(t.cid('cOld'), '2027-03-01');
SELECT t.ok(is_billing_month_locked(t.pid('extP1'), '2027-03-01'), 'invoice under member company locks primary company''s month');
DELETE FROM qbo_invoice_log WHERE company_id = t.cid('cOld');
SELECT t.ok(NOT is_billing_month_locked(t.pid('extP1'), '2027-03-01'), 'unlocked again');

-- Manual lock
INSERT INTO billing_month_locks (company_id, month, reason) VALUES (t.cid('cOld'), '2027-04-01', 'test');
SELECT t.ok(is_company_month_locked(t.cid('cA'), '2027-04-01'), 'manual lock on a family member locks the family');
DELETE FROM billing_month_locks;

-- Locked month: source change -> no write, one alert ---------------------------
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

-- Second change + second drain -> still exactly one alert (upsert), title refreshed
UPDATE sync_alerts SET dismissed_at = NOW() WHERE alert_type = 'invoiced_month_source_changed';
SELECT t.upsert('tP1a', 'extP1', '2027-01-10', 105);
SELECT drain_recalculation_queue();
SELECT t.eq(t.alerts('invoiced_month_source_changed'), 1, 'still exactly one alert after a second drain');
SELECT t.ok((SELECT dismissed_at IS NULL FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'),
            'changed title re-surfaces a dismissed alert');
-- Same source, drained again -> nothing changes on the alert
CREATE TEMP TABLE alert_before AS SELECT updated_at, title FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed';
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extP1'), '2027-01-01', 'sync_update');
SELECT drain_recalculation_queue();
SELECT t.ok((SELECT a.updated_at = b.updated_at FROM sync_alerts a, alert_before b WHERE a.alert_type = 'invoiced_month_source_changed'),
            'identical repeat leaves the alert untouched');
SELECT t.eq(t.billing_state(t.pid('extP1')), (SELECT s FROM before_state), 'locked Jan still byte-identical');

-- Config trigger (rate change) on a locked month with NO effective change: no write, no new alert
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

-- Direct call of the writer (materialize-billing-floor / recalculate_month path) is gated too
SELECT recalculate_project_month(t.pid('extP2'), '2027-01-01');
SELECT recalculate_month('2027-02-01');
SELECT t.eq(t.billing_state(t.pid('extP2')), (SELECT s FROM p2_before), 'direct recalculate_project_month / recalculate_month gated');

-- Accepted variance -> no alert
INSERT INTO billing_accepted_variances (project_id, month, reason, decided_by)
VALUES (t.pid('extPG'), '2027-02-01', 'test', 'owner');
SELECT t.upsert('tPMb', 'extPM', '2027-02-06', 75);   -- member change -> primary PG Feb (locked)
SELECT drain_recalculation_queue();
SELECT t.eq((SELECT COUNT(*)::INT FROM sync_alerts WHERE entity_id = t.pid('extPG')::TEXT || ':2027-02'), 0, 'accepted variance raises no alert');
SELECT t.eq((t.pms(t.pid('extPG'), '2027-02-01')).rounded_minutes, 30, 'accepted variance month still not written');

-- Open month recalculates normally
SELECT t.upsert('tP1c', 'extP1', '2027-03-10', 150);
SELECT drain_recalculation_queue();
SELECT t.eq((t.pms(t.pid('extP1'), '2027-03-01')).rounded_minutes, 150, 'open month recalculated');
SELECT t.eq((SELECT outcome FROM recalculation_queue WHERE project_id = t.pid('extP1') AND queue_month = '2027-03-01' ORDER BY queued_at DESC LIMIT 1),
            'recalculated', 'outcome recalculated');

-- Fixed billing + milestone gate --------------------------------------------
INSERT INTO billings (id, company_id, name, type) VALUES ('00000000-0000-0000-0000-0000000000b1', t.cid('cA'), 'Retainer', 'service_fee');
INSERT INTO billings (id, company_id, name, type, linked_project_id) VALUES ('00000000-0000-0000-0000-0000000000b2', t.cid('cA'), 'Milestone', 'revenue_milestone', t.pid('extP1'));
SELECT t.eq((SELECT COUNT(*)::INT FROM monthly_fixed_billing_summary), 0, 'no fixed billing yet');
INSERT INTO billing_transactions (billing_id, transaction_month, amount_cents, description)
VALUES ('00000000-0000-0000-0000-0000000000b1', '2027-02-01', 50000, 'locked month fee'),
       ('00000000-0000-0000-0000-0000000000b1', '2027-03-01', 70000, 'open month fee'),
       ('00000000-0000-0000-0000-0000000000b2', '2027-02-01', 99900, 'locked milestone'),
       ('00000000-0000-0000-0000-0000000000b2', '2027-03-01', 12300, 'open milestone');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM monthly_fixed_billing_summary WHERE summary_month = '2027-02-01'), 'locked month fixed billing not written');
SELECT t.eq((SELECT fixed_billing_cents FROM monthly_fixed_billing_summary WHERE summary_month = '2027-03-01'), 70000::BIGINT, 'open month fixed billing written');
SELECT t.ok((t.pms(t.pid('extP1'), '2027-02-01')).milestone_override_cents IS NULL, 'locked month milestone override not written');
SELECT t.eq((t.pms(t.pid('extP1'), '2027-03-01')).milestone_override_cents, 12300::BIGINT, 'open month milestone override written');
SELECT t.ok(EXISTS (SELECT 1 FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'
                     AND entity_id = t.cid('cA')::TEXT || ':2027-02' AND metadata->>'scope' = 'fixed_billing'),
            'fixed billing alert for locked company-month');
SELECT t.ok(EXISTS (SELECT 1 FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'
                     AND entity_id = t.pid('extP1')::TEXT || ':2027-02' AND metadata ? 'milestone_override_new_cents'),
            'milestone alert for locked project-month');

-- Manual override -------------------------------------------------------------
-- Without the setting: gated.
SELECT recalculate_project_month(t.pid('extP1'), '2027-01-01');
SELECT t.eq(t.month_state(t.pid('extP1'), '2027-01-01'), (SELECT jan FROM before_state), 'no override => locked month untouched');
-- Setting present but session login is not a postgres member: ignored.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bl_api_like') THEN CREATE ROLE bl_api_like LOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA t TO bl_api_like;
GRANT authenticated TO bl_api_like;   -- like PostgREST's authenticator -> authenticated
BEGIN;
SET LOCAL manifest.allow_locked_recalc = 'on';
SET LOCAL SESSION AUTHORIZATION bl_api_like;
SELECT t.ok(NOT billing_locked_recalc_override(), 'override ignored for a non-postgres login (API sessions)');
RESET SESSION AUTHORIZATION;
COMMIT;
-- Explicit owner override: recalculates the locked month and leaves an audit alert.
BEGIN;
SET LOCAL manifest.allow_locked_recalc = 'on';
SELECT t.ok(billing_locked_recalc_override(), 'override active for postgres login with SET LOCAL');
SELECT recalculate_project_month(t.pid('extP1'), '2027-01-01');
COMMIT;
SELECT t.eq((t.pms(t.pid('extP1'), '2027-01-01')).rounded_minutes, 105, 'override recalculated the locked month (60 -> 105)');
SELECT t.eq(t.alerts('locked_month_override_recalc'), 1, 'override use recorded as an alert');
-- SET LOCAL ended with the transaction: gated again.
SELECT t.ok(NOT billing_locked_recalc_override(), 'override does not outlive its transaction');
-- Override through the drain marks the outcome
BEGIN;
SET LOCAL manifest.allow_locked_recalc = 'on';
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extP2'), '2027-01-01', 'manual');
SELECT drain_recalculation_queue();
COMMIT;
SELECT t.eq((SELECT outcome FROM recalculation_queue WHERE project_id = t.pid('extP2') AND reason = 'manual'), 'recalculated_override', 'drain outcome recalculated_override');
