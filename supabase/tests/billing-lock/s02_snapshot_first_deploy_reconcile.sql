-- s02 (snapshot): what the first reconcile after deploy will do against the
-- 2026-11-03 read-only prod extract. Needs SNAPSHOT_TEMPLATE.
\ir lib/assert.sql

CREATE OR REPLACE FUNCTION t.items(p_result JSONB, p_action TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(ARRAY_AGG(x->>'month' || ' ' || (x->>'company_name') || ' / ' || (x->>'project_name')
                              ORDER BY x->>'month', x->>'company_name', x->>'project_name'), '{}')
      FROM JSONB_ARRAY_ELEMENTS(p_result->'items') x
     WHERE x->>'action' = p_action
$$;

-- Dry run: zero writes, expected classification.
CREATE TEMP TABLE w AS SELECT (SELECT COUNT(*) FROM recalculation_queue) q, (SELECT COUNT(*) FROM sync_alerts) a,
       (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s) pms;
CREATE TEMP TABLE dry AS SELECT reconcile_billing_months(NULL, NULL, TRUE) r;
SELECT t.ok((SELECT q = (SELECT COUNT(*) FROM recalculation_queue) AND a = (SELECT COUNT(*) FROM sync_alerts)
                AND pms = (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s) FROM w),
            'dry run wrote nothing');
SELECT t.eq((SELECT r->'tmt_stale_months' FROM dry), '[]'::JSONB, 'snapshot TMT is fresh');
SELECT t.eq((SELECT t.items(r, 'locked_alert') FROM dry),
            ARRAY['2026-05 True Productions / ZoneCoach',
                  '2026-06 The B Team / Management Automations',
                  '2026-09 True Productions / Fluffy Feather Farm',
                  '2026-09 True Productions / ZoneCoach',
                  '2026-10 True Productions / Fluffy Feather Farm'],
            'locked drift alerts (B Team Jun is date-locked; FFF Oct drift is new since the brief)');
SELECT t.eq((SELECT t.items(r, 'accepted') FROM dry),
            ARRAY['2026-06 FoodCycle Science / FoodCycler Hypercare', '2026-07 Neocurrency / NeoCurrency'],
            'NeoCurrency 2026-07 and FoodCycle 2026-06 suppressed as accepted');
SELECT t.eq((SELECT t.items(r, 'recalc') FROM dry),
            ARRAY['2026-10 luxus / Luxus Site Audit', '2026-11 True Productions / Fluffy Feather Farm'],
            'open-month recalcs');

-- Real run.
CREATE TEMP TABLE real1 AS SELECT reconcile_billing_months(NULL, NULL, FALSE) r;
SELECT t.eq((SELECT r->>'status' FROM real1), 'ok', 'real run ok');
SELECT t.eq((SELECT (r->>'recalculated')::INT * 100 + (r->>'locked_alerts')::INT * 10 + (r->>'persisting')::INT FROM real1), 250,
            '2 recalculated, 5 locked alerts, 0 persisting');
SELECT t.eq((SELECT s.billed_revenue_cents FROM project_monthly_summary s JOIN projects p ON p.id = s.project_id
              WHERE p.project_name = 'Luxus Site Audit' AND s.summary_month = '2026-10-01'), 0::BIGINT,
            'luxus Oct Luxus Site Audit (deleted at source) -> $0');
SELECT t.eq((SELECT COUNT(*)::INT FROM sync_alerts WHERE alert_type = 'eom_report_stale'
              AND entity_id = '67b1cf93-8f56-46b4-9280-80f226e8e6c7:2026-10'), 1,
            'luxus Oct already has an EOM report -> eom_report_stale (not regenerated)');
SELECT t.eq((SELECT COUNT(*)::INT FROM v_billing_month_drift WHERE NOT is_locked), 0, 'no open drift left');

-- Locked months untouched by the reconcile.
SELECT t.eq((SELECT COUNT(*)::INT FROM t_before.pms b
              WHERE billing_month_lock_reason(b.company_id, b.summary_month) IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM project_monthly_summary s WHERE s.id = b.id AND s::TEXT = b::TEXT)),
            0, 'locked months byte-identical after first reconcile');

-- Second run: idempotent.
CREATE TEMP TABLE w2 AS SELECT (SELECT COUNT(*) FROM recalculation_queue) q,
       (SELECT STRING_AGG(a::TEXT, '|' ORDER BY id) FROM sync_alerts a) a,
       (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s) pms;
CREATE TEMP TABLE real2 AS SELECT reconcile_billing_months(NULL, NULL, FALSE) r;
SELECT t.eq((SELECT (r->>'recalculated')::INT * 100 + (r->>'locked_alerts')::INT * 10 + (r->>'persisting')::INT FROM real2), 50,
            'second run: 0 recalculated, same 5 locked alerts');
SELECT t.ok((SELECT q = (SELECT COUNT(*) FROM recalculation_queue)
                AND a = (SELECT STRING_AGG(x::TEXT, '|' ORDER BY id) FROM sync_alerts x)
                AND pms = (SELECT STRING_AGG(s::TEXT, '|' ORDER BY id) FROM project_monthly_summary s) FROM w2),
            'second run changed nothing');
