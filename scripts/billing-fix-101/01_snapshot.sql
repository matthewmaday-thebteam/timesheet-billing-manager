-- =====================================================================
-- 01_snapshot.sql
-- Pre-migration-101 snapshot of all billing state that could be touched
-- by the task_monthly_totals rebuild. Atomic. Safe to re-run because
-- IF NOT EXISTS is used for the schema; snapshot tables are date-stamped
-- and are expected to be created exactly once per fix-run.
--
-- Retention: 90 days minimum. DO NOT DROP these tables before 2026-07-23
-- without explicit authorization.
-- =====================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS billing_snapshots;

-- ---------------------------------------------------------------------
-- Lock down ACLs. Snapshots contain pre-fix billing state (hours, rates,
-- revenue cents) and must not be readable by the anon/authenticated roles.
-- service_role is the only principal that needs access (for rollback and
-- for auditor spot-checks issued via the service key).
-- Safe to re-run -- REVOKE is idempotent; GRANT re-applies cleanly.
-- ---------------------------------------------------------------------
REVOKE ALL ON SCHEMA billing_snapshots FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA billing_snapshots FROM PUBLIC;
GRANT USAGE ON SCHEMA billing_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing_snapshots TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing_snapshots REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing_snapshots GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

-- ---------------------------------------------------------------------
-- project_monthly_summary snapshot
-- ---------------------------------------------------------------------
CREATE TABLE billing_snapshots.pms_2026_04_24_pre_fix
    AS TABLE public.project_monthly_summary WITH DATA;

ALTER TABLE billing_snapshots.pms_2026_04_24_pre_fix
    ADD COLUMN snapshot_taken_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX idx_pms_snap_2026_04_24_proj_month
    ON billing_snapshots.pms_2026_04_24_pre_fix (project_id, summary_month);

COMMENT ON TABLE billing_snapshots.pms_2026_04_24_pre_fix IS
    'pre-migration-101 snapshot, taken before tmt rebuild, retain for 90 days minimum.';

-- ---------------------------------------------------------------------
-- task_monthly_totals snapshot
-- ---------------------------------------------------------------------
CREATE TABLE billing_snapshots.tmt_2026_04_24_pre_fix
    AS TABLE public.task_monthly_totals WITH DATA;

ALTER TABLE billing_snapshots.tmt_2026_04_24_pre_fix
    ADD COLUMN snapshot_taken_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX idx_tmt_snap_2026_04_24_unique
    ON billing_snapshots.tmt_2026_04_24_pre_fix
       (project_id, task_name, client_id, summary_month);

COMMENT ON TABLE billing_snapshots.tmt_2026_04_24_pre_fix IS
    'pre-migration-101 snapshot, taken before tmt rebuild, retain for 90 days minimum.';

-- ---------------------------------------------------------------------
-- qbo_invoice_log snapshot
-- ---------------------------------------------------------------------
CREATE TABLE billing_snapshots.qbo_invoice_log_2026_04_24_pre_fix
    AS TABLE public.qbo_invoice_log WITH DATA;

ALTER TABLE billing_snapshots.qbo_invoice_log_2026_04_24_pre_fix
    ADD COLUMN snapshot_taken_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX idx_qbolog_snap_2026_04_24_id
    ON billing_snapshots.qbo_invoice_log_2026_04_24_pre_fix (id);

COMMENT ON TABLE billing_snapshots.qbo_invoice_log_2026_04_24_pre_fix IS
    'pre-migration-101 snapshot, taken before tmt rebuild, retain for 90 days minimum.';

COMMIT;

-- ---------------------------------------------------------------------
-- Verification: snapshot row counts vs live source row counts.
-- Deltas should be 0. Any non-zero delta means the snapshot is incomplete
-- and the fix MUST NOT proceed.
-- ---------------------------------------------------------------------
SELECT
    'project_monthly_summary'                                    AS source_table,
    (SELECT COUNT(*) FROM public.project_monthly_summary)        AS source_rows,
    (SELECT COUNT(*) FROM billing_snapshots.pms_2026_04_24_pre_fix) AS snapshot_rows,
    (SELECT COUNT(*) FROM public.project_monthly_summary)
      - (SELECT COUNT(*) FROM billing_snapshots.pms_2026_04_24_pre_fix) AS delta;

SELECT
    'task_monthly_totals'                                         AS source_table,
    (SELECT COUNT(*) FROM public.task_monthly_totals)             AS source_rows,
    (SELECT COUNT(*) FROM billing_snapshots.tmt_2026_04_24_pre_fix) AS snapshot_rows,
    (SELECT COUNT(*) FROM public.task_monthly_totals)
      - (SELECT COUNT(*) FROM billing_snapshots.tmt_2026_04_24_pre_fix) AS delta;

SELECT
    'qbo_invoice_log'                                              AS source_table,
    (SELECT COUNT(*) FROM public.qbo_invoice_log)                  AS source_rows,
    (SELECT COUNT(*) FROM billing_snapshots.qbo_invoice_log_2026_04_24_pre_fix) AS snapshot_rows,
    (SELECT COUNT(*) FROM public.qbo_invoice_log)
      - (SELECT COUNT(*) FROM billing_snapshots.qbo_invoice_log_2026_04_24_pre_fix) AS delta;
