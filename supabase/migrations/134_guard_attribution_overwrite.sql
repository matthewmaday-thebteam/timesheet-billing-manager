-- ============================================================================
-- Migration 134: Guard Attribution Overwrite + Sync Diagnostics + View Fix
-- ============================================================================
-- Three independent, catalog-only changes shipped together:
--
--   (a) trg_guard_attribution_overwrite on timesheet_daily_rollups
--       Blocks the one transition that caused the 2026-09-10 incident.
--   (b) Three nullable diagnostic columns on sync_runs (unmapped_entries,
--       unmapped_hours, withheld_location_entries). No defaults => no table
--       rewrite. Inert until the sync functions populate them.
--   (c) v_weekly_report_availability.has_report now also requires a
--       storage_path, so the new zero-marker weekly_reports rows cannot
--       masquerade as delivered reports.
--
-- None of these rewrite a table or take a long lock. lock_timeout is set so a
-- blocked DDL statement fails fast instead of queueing behind a live sync and
-- stalling every writer on timesheet_daily_rollups.
-- ============================================================================

SET lock_timeout = '3s';

BEGIN;

-- ============================================================================
-- (a) GUARD TRIGGER — trg_guard_attribution_overwrite
-- ============================================================================
-- WHY THIS EXISTS
-- ---------------
-- On 2026-09-10 a ClickUp permission change silently stripped the sync's
-- visibility of space/folder metadata. The sync kept running and kept
-- upserting the same rows, but with project_id / client_id / client_name
-- arriving as NULL and project_name arriving as the literal 'No Project'.
-- The ON CONFLICT DO UPDATE overwrote four weeks of good attribution --
-- 1,075 hours, two weeks of which had already been reported to a client.
-- Nothing alerted: the rows still existed, the sync still returned success.
-- Access was restored 2026-09-15 and the data self-healed.
--
-- Both sync functions carry the identical bug:
--   supabase/functions/sync-clickup-timesheets/index.ts:544-559  (row build)
--   supabase/functions/sync-clockify-timesheets/index.ts:390-405  (row build)
-- The guard lives in the database so it protects BOTH, plus any future
-- writer, rather than being re-implemented (and re-forgotten) per function.
--
-- WHAT IT BLOCKS — exactly one transition, evaluated per column:
--
--   existing            incoming            result
--   ------------------  ------------------  ---------------------------------
--   NULL                NULL                NULL      (genuinely untasked --
--                                                      e.g. Kamen Kamenov's
--                                                      task='0' entries. Never
--                                                      masked, never invented.)
--   NULL                '901510928967'      written   (first-time attribution)
--   '901510928967'      '901510928999'      written   (genuine re-attribution)
--   '901510928967'      NULL                OLD KEPT  (the incident)
--
-- project_name is preserved in LOCKSTEP with project_id: during the incident
-- the incoming project_name was not NULL, it was the literal 'No Project'.
-- Preserving project_id alone would leave a row holding a real project id
-- next to the string 'No Project'. project_name is only ever restored FROM
-- the old row -- it is never fabricated.
--
-- BEFORE UPDATE only. INSERT is deliberately untouched, so a genuinely new
-- untasked entry still lands with its NULLs intact.
--
-- ESCAPE HATCH — for a deliberate, reviewed correction that must clear
-- attribution (e.g. an entry mapped to the wrong client that should become
-- untasked), disable the trigger for the duration of the correction:
--
--   BEGIN;
--   ALTER TABLE timesheet_daily_rollups DISABLE TRIGGER trg_guard_attribution_overwrite;
--   -- ... the deliberate UPDATE ...
--   ALTER TABLE timesheet_daily_rollups ENABLE TRIGGER trg_guard_attribution_overwrite;
--   COMMIT;
--
-- Do this inside one transaction. Leaving the trigger disabled re-opens the
-- exact hole this migration closes.
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_attribution_overwrite()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Pure row logic: no queries, no lookups, no side effects.
    -- Each branch fires only for NOT NULL -> NULL. Everything else falls
    -- through untouched, so re-attribution and first-time attribution both
    -- write normally.

    -- PROJECT -------------------------------------------------------------
    IF NEW.project_id IS NULL AND OLD.project_id IS NOT NULL THEN
        NEW.project_id := OLD.project_id;

        -- Lockstep: keep the name with the id it belongs to. Restore only
        -- from the old row; if the old row had no name, leave the incoming
        -- value alone rather than inventing one.
        IF OLD.project_name IS NOT NULL THEN
            NEW.project_name := OLD.project_name;
        END IF;

    ELSIF NEW.project_name IS NULL
          AND OLD.project_name IS NOT NULL
          AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
        -- Same project, name went missing -> restore it.
        -- The identity check is the point: if project_id genuinely CHANGED,
        -- OLD.project_name belongs to the OLD project. Restoring it here would
        -- fabricate a pair that never existed (new id beside old name), which
        -- is precisely what the lockstep above exists to prevent.
        NEW.project_name := OLD.project_name;
    END IF;

    -- CLIENT --------------------------------------------------------------
    -- Same shape as project. The client columns were previously guarded
    -- per-column, which fabricated mismatched pairs on re-attribution.
    IF NEW.client_id IS NULL AND OLD.client_id IS NOT NULL THEN
        NEW.client_id := OLD.client_id;

        IF OLD.client_name IS NOT NULL THEN
            NEW.client_name := OLD.client_name;
        END IF;

    ELSIF NEW.client_name IS NULL
          AND OLD.client_name IS NOT NULL
          AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
        NEW.client_name := OLD.client_name;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_attribution_overwrite() IS
    'Preserves existing attribution (project_id, project_name, client_id, '
    'client_name) when an UPDATE would blank it to NULL. Added after the '
    '2026-09-10 ClickUp permission incident. Allows first-time attribution '
    'and genuine re-attribution; never masks a legitimately NULL row.';

