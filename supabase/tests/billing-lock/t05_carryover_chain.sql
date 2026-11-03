-- t05: NeoCurrency-shaped carryover chain. Once a later month is invoiced,
-- every earlier month of the chain is byte-identical whatever changes at
-- source; a cascade from an open month into a locked month stops and alerts
-- (migrations 134, 135, 138).
\ir lib/assert.sql
\ir fixtures/scenario.sql

-- Project N: min = max = 10h, carryover enabled (fixed-hours retainer).
SELECT t.upsert('n1', 'extN', '2027-01-05', 900, 'cN');   -- 15h -> billed 10, carry 5
SELECT t.upsert('n2', 'extN', '2027-02-05', 720, 'cN');   -- 12h + 5 -> billed 10, carry 7
SELECT t.upsert('n3', 'extN', '2027-03-05', 480, 'cN');   --  8h + 7 -> billed 10, carry 5
SELECT t.upsert('n4', 'extN', '2027-04-05', 540, 'cN');   --  9h + 5 -> billed 10, carry 4
INSERT INTO project_monthly_billing_limits (project_id, limits_month, minimum_hours, maximum_hours, carryover_enabled)
VALUES (t.pid('extN'), '2027-01-01', 10, 10, TRUE);
SELECT drain_recalculation_queue();
-- limits insert queued only Jan; walk the chain by cascade
SELECT drain_recalculation_queue();
SELECT t.eq((SELECT ARRAY_AGG(carryover_out_hours ORDER BY summary_month) FROM project_monthly_summary WHERE project_id = t.pid('extN') AND summary_month <= '2027-04-01'),
            ARRAY[5.00, 7.00, 5.00, 4.00]::NUMERIC[], 'carryover chain 5 / 7 / 5 / 4');
SELECT t.eq((SELECT ARRAY_AGG(billed_hours ORDER BY summary_month) FROM project_monthly_summary WHERE project_id = t.pid('extN') AND summary_month <= '2027-04-01'),
            ARRAY[10.00, 10.00, 10.00, 10.00]::NUMERIC[], 'billed 10h each month');

-- Invoice April -> Jan..Apr locked (carryover only flows forward).
SELECT t.invoice(t.cid('cN'), '2027-04-01');
CREATE TEMP TABLE chain_before AS SELECT t.billing_state(t.pid('extN')) AS s;
DELETE FROM sync_alerts;

-- Source changes in the middle of the chain + a config change at the start.
SELECT t.upsert('n2', 'extN', '2027-02-05', 360, 'cN');   -- Feb 12h -> 6h
UPDATE project_monthly_billing_limits SET maximum_hours = 12 WHERE project_id = t.pid('extN');
SELECT drain_recalculation_queue();
SELECT drain_recalculation_queue();
SELECT t.eq(t.billing_state(t.pid('extN')), (SELECT s FROM chain_before), 'whole chain (PMS + carryover rows) byte-identical');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM recalculation_queue WHERE project_id = t.pid('extN') AND processed_at IS NULL), 'nothing left queued');
SELECT t.ok((SELECT bool_and(outcome = 'skipped_locked') FROM recalculation_queue
              WHERE project_id = t.pid('extN') AND reason IN ('sync_update', 'limits_change')),
            'all chain items skipped_locked');
SELECT t.eq((SELECT ARRAY_AGG(entity_id ORDER BY entity_id) FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'),
            ARRAY[t.pid('extN')::TEXT || ':2027-01', t.pid('extN')::TEXT || ':2027-02'],
            'alerts only for the months whose result would change (Jan max change, Feb hours)');

-- Accepted variance on Feb suppresses its alert on re-check.
DELETE FROM sync_alerts;
INSERT INTO billing_accepted_variances (project_id, month, reason, decided_by) VALUES (t.pid('extN'), '2027-02-01', 'leave them', 'owner');
INSERT INTO recalculation_queue (project_id, queue_month, reason) VALUES (t.pid('extN'), '2027-02-01', 'sync_update');
SELECT drain_recalculation_queue();
SELECT t.eq(t.alerts('invoiced_month_source_changed'), 0, 'accepted chain month stays silent');
SELECT t.eq(t.billing_state(t.pid('extN')), (SELECT s FROM chain_before), 'chain still byte-identical');

-- Cascade from an OPEN month into a LOCKED month stops there -----------------
SELECT t.upsert('k1', 'extK', '2027-01-05', 900, 'cK');   -- 15h -> carry 5 into Feb
SELECT t.upsert('k2', 'extK', '2027-02-05', 600, 'cK');
INSERT INTO project_monthly_billing_limits (project_id, limits_month, minimum_hours, maximum_hours, carryover_enabled)
VALUES (t.pid('extK'), '2027-01-01', 10, 10, TRUE);
SELECT drain_recalculation_queue();
SELECT drain_recalculation_queue();
INSERT INTO billing_month_locks (company_id, month, reason) VALUES (t.cid('cK'), '2027-02-01', 'test: Feb closed manually');
CREATE TEMP TABLE k_feb AS SELECT t.month_state(t.pid('extK'), '2027-02-01') AS s;
DELETE FROM sync_alerts;
SELECT t.upsert('k1', 'extK', '2027-01-05', 1080, 'cK');  -- Jan 18h -> carry would be 8
SELECT drain_recalculation_queue();
SELECT t.eq((t.pms(t.pid('extK'), '2027-01-01')).carryover_out_hours, 8.00, 'open Jan recalculated (carryover out 8)');
SELECT t.eq((SELECT carryover_hours FROM project_carryover_hours WHERE project_id = t.pid('extK') AND source_month = '2027-01-01'),
            5.00, 'carryover row into locked Feb NOT rewritten');
SELECT t.eq(t.month_state(t.pid('extK'), '2027-02-01'), (SELECT s FROM k_feb), 'locked Feb byte-identical');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM recalculation_queue WHERE project_id = t.pid('extK') AND queue_month = '2027-02-01' AND processed_at IS NULL),
            'no cascade queued into locked Feb');
SELECT t.eq((SELECT metadata->>'reason' FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'
              AND entity_id = t.pid('extK')::TEXT || ':2027-02'), 'carryover_cascade', 'Feb alerted with reason carryover_cascade');
