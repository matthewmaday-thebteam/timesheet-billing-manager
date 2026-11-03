-- s01 (snapshot): worst case — every canonical project-month and every
-- fixed-billing month is pushed through the writers after migrations
-- 134-140. Every locked month must stay byte-identical and the owner's
-- verification fixtures must hold. Needs SNAPSHOT_TEMPLATE (read-only prod
-- extract; t_before.* captured by snapshot/capture_before.sql).
\ir lib/assert.sql

-- Fixture helper: company-month total = Σ COALESCE(milestone override, billed) + fixed billing.
CREATE OR REPLACE FUNCTION t.company_total(p_client TEXT, p_month DATE) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    SELECT (SELECT SUM(COALESCE(s.milestone_override_cents, s.billed_revenue_cents))
              FROM v_canonical_project_monthly_summary s
             WHERE s.company_id = c.id AND s.summary_month = p_month)::BIGINT
         + COALESCE((SELECT SUM(f.fixed_billing_cents) FROM monthly_fixed_billing_summary f
                      WHERE f.company_id IN (SELECT company_id FROM billing_company_family(c.id))
                        AND f.summary_month = p_month), 0)::BIGINT
      FROM companies c
     WHERE c.client_name = p_client
       AND NOT EXISTS (SELECT 1 FROM company_group_members m WHERE m.member_company_id = c.id)
$$;
CREATE OR REPLACE FUNCTION t.company_hours(p_client TEXT, p_month DATE) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT SUM(s.billed_hours) FROM companies c
      JOIN v_canonical_project_monthly_summary s ON s.company_id = c.id AND s.summary_month = p_month
     WHERE c.client_name = p_client
       AND NOT EXISTS (SELECT 1 FROM company_group_members m WHERE m.member_company_id = c.id)
$$;
CREATE OR REPLACE FUNCTION t.proj(p_name TEXT, p_month DATE) RETURNS project_monthly_summary
LANGUAGE sql STABLE AS $$
    SELECT s.* FROM project_monthly_summary s JOIN projects p ON p.id = s.project_id
     WHERE p.project_name = p_name AND s.summary_month = p_month
       AND NOT EXISTS (SELECT 1 FROM project_group_members m WHERE m.member_project_id = p.id)
$$;
CREATE OR REPLACE FUNCTION t.check_fixtures(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    PERFORM t.eq(t.company_hours('All Comunity Events', '2026-10-01'), 43.75, p_label || ': ACE Oct 43.75h');
    PERFORM t.eq(t.company_total('All Comunity Events', '2026-10-01'), 175000::BIGINT, p_label || ': ACE Oct $1,750.00');
    PERFORM t.eq(t.company_hours('True Productions', '2026-10-01'), 509.50, p_label || ': True Productions Oct 509.50h');
    PERFORM t.eq(t.company_total('True Productions', '2026-10-01'), 3977000::BIGINT, p_label || ': True Productions Oct $39,770.00');
    PERFORM t.eq((t.proj('Fluffy Feather Farm', '2026-10-01')).milestone_override_cents, 3500000::BIGINT, p_label || ': FFF Oct override $35,000');
    PERFORM t.eq((t.proj('ZoneCoach', '2026-10-01')).billed_hours, 70.00, p_label || ': ZoneCoach Oct billed 70.00');
    PERFORM t.eq((t.proj('ZoneCoach', '2026-10-01')).carryover_out_hours, 113.50, p_label || ': ZoneCoach Oct carryover out 113.50');
    PERFORM t.eq((t.proj('ZoneCoach', '2026-10-01')).milestone_override_cents, 0::BIGINT, p_label || ': ZoneCoach Oct override 0');
    PERFORM t.eq(t.company_hours('NeoCurrency', '2026-10-01'), 1160.00, p_label || ': NeoCurrency Oct 1,160.00h');
    PERFORM t.eq(t.company_total('NeoCurrency', '2026-10-01'), 6148000::BIGINT, p_label || ': NeoCurrency Oct $61,480.00');
    PERFORM t.eq((t.proj('NeoCurrency', '2026-07-01')).rounded_hours, 1444.50, p_label || ': NeoCurrency Jul PMS rounded 1,444.50h');
    PERFORM t.eq((t.proj('NeoCurrency', '2026-07-01')).carryover_out_hours, 556.20, p_label || ': NeoCurrency Jul carryover out 556.20');
    PERFORM t.eq((t.proj('ZoneCoach', '2026-09-01')).carryover_out_hours, 118.50, p_label || ': ZoneCoach Sep carryover out 118.50');
    PERFORM t.eq(t.company_total('Taggable', '2026-10-01'), 1582500::BIGINT, p_label || ': Taggable Oct $15,825.00');
    PERFORM t.eq(t.company_total('Third Party Pet', '2026-10-01'), 1167750::BIGINT, p_label || ': Third Party Pet Oct $11,677.50');
END $$;

SELECT t.check_fixtures('before');

-- Push everything through the writers.
INSERT INTO recalculation_queue (project_id, queue_month, reason)
SELECT DISTINCT s.project_id, s.summary_month, 'rate_change'
  FROM v_canonical_project_monthly_summary s
ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL DO NOTHING;
SELECT drain_recalculation_queue(50);
SELECT drain_recalculation_queue(50);
SELECT recalculate_fixed_billing_month(m::DATE) FROM generate_series('2026-01-01'::DATE, '2026-11-01', '1 month') m;
SELECT t.eq((SELECT COUNT(*)::INT FROM recalculation_queue WHERE processed_at IS NULL), 0, 'queue fully drained');
SELECT t.eq((SELECT COUNT(*)::INT FROM recalculation_queue WHERE outcome = 'failed'), 0, 'no recalc failures');

-- Locked months byte-identical.
SELECT t.eq((SELECT COUNT(*)::INT FROM t_before.pms b
              WHERE billing_month_lock_reason(b.company_id, b.summary_month) IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM project_monthly_summary s WHERE s.id = b.id AND s::TEXT = b::TEXT)),
            0, 'every locked-month PMS row byte-identical (incl. calculated_at/updated_at)');
