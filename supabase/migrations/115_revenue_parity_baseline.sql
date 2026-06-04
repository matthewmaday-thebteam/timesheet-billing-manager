-- ============================================================================
-- Migration 115: Revenue Parity Baseline (Phase 0 — Golden Baseline Capture)
-- ============================================================================
-- Purpose: Freeze a "golden" record of EXACTLY what every revenue surface shows
-- TODAY, BEFORE any cutover to read-time revenue resolution. This is the
-- immutable reference the read-time authority must reproduce. NOTHING is cut
-- over here; this migration is purely additive instrumentation.
--
-- What it captures (per captured_at + label snapshot):
--   1. PROJECT grain — from v_canonical_project_monthly_summary (the exact view
--      the frontend/edge functions read): per (project_id, summary_month) the
--      stored billed_revenue_cents, billed_hours, base_revenue_cents,
--      milestone_override_cents, rounded_minutes and MIN/MAX applied flags.
--   2. COMPANY grain — from v_combined_revenue_by_company_month (the exact view
--      that backs the Dashboard combined-revenue number): per
--      (company_id, summary_month) the timesheet/effective/fixed/combined cents
--      and total hours.
--
-- The "snapshot" stored billing source of truth (project_monthly_summary, read
-- through the canonical view) is what live surfaces render today. Migration 118
-- compares the NEW read-time authority against THIS frozen baseline.
--
-- Reuse note: this complements (does not replace) migration 048's
-- billing_verification_snapshots. 048 protects the STORED engine from drift;
-- this baseline protects the SURFACED NUMBERS (canonical + combined views) so
-- the cutover can be proven against what finance actually sees.
--
-- Safety: Entirely additive. New table + capture function only. No writes to
-- any existing billing table. service_role least-privilege; PUBLIC revoked.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create revenue_parity_baseline table
-- ============================================================================
-- Two grains are stored in one table, discriminated by `grain`:
--   'project'  -> project_id + summary_month populated, company_id also set
--   'company'  -> company_id + summary_month populated, project_id NULL
-- A (captured_at, label) pair identifies one full baseline run.

CREATE TABLE IF NOT EXISTS revenue_parity_baseline (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Snapshot identity (a single capture run shares one captured_at + label)
    captured_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    label                       TEXT NOT NULL DEFAULT 'golden',

    -- Grain discriminator
    grain                       TEXT NOT NULL CHECK (grain IN ('project', 'company')),

    -- Keys
    summary_month               DATE NOT NULL,
    company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id                  UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL for company grain

    -- Project-grain values (from v_canonical_project_monthly_summary)
    billed_revenue_cents        BIGINT,
    base_revenue_cents          BIGINT,
    milestone_override_cents    BIGINT,         -- nullable by design (no override = NULL)
    billed_hours                NUMERIC(10,2),
    actual_hours                NUMERIC(10,2),
    rounded_minutes             INTEGER,
    minimum_applied             BOOLEAN,
    maximum_applied             BOOLEAN,

    -- Company-grain values (from v_combined_revenue_by_company_month)
    timesheet_revenue_cents     BIGINT,
    effective_revenue_cents     BIGINT,
    fixed_billing_cents         BIGINT,
    combined_revenue_cents      BIGINT,
    total_billed_hours          NUMERIC(12,2),
    total_actual_hours          NUMERIC(12,2),

    CONSTRAINT chk_rpb_month_first CHECK (EXTRACT(DAY FROM summary_month) = 1),
    CONSTRAINT chk_rpb_project_grain_has_project
        CHECK (grain <> 'project' OR project_id IS NOT NULL),
    CONSTRAINT chk_rpb_company_grain_no_project
        CHECK (grain <> 'company' OR project_id IS NULL),
    -- One row per key per capture run (per grain).
    CONSTRAINT uq_rpb_project_capture
        UNIQUE (label, captured_at, grain, summary_month, company_id, project_id)
);

COMMENT ON TABLE revenue_parity_baseline IS
    'FROZEN GOLDEN BASELINE (Phase 0). Per-capture-run snapshot of revenue '
    'numbers EXACTLY as the live surfaces show them today: project grain from '
    'v_canonical_project_monthly_summary, company grain from '
    'v_combined_revenue_by_company_month. The read-time revenue cutover MUST '
    'reproduce these numbers on existing rows; migration 118 proves it. '
    'Additive instrumentation only — never read by production surfaces.';

COMMENT ON COLUMN revenue_parity_baseline.label IS
    'Human label for a capture run, e.g. ''golden'' or ''pre_cutover_2026_06''.';
COMMENT ON COLUMN revenue_parity_baseline.captured_at IS
    'Timestamp shared by all rows of one capture_revenue_parity_baseline() run.';
