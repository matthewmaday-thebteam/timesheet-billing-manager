-- Test helpers for supabase/tests/billing-lock. Loaded into each throwaway
-- test database (never into a real environment). Schema `t`.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS t;

CREATE OR REPLACE FUNCTION t.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: %', p_msg;
    END IF;
    RAISE WARNING 'ok - %', p_msg;
END $$;

CREATE OR REPLACE FUNCTION t.eq(p_got ANYELEMENT, p_want ANYELEMENT, p_msg TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_got IS DISTINCT FROM p_want THEN
        RAISE EXCEPTION 'FAIL: % (got %, want %)', p_msg, p_got, p_want;
    END IF;
    RAISE WARNING 'ok - %', p_msg;
END $$;

-- Project uuid for an external project id.
CREATE OR REPLACE FUNCTION t.pid(p_ext TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT id FROM projects WHERE project_id = p_ext $$;

-- Canonical company uuid for a client_id.
CREATE OR REPLACE FUNCTION t.cid(p_client TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT id FROM companies WHERE client_id = p_client $$;

-- Pending queue as sorted 'ext:YYYY-MM:reason' strings (member/primary by uuid -> ext id).
CREATE OR REPLACE FUNCTION t.pending() RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(ARRAY_AGG(p.project_id || ':' || TO_CHAR(q.queue_month, 'YYYY-MM') || ':' || q.reason
                              ORDER BY p.project_id, q.queue_month), '{}')
      FROM recalculation_queue q JOIN projects p ON p.id = q.project_id
     WHERE q.processed_at IS NULL
$$;

-- Same, without the reason.
CREATE OR REPLACE FUNCTION t.pending_pm() RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(ARRAY_AGG(p.project_id || ':' || TO_CHAR(q.queue_month, 'YYYY-MM')
                              ORDER BY p.project_id, q.queue_month), '{}')
      FROM recalculation_queue q JOIN projects p ON p.id = q.project_id
     WHERE q.processed_at IS NULL
$$;

-- Mark everything pending as processed (test bookkeeping, not a drain).
CREATE OR REPLACE FUNCTION t.clear_queue() RETURNS VOID
LANGUAGE sql AS $$ UPDATE recalculation_queue SET processed_at = NOW() WHERE processed_at IS NULL $$;

-- Insert/upsert one rollup row exactly like the sync edge functions do
-- (ON CONFLICT (clockify_workspace_id, task_id) DO UPDATE, rewriting
-- synced_at / sync_run_id every time).
CREATE OR REPLACE FUNCTION t.upsert(p_task TEXT, p_ext TEXT, p_date DATE, p_minutes INTEGER,
                                    p_client TEXT DEFAULT 'cA', p_task_name TEXT DEFAULT 'Task')
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO timesheet_daily_rollups (clockify_workspace_id, work_date, project_id, project_name,
        user_id, user_name, task_id, task_name, total_minutes, client_id, client_name,
        rounded_minutes, sync_run_id, synced_at)
    VALUES ('ws', p_date, p_ext, 'Project ' || p_ext, 'u1', 'User 1', p_task, p_task_name,
            p_minutes, p_client, 'Client ' || p_client, p_minutes, gen_random_uuid(), NOW())
    ON CONFLICT (clockify_workspace_id, task_id) DO UPDATE SET
        work_date = EXCLUDED.work_date, project_id = EXCLUDED.project_id,
        project_name = EXCLUDED.project_name, task_name = EXCLUDED.task_name,
        total_minutes = EXCLUDED.total_minutes, rounded_minutes = EXCLUDED.rounded_minutes,
        client_id = EXCLUDED.client_id, client_name = EXCLUDED.client_name,
        sync_run_id = EXCLUDED.sync_run_id, synced_at = EXCLUDED.synced_at
$$;

-- Full-row text of PMS + carryover rows (incl. timestamps) for byte-identity checks.
CREATE OR REPLACE FUNCTION t.billing_state(p_project UUID) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT STRING_AGG(s::TEXT, E'\n' ORDER BY s.summary_month)
                       FROM project_monthly_summary s WHERE s.project_id = p_project), '')
        || E'\n--\n'
        || COALESCE((SELECT STRING_AGG(c::TEXT, E'\n' ORDER BY c.source_month)
                       FROM project_carryover_hours c WHERE c.project_id = p_project), '')
$$;

CREATE OR REPLACE FUNCTION t.alerts(p_type TEXT) RETURNS INTEGER
LANGUAGE sql STABLE AS $$ SELECT COUNT(*)::INTEGER FROM sync_alerts WHERE alert_type = p_type $$;

CREATE OR REPLACE FUNCTION t.pms(p_project UUID, p_month DATE) RETURNS project_monthly_summary
LANGUAGE sql STABLE AS $$
    SELECT * FROM project_monthly_summary WHERE project_id = p_project AND summary_month = p_month
$$;

-- Invoice (sent) for a company-month.
CREATE OR REPLACE FUNCTION t.invoice(p_company UUID, p_month DATE, p_status TEXT DEFAULT 'sent')
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO qbo_invoice_log (company_id, report_year, report_month, qbo_customer_id, status, total_amount_cents)
    VALUES (p_company, EXTRACT(YEAR FROM p_month)::INT, EXTRACT(MONTH FROM p_month)::INT, 'qbo-test', p_status, 1)
$$;

-- Full-row text of one PMS row + the carryover rows it sources/receives.
CREATE OR REPLACE FUNCTION t.month_state(p_project UUID, p_month DATE) RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT s::TEXT FROM project_monthly_summary s
                      WHERE s.project_id = p_project AND s.summary_month = p_month), '')
        || E'\n--\n'
        || COALESCE((SELECT STRING_AGG(c::TEXT, E'\n' ORDER BY c.source_month)
                       FROM project_carryover_hours c
                      WHERE c.project_id = p_project
                        AND (c.source_month = p_month OR c.carryover_month = p_month)), '')
$$;