SELECT t.eq((SELECT COUNT(*)::INT FROM project_monthly_summary s
              WHERE billing_month_lock_reason(s.company_id, s.summary_month) IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM t_before.pms b WHERE b.id = s.id)),
            0, 'no new PMS rows in locked months');
SELECT t.eq((SELECT COUNT(*)::INT FROM t_before.pch b JOIN projects p ON p.id = b.project_id
              WHERE (billing_month_lock_reason(p.company_id, b.carryover_month) IS NOT NULL
                     OR billing_month_lock_reason(p.company_id, b.source_month) IS NOT NULL)
                AND NOT EXISTS (SELECT 1 FROM project_carryover_hours c WHERE c.id = b.id AND c::TEXT = b::TEXT)),
            0, 'every carryover row touching a locked month byte-identical');
SELECT t.eq((SELECT COUNT(*)::INT FROM t_before.mfbs b
              WHERE billing_month_lock_reason(b.company_id, b.summary_month) IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM monthly_fixed_billing_summary f WHERE f.id = b.id AND f::TEXT = b::TEXT)),
            0, 'every locked fixed-billing row byte-identical');
SELECT t.ok((SELECT (s::TEXT) = (b::TEXT) FROM project_monthly_summary s JOIN t_before.pms b ON b.id = s.id
              JOIN projects p ON p.id = s.project_id WHERE p.project_name = 'NeoCurrency' AND s.summary_month = '2026-07-01'),
            'NeoCurrency Jul 2026 row byte-identical ("leave them")');

SELECT t.check_fixtures('after mass recalc');

-- Alerts: exactly the locked drift we know about (accepted ones silent).
SELECT t.eq((SELECT ARRAY_AGG(p.project_name || ' ' || SPLIT_PART(a.entity_id, ':', 2) ORDER BY p.project_name, a.entity_id)
               FROM sync_alerts a JOIN projects p ON p.id::TEXT = SPLIT_PART(a.entity_id, ':', 1)
              WHERE a.alert_type = 'invoiced_month_source_changed'),
            ARRAY['Enrollment App 2026-01', 'FCS0001 - Customer and Employee Dashboard 2026-03',
                  'Fluffy Feather Farm 2026-09', 'Fluffy Feather Farm 2026-10', 'Management Automations 2026-06',
                  'ZoneCoach 2026-05', 'ZoneCoach 2026-09'],
            'invoiced_month_source_changed alerts = known locked drift only');
-- The two milestone alerts only appear because this test forces
-- recalculate_fixed_billing_month over every 2026 month: before 135 that call
-- would have set milestone_override_cents NULL -> 0 on those invoiced months
-- (a linked milestone billing with no transaction that month), zeroing their
-- revenue. The gate blocked it and alerted instead.
SELECT t.eq((SELECT COUNT(*)::INT FROM sync_alerts WHERE alert_type = 'invoiced_month_source_changed'
               AND metadata->>'reason' = 'fixed_billing_milestone'), 2, 'milestone NULL -> 0 rewrites of invoiced months blocked');
SELECT t.eq(t.alerts('recalc_failed') + t.alerts('tmt_rebuild_failed') + t.alerts('recalc_cascade_limit'), 0, 'no failure alerts');