COMMENT ON COLUMN revenue_parity_baseline.grain IS
    '''project'' (per project_id) or ''company'' (per company_id, project_id NULL).';

CREATE INDEX IF NOT EXISTS idx_rpb_label_captured
    ON revenue_parity_baseline (label, captured_at);
CREATE INDEX IF NOT EXISTS idx_rpb_grain_month
    ON revenue_parity_baseline (grain, summary_month);
CREATE INDEX IF NOT EXISTS idx_rpb_project_month
    ON revenue_parity_baseline (project_id, summary_month)
    WHERE grain = 'project';
CREATE INDEX IF NOT EXISTS idx_rpb_company_month
    ON revenue_parity_baseline (company_id, summary_month)
    WHERE grain = 'company';

-- ============================================================================
-- STEP 2: RLS — read for authenticated, full control for service_role
-- ============================================================================

ALTER TABLE revenue_parity_baseline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read revenue_parity_baseline"
    ON revenue_parity_baseline;
CREATE POLICY "Authenticated read revenue_parity_baseline"
    ON revenue_parity_baseline FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Service role manage revenue_parity_baseline"
    ON revenue_parity_baseline;
CREATE POLICY "Service role manage revenue_parity_baseline"
    ON revenue_parity_baseline FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 3: capture_revenue_parity_baseline() — snapshot ALL months
-- ============================================================================
-- Captures the CURRENT surfaced numbers across every historical month plus the
-- current month, at BOTH grains, under a single (label, captured_at) run.
--
-- Idempotency: a run is keyed by its captured_at timestamp, so repeat calls
-- create NEW snapshot runs (history is preserved). To re-capture the SAME label
-- afresh, pass p_replace := true to delete prior rows for that label first.
--
-- Returns one summary row describing the run that was just written.

CREATE OR REPLACE FUNCTION capture_revenue_parity_baseline(
    p_label   TEXT    DEFAULT 'golden',
    p_replace BOOLEAN DEFAULT false
)
RETURNS TABLE (
    label                   TEXT,
    captured_at             TIMESTAMPTZ,
    project_rows            INTEGER,
    company_rows            INTEGER,
    months_covered          INTEGER,
    total_combined_cents    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_captured_at  TIMESTAMPTZ := NOW();
    v_project_rows INTEGER;
    v_company_rows INTEGER;
BEGIN
    -- Optional clean slate for this label (preserves other labels' history).
    IF p_replace THEN
        DELETE FROM revenue_parity_baseline rpb WHERE rpb.label = p_label;
    END IF;

    -- ---- PROJECT GRAIN: exactly what v_canonical_project_monthly_summary shows
    INSERT INTO revenue_parity_baseline (
        captured_at, label, grain,
        summary_month, company_id, project_id,
        billed_revenue_cents, base_revenue_cents, milestone_override_cents,
        billed_hours, actual_hours, rounded_minutes,
        minimum_applied, maximum_applied
    )
    SELECT
        v_captured_at, p_label, 'project',
        cpms.summary_month, cpms.company_id, cpms.project_id,
        cpms.billed_revenue_cents, cpms.base_revenue_cents, cpms.milestone_override_cents,
        cpms.billed_hours, cpms.actual_hours, cpms.rounded_minutes,
        cpms.minimum_applied, cpms.maximum_applied
    FROM v_canonical_project_monthly_summary cpms;

    GET DIAGNOSTICS v_project_rows = ROW_COUNT;

    -- ---- COMPANY GRAIN: exactly what v_combined_revenue_by_company_month shows
    INSERT INTO revenue_parity_baseline (
        captured_at, label, grain,
        summary_month, company_id, project_id,
        timesheet_revenue_cents, effective_revenue_cents, fixed_billing_cents,
        combined_revenue_cents, total_billed_hours, total_actual_hours
    )
    SELECT
        v_captured_at, p_label, 'company',
        crc.summary_month, crc.company_id, NULL,
        crc.timesheet_revenue_cents, crc.effective_revenue_cents, crc.fixed_billing_cents,
        crc.combined_revenue_cents, crc.total_billed_hours, crc.total_actual_hours
    FROM v_combined_revenue_by_company_month crc;

    GET DIAGNOSTICS v_company_rows = ROW_COUNT;

    RETURN QUERY
    SELECT
        p_label,
        v_captured_at,
        v_project_rows,
        v_company_rows,
        (SELECT COUNT(DISTINCT rpb.summary_month)::INTEGER
           FROM revenue_parity_baseline rpb
          WHERE rpb.label = p_label AND rpb.captured_at = v_captured_at),
        (SELECT COALESCE(SUM(rpb.combined_revenue_cents), 0)
           FROM revenue_parity_baseline rpb
          WHERE rpb.label = p_label AND rpb.captured_at = v_captured_at
            AND rpb.grain = 'company');
END;
$$;

COMMENT ON FUNCTION capture_revenue_parity_baseline(TEXT, BOOLEAN) IS
    'Phase 0 golden capture. Snapshots v_canonical_project_monthly_summary '
    '(project grain) and v_combined_revenue_by_company_month (company grain) '
    'across ALL months into revenue_parity_baseline under one (label, '
    'captured_at) run. p_replace=true clears prior rows for the label first. '
    'Returns a one-row summary of the capture.';

-- ============================================================================
-- STEP 4: Least-privilege grants (REVOKE default PUBLIC, service_role only)
-- ============================================================================

REVOKE ALL ON FUNCTION capture_revenue_parity_baseline(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION capture_revenue_parity_baseline(TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION capture_revenue_parity_baseline(TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION capture_revenue_parity_baseline(TEXT, BOOLEAN) TO service_role;

GRANT SELECT ON revenue_parity_baseline TO authenticated;
GRANT ALL    ON revenue_parity_baseline TO service_role;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (run manually if this migration must be reverted)
-- ============================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS capture_revenue_parity_baseline(TEXT, BOOLEAN);
--   DROP TABLE IF EXISTS revenue_parity_baseline;
-- COMMIT;
-- ============================================================================