DROP TRIGGER IF EXISTS trg_guard_attribution_overwrite ON timesheet_daily_rollups;

-- The WHEN clause is a fast-path filter, not policy: the function can only
-- act when at least one guarded column arrives NULL, so a fully attributed
-- incoming row (the overwhelming majority of every sync) never enters plpgsql
-- at all. Keep this clause in sync with the columns the function guards.
CREATE TRIGGER trg_guard_attribution_overwrite
    BEFORE UPDATE ON timesheet_daily_rollups
    FOR EACH ROW
    WHEN (
        NEW.project_id IS NULL
        OR NEW.project_name IS NULL
        OR NEW.client_id IS NULL
        OR NEW.client_name IS NULL
    )
    EXECUTE FUNCTION guard_attribution_overwrite();

-- ============================================================================
-- (b) SYNC DIAGNOSTIC COLUMNS ON sync_runs
-- ============================================================================
-- Nullable, no DEFAULT => catalog-only, no table rewrite, no lock held on
-- existing rows. Populated by the sync functions; NULL means "this run
-- predates the instrumentation", which is distinct from 0.
-- ============================================================================

ALTER TABLE sync_runs
    ADD COLUMN IF NOT EXISTS unmapped_entries          INTEGER,
    ADD COLUMN IF NOT EXISTS unmapped_hours            NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS withheld_location_entries INTEGER;

COMMENT ON COLUMN sync_runs.unmapped_entries IS
    'Entries in this sync run that resolved to no project/client. NULL = not measured (run predates instrumentation).';
COMMENT ON COLUMN sync_runs.unmapped_hours IS
    'Hours represented by unmapped_entries. NULL = not measured.';
COMMENT ON COLUMN sync_runs.withheld_location_entries IS
    'Entries whose attribution was withheld by the source rather than absent. NULL = not measured.';

-- ============================================================================
-- (c) AMEND v_weekly_report_availability.has_report
-- ============================================================================
-- Reproduced verbatim from 071_create_weekly_reports.sql:155-188 with exactly
-- one change, on the has_report expression:
--
--   before: CASE WHEN wr.id IS NOT NULL THEN true ELSE false END
--   after:  CASE WHEN wr.id IS NOT NULL AND wr.storage_path IS NOT NULL ...
--
-- send-weekly-revenue-report now writes a zero-marker weekly_reports row
-- (storage_path = NULL) for company-weeks that produced no entries, so that
-- the absence of a row stops being the only trace of a failure. Without this
-- amendment those markers would flip has_report to true and destroy the one
-- indicator that actually surfaced the 2026-09-10 incident.
--
-- Column list, order and types are IDENTICAL, so this stays catalog-only and
-- the frontend's select('*') (src/hooks/useWeeklyReports.ts:154) is unaffected.
-- ============================================================================

CREATE OR REPLACE VIEW v_weekly_report_availability AS
WITH company_weeks AS (
    SELECT DISTINCT
        p.company_id,
        date_trunc('week', te.work_date)::DATE AS week_start,
        (date_trunc('week', te.work_date) + INTERVAL '6 days')::DATE AS week_end
    FROM v_timesheet_entries te
    JOIN projects p ON p.project_id = te.project_id
    WHERE p.company_id IS NOT NULL
      AND te.work_date >= '2026-01-01'::date
)
SELECT
    cw.company_id,
    c.client_id,
    COALESCE(c.display_name, c.client_name) AS company_name,
    EXTRACT(YEAR FROM cw.week_start)::INTEGER AS report_year,
    EXTRACT(MONTH FROM cw.week_start)::INTEGER AS report_month,
    cw.week_start,
    cw.week_end,
    wr.id AS report_id,
    wr.generated_at,
    wr.storage_path,
    wr.file_size_bytes,
    wr.total_hours,
    wr.total_revenue_cents,
    wr.project_count,
    wr.task_count,
    wr.sent_at,
    wr.sent_to,
    CASE WHEN wr.id IS NOT NULL AND wr.storage_path IS NOT NULL THEN true ELSE false END AS has_report
