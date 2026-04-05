BEGIN;

-- ============================================================
-- Layer 3: employee_daily_totals (per employee + client + day)
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_daily_totals (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         TEXT NOT NULL DEFAULT '',
    user_name       TEXT NOT NULL DEFAULT 'Unknown User',
    client_id       TEXT NOT NULL DEFAULT '__UNASSIGNED__',
    client_name     TEXT NOT NULL DEFAULT 'Unassigned',
    work_date       DATE NOT NULL,
    actual_minutes  BIGINT NOT NULL DEFAULT 0,
    rounded_minutes BIGINT NOT NULL DEFAULT 0,
    actual_hours    NUMERIC(10,2) NOT NULL DEFAULT 0,
    rounded_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
    task_count      INTEGER NOT NULL DEFAULT 0,
    entry_count     INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT employee_daily_totals_unique
        UNIQUE (user_id, client_id, work_date)
);

CREATE INDEX idx_employee_daily_totals_work_date ON employee_daily_totals (work_date);
CREATE INDEX idx_employee_daily_totals_user ON employee_daily_totals (user_id);
CREATE INDEX idx_employee_daily_totals_client ON employee_daily_totals (client_id);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE employee_daily_totals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read employee_daily_totals" ON employee_daily_totals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access to employee_daily_totals" ON employee_daily_totals FOR ALL TO service_role USING (true);