FROM company_weeks cw
JOIN companies c ON c.id = cw.company_id
LEFT JOIN weekly_reports wr ON wr.company_id = cw.company_id AND wr.week_start = cw.week_start
ORDER BY cw.week_start DESC, company_name;

COMMENT ON VIEW v_weekly_report_availability IS
    'Shows all company-weeks from 2026 onward that have timesheet entries. '
    'Includes generation/send status from weekly_reports. '
    'Uses ISO weeks (Monday start) via date_trunc. '
    'has_report requires a stored CSV (storage_path IS NOT NULL) -- zero-marker '
    'rows written for company-weeks with no entries are NOT reports.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_trigger_exists BOOLEAN;
    v_column_count   INTEGER;
    v_view_exists    BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_guard_attribution_overwrite'
          AND tgrelid = 'timesheet_daily_rollups'::regclass
          AND NOT tgisinternal
    ) INTO v_trigger_exists;

    SELECT COUNT(*) INTO v_column_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sync_runs'
      AND column_name IN ('unmapped_entries', 'unmapped_hours', 'withheld_location_entries');

    SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = 'v_weekly_report_availability'
    ) INTO v_view_exists;

    RAISE NOTICE 'Migration 134 Complete:';
    RAISE NOTICE '  - trg_guard_attribution_overwrite: %', CASE WHEN v_trigger_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - sync_runs diagnostic columns: % of 3', v_column_count;
    RAISE NOTICE '  - v_weekly_report_availability: %', CASE WHEN v_view_exists THEN 'REPLACED' ELSE 'MISSING' END;

    IF NOT v_trigger_exists THEN
        RAISE WARNING 'trg_guard_attribution_overwrite was not created!';
    END IF;
    IF v_column_count <> 3 THEN
        RAISE WARNING 'Expected 3 sync_runs diagnostic columns, found %', v_column_count;
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented — run manually if this migration must be reverted)
-- ============================================================================
-- SET lock_timeout = '3s';
--
-- BEGIN;
--
-- -- (a) Remove the guard trigger and its function.
-- DROP TRIGGER IF EXISTS trg_guard_attribution_overwrite ON timesheet_daily_rollups;
-- DROP FUNCTION IF EXISTS guard_attribution_overwrite();
--
-- -- (b) Remove the sync_runs diagnostic columns.
-- --     Destructive: any values already written are lost.
-- ALTER TABLE sync_runs
--     DROP COLUMN IF EXISTS unmapped_entries,
--     DROP COLUMN IF EXISTS unmapped_hours,
--     DROP COLUMN IF EXISTS withheld_location_entries;
--
-- -- (c) Restore v_weekly_report_availability exactly as defined in
-- --     071_create_weekly_reports.sql:155-188.
-- --     WARNING: with the original has_report, any zero-marker weekly_reports
-- --     rows (storage_path IS NULL) written by send-weekly-revenue-report will
-- --     read as delivered reports. Revert that function too, or delete the
-- --     marker rows, before relying on has_report again.
-- CREATE OR REPLACE VIEW v_weekly_report_availability AS
-- WITH company_weeks AS (
--     SELECT DISTINCT
--         p.company_id,
--         date_trunc('week', te.work_date)::DATE AS week_start,
--         (date_trunc('week', te.work_date) + INTERVAL '6 days')::DATE AS week_end
--     FROM v_timesheet_entries te
--     JOIN projects p ON p.project_id = te.project_id
--     WHERE p.company_id IS NOT NULL
--       AND te.work_date >= '2026-01-01'::date
-- )
-- SELECT
--     cw.company_id,
--     c.client_id,
--     COALESCE(c.display_name, c.client_name) AS company_name,
--     EXTRACT(YEAR FROM cw.week_start)::INTEGER AS report_year,
--     EXTRACT(MONTH FROM cw.week_start)::INTEGER AS report_month,
--     cw.week_start,
--     cw.week_end,
--     wr.id AS report_id,
--     wr.generated_at,
--     wr.storage_path,
--     wr.file_size_bytes,
--     wr.total_hours,
--     wr.total_revenue_cents,
--     wr.project_count,
--     wr.task_count,
--     wr.sent_at,
--     wr.sent_to,
--     CASE WHEN wr.id IS NOT NULL THEN true ELSE false END AS has_report
-- FROM company_weeks cw
-- JOIN companies c ON c.id = cw.company_id
-- LEFT JOIN weekly_reports wr ON wr.company_id = cw.company_id AND wr.week_start = cw.week_start
-- ORDER BY cw.week_start DESC, company_name;
--
-- COMMIT;