-- ============================================================
-- Rebuild populate_layer2_totals() — same signature, adds employee_daily_totals
-- ============================================================
CREATE OR REPLACE FUNCTION populate_layer2_totals(
    p_workspace_id TEXT,
    p_range_start DATE,
    p_range_end DATE
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_rows INTEGER := 0;
    v_task_rows INTEGER := 0;
    v_daily_rows INTEGER := 0;
BEGIN
    -- Layer 2: employee_totals
    DELETE FROM employee_totals
    WHERE work_date >= p_range_start AND work_date <= p_range_end;

    INSERT INTO employee_totals (
        user_id, user_name, project_id, project_name, task_name,
        client_id, client_name, work_date,
        actual_minutes, rounded_minutes, actual_hours, rounded_hours,
        entry_count, updated_at
    )
    SELECT
        COALESCE(tdr.user_id, ''),
        MAX(COALESCE(tdr.user_name, 'Unknown User')),
        COALESCE(tdr.project_id, ''),
        MAX(COALESCE(tdr.project_name, 'No Project')),
        COALESCE(tdr.task_name, 'No Task'),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        MAX(COALESCE(NULLIF(tdr.client_name, ''), 'Unassigned')),
        tdr.work_date,
        SUM(tdr.total_minutes),
        SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)),
        ROUND(SUM(tdr.total_minutes) / 60.0, 2),
        ROUND(SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)) / 60.0, 2),
        COUNT(*)::INTEGER,
        NOW()
    FROM timesheet_daily_rollups tdr
    WHERE tdr.total_minutes IS NOT NULL
      AND tdr.total_minutes > 0
      AND tdr.work_date >= p_range_start
      AND tdr.work_date <= p_range_end
    GROUP BY
        COALESCE(tdr.user_id, ''),
        COALESCE(tdr.project_id, ''),
        COALESCE(tdr.task_name, 'No Task'),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        tdr.work_date;

    GET DIAGNOSTICS v_employee_rows = ROW_COUNT;

    -- Layer 3: task_totals
    DELETE FROM task_totals
    WHERE work_date >= p_range_start AND work_date <= p_range_end;

    INSERT INTO task_totals (
        project_id, project_name, task_name,
        client_id, client_name, work_date,
        actual_minutes, rounded_minutes, actual_hours, rounded_hours,
        entry_count, updated_at
    )
    SELECT
        COALESCE(tdr.project_id, ''),
        MAX(COALESCE(tdr.project_name, 'No Project')),
        COALESCE(tdr.task_name, 'No Task'),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        MAX(COALESCE(NULLIF(tdr.client_name, ''), 'Unassigned')),
        tdr.work_date,
        SUM(tdr.total_minutes),
        SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)),
        ROUND(SUM(tdr.total_minutes) / 60.0, 2),
        ROUND(SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)) / 60.0, 2),
        COUNT(*)::INTEGER,
        NOW()
    FROM timesheet_daily_rollups tdr
    WHERE tdr.total_minutes IS NOT NULL
      AND tdr.total_minutes > 0
      AND tdr.work_date >= p_range_start
      AND tdr.work_date <= p_range_end
    GROUP BY
        COALESCE(tdr.project_id, ''),
        COALESCE(tdr.task_name, 'No Task'),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        tdr.work_date;

    GET DIAGNOSTICS v_task_rows = ROW_COUNT;

    -- Layer 3: employee_daily_totals
    DELETE FROM employee_daily_totals
    WHERE work_date >= p_range_start AND work_date <= p_range_end;

    INSERT INTO employee_daily_totals (
        user_id, user_name, client_id, client_name, work_date,
        actual_minutes, rounded_minutes, actual_hours, rounded_hours,
        task_count, entry_count, updated_at
    )
    SELECT
        COALESCE(tdr.user_id, ''),
        MAX(COALESCE(tdr.user_name, 'Unknown User')),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        MAX(COALESCE(NULLIF(tdr.client_name, ''), 'Unassigned')),
        tdr.work_date,
        SUM(tdr.total_minutes),
        SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)),
        ROUND(SUM(tdr.total_minutes) / 60.0, 2),
        ROUND(SUM(COALESCE(tdr.rounded_minutes, tdr.total_minutes)) / 60.0, 2),
        COUNT(DISTINCT COALESCE(tdr.task_name, 'No Task'))::INTEGER,
        COUNT(*)::INTEGER,
        NOW()
    FROM timesheet_daily_rollups tdr
    WHERE tdr.total_minutes IS NOT NULL
      AND tdr.total_minutes > 0
      AND tdr.work_date >= p_range_start
      AND tdr.work_date <= p_range_end
    GROUP BY
        COALESCE(tdr.user_id, ''),
        COALESCE(NULLIF(tdr.client_id, ''), '__UNASSIGNED__'),
        tdr.work_date;

    GET DIAGNOSTICS v_daily_rows = ROW_COUNT;

    RETURN jsonb_build_object(
        'employee_rows', v_employee_rows,
        'task_rows', v_task_rows,
        'daily_rows', v_daily_rows,
        'range_start', p_range_start,
        'range_end', p_range_end
    );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION populate_layer2_totals(TEXT, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION populate_layer2_totals(TEXT, DATE, DATE) TO authenticated;

-- ============================================================
-- Backfill
-- ============================================================
DO $$
DECLARE
    v_min_date DATE;
    v_max_date DATE;
    v_result JSONB;
BEGIN
    SELECT MIN(work_date), MAX(work_date)
    INTO v_min_date, v_max_date
    FROM timesheet_daily_rollups
    WHERE total_minutes IS NOT NULL AND total_minutes > 0;

    IF v_min_date IS NULL OR v_max_date IS NULL THEN
        RAISE NOTICE 'Backfill skipped: no data';
    ELSE
        v_result := populate_layer2_totals('__backfill__', v_min_date, v_max_date);
        RAISE NOTICE 'Backfill complete: %', v_result::TEXT;
    END IF;
END $$;

-- ============================================================
-- Verification
-- ============================================================
DO $$
DECLARE
    v_et_count INTEGER;
    v_tt_count INTEGER;
    v_edt_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_et_count FROM employee_totals;
    SELECT COUNT(*) INTO v_tt_count FROM task_totals;
    SELECT COUNT(*) INTO v_edt_count FROM employee_daily_totals;
    RAISE NOTICE 'Layer 2 employee_totals: % rows', v_et_count;
    RAISE NOTICE 'Layer 3 task_totals: % rows', v_tt_count;
    RAISE NOTICE 'Layer 3 employee_daily_totals: % rows', v_edt_count;
END $$;

COMMIT;
