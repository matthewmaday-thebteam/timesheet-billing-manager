-- ============================================================================
-- Migration 048: Billing Verification Snapshots
-- Task: 033 - Frontend Billing Migration (Regression Protection)
-- ============================================================================
-- Purpose: Store verified billing totals so that any future change to
-- calculations, data, or schema can be instantly validated against known-good
-- numbers.
--
-- Two levels of verification:
--   1. Monthly totals (fast check: does the big number still match?)
--   2. Per-project detail (precise check: which project drifted and how?)
--
-- Usage:
--   -- Lock in current values after manual verification:
--   SELECT snapshot_billing_month('2026-01-01', 'dashboard_match');
--
--   -- Validate current calculations haven't drifted:
--   SELECT * FROM verify_billing_month('2026-01-01');
--   -- Returns empty set = all good. Rows = discrepancies.
--
--   -- Quick check all months at once:
--   SELECT * FROM verify_all_billing_months();
--
-- Safety: Entirely additive. New table and functions only.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create billing_verification_snapshots table
-- ============================================================================
-- Stores verified per-project billing values for a given month.
-- One row per project-month. The monthly totals are derived by SUM.

CREATE TABLE billing_verification_snapshots (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_month             DATE NOT NULL,
  project_id                UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Per-project values (same fields as project_monthly_summary)
  actual_minutes            INTEGER NOT NULL,
  rounded_minutes           INTEGER NOT NULL,
  billed_hours              NUMERIC(10,2) NOT NULL,
  unbillable_hours          NUMERIC(10,2) NOT NULL DEFAULT 0,
  base_revenue_cents        BIGINT NOT NULL,
  billed_revenue_cents      BIGINT NOT NULL,
  milestone_override_cents  BIGINT DEFAULT NULL,
  rate_used                 NUMERIC(10,2) NOT NULL,
  rounding_used             INTEGER NOT NULL,

  -- Audit
  verified_by               TEXT NOT NULL DEFAULT 'manual',
  verified_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                     TEXT,

  CONSTRAINT uq_snapshot_project_month UNIQUE (project_id, summary_month),
  CONSTRAINT chk_snapshot_month_first CHECK (EXTRACT(DAY FROM summary_month) = 1)
);

CREATE INDEX idx_snapshot_month ON billing_verification_snapshots (summary_month);

-- RLS
ALTER TABLE billing_verification_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read billing snapshots"
  ON billing_verification_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage billing snapshots"
  ON billing_verification_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- STEP 2: Create snapshot_billing_month() function
-- ============================================================================
-- Captures the current project_monthly_summary + milestone overrides as
-- the verified golden reference for a given month.
-- Overwrites any existing snapshot for that month.

CREATE OR REPLACE FUNCTION snapshot_billing_month(
  p_month DATE,
  p_verified_by TEXT DEFAULT 'manual',
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  projects_snapshotted INTEGER,
  timesheet_revenue_cents BIGINT,
  effective_revenue_cents BIGINT,
  combined_revenue_cents BIGINT
) AS $$
DECLARE
  v_month DATE := DATE_TRUNC('month', p_month)::DATE;
  v_count INTEGER;
  v_timesheet BIGINT;
  v_effective BIGINT;
  v_fixed BIGINT;
BEGIN
  -- Delete existing snapshot for this month
  DELETE FROM billing_verification_snapshots
  WHERE summary_month = v_month;

  -- Insert current values
  INSERT INTO billing_verification_snapshots (
    summary_month, project_id,
    actual_minutes, rounded_minutes,
    billed_hours, unbillable_hours,
    base_revenue_cents, billed_revenue_cents,
    milestone_override_cents,
    rate_used, rounding_used,
    verified_by, notes
  )
  SELECT
    pms.summary_month,
    pms.project_id,
    pms.actual_minutes,
    pms.rounded_minutes,
    pms.billed_hours,
    pms.unbillable_hours,
    pms.base_revenue_cents,
    pms.billed_revenue_cents,
    pms.milestone_override_cents,
    pms.rate_used,
    pms.rounding_used,
    p_verified_by,
    p_notes
  FROM project_monthly_summary pms
  WHERE pms.summary_month = v_month;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Compute totals for return
  SELECT
    COALESCE(SUM(billed_revenue_cents), 0),
    COALESCE(SUM(COALESCE(milestone_override_cents, billed_revenue_cents)), 0)
  INTO v_timesheet, v_effective
  FROM billing_verification_snapshots
  WHERE summary_month = v_month;

  SELECT COALESCE(SUM(fixed_billing_cents), 0)
  INTO v_fixed
  FROM monthly_fixed_billing_summary
  WHERE summary_month = v_month;

  RETURN QUERY SELECT
    v_count,
    v_timesheet,
    v_effective,
    v_effective + v_fixed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION snapshot_billing_month(DATE, TEXT, TEXT) IS
  'Captures current project_monthly_summary values as the verified golden reference for a month. '
  'Call after manually confirming billing numbers are correct.';

-- ============================================================================
-- STEP 3: Create verify_billing_month() function
-- ============================================================================
-- Compares current project_monthly_summary against the stored snapshot.
-- Returns one row per discrepancy. Empty result = all values match.

CREATE OR REPLACE FUNCTION verify_billing_month(p_month DATE)
RETURNS TABLE (
  project_name        TEXT,
  field_name          TEXT,
  snapshot_value      TEXT,
  current_value       TEXT,
  difference          TEXT
) AS $$
DECLARE
  v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
  -- Check snapshot exists
  IF NOT EXISTS (
    SELECT 1 FROM billing_verification_snapshots WHERE summary_month = v_month
  ) THEN
    RETURN QUERY SELECT
      '(no snapshot)'::TEXT,
      'summary_month'::TEXT,
      v_month::TEXT,
      'NO SNAPSHOT FOUND'::TEXT,
      'Run snapshot_billing_month() first'::TEXT;
    RETURN;
  END IF;

  -- Compare per-project fields
  RETURN QUERY
  WITH comparisons AS (
    SELECT
      p.project_name AS proj_name,
      snap.project_id,

      snap.actual_minutes        AS snap_actual_minutes,
      pms.actual_minutes         AS cur_actual_minutes,
      snap.rounded_minutes       AS snap_rounded_minutes,
      pms.rounded_minutes        AS cur_rounded_minutes,
      snap.billed_hours          AS snap_billed_hours,
      pms.billed_hours           AS cur_billed_hours,
      snap.unbillable_hours      AS snap_unbillable_hours,
      pms.unbillable_hours       AS cur_unbillable_hours,
      snap.base_revenue_cents    AS snap_base_rev,
      pms.base_revenue_cents     AS cur_base_rev,
      snap.billed_revenue_cents  AS snap_billed_rev,
      pms.billed_revenue_cents   AS cur_billed_rev,
      snap.milestone_override_cents AS snap_milestone,
      pms.milestone_override_cents  AS cur_milestone,
      snap.rate_used             AS snap_rate,
      pms.rate_used              AS cur_rate,
      snap.rounding_used         AS snap_rounding,
      pms.rounding_used          AS cur_rounding
    FROM billing_verification_snapshots snap
    JOIN projects p ON p.id = snap.project_id
    LEFT JOIN project_monthly_summary pms
      ON pms.project_id = snap.project_id
      AND pms.summary_month = snap.summary_month
    WHERE snap.summary_month = v_month
  )
  -- actual_minutes
  SELECT c.proj_name, 'actual_minutes',
    c.snap_actual_minutes::TEXT, COALESCE(c.cur_actual_minutes::TEXT, 'MISSING'),
    (COALESCE(c.cur_actual_minutes, 0) - c.snap_actual_minutes)::TEXT
  FROM comparisons c
  WHERE c.cur_actual_minutes IS DISTINCT FROM c.snap_actual_minutes

  UNION ALL
  -- rounded_minutes
  SELECT c.proj_name, 'rounded_minutes',
    c.snap_rounded_minutes::TEXT, COALESCE(c.cur_rounded_minutes::TEXT, 'MISSING'),
    (COALESCE(c.cur_rounded_minutes, 0) - c.snap_rounded_minutes)::TEXT
  FROM comparisons c
  WHERE c.cur_rounded_minutes IS DISTINCT FROM c.snap_rounded_minutes

  UNION ALL
  -- billed_hours
  SELECT c.proj_name, 'billed_hours',
    c.snap_billed_hours::TEXT, COALESCE(c.cur_billed_hours::TEXT, 'MISSING'),
    (COALESCE(c.cur_billed_hours, 0) - c.snap_billed_hours)::TEXT
  FROM comparisons c
  WHERE c.cur_billed_hours IS DISTINCT FROM c.snap_billed_hours

  UNION ALL
  -- unbillable_hours
  SELECT c.proj_name, 'unbillable_hours',
    c.snap_unbillable_hours::TEXT, COALESCE(c.cur_unbillable_hours::TEXT, 'MISSING'),
    (COALESCE(c.cur_unbillable_hours, 0) - c.snap_unbillable_hours)::TEXT
  FROM comparisons c
  WHERE c.cur_unbillable_hours IS DISTINCT FROM c.snap_unbillable_hours

  UNION ALL
  -- base_revenue_cents
  SELECT c.proj_name, 'base_revenue_cents',
    c.snap_base_rev::TEXT, COALESCE(c.cur_base_rev::TEXT, 'MISSING'),
    (COALESCE(c.cur_base_rev, 0) - c.snap_base_rev)::TEXT
  FROM comparisons c
  WHERE c.cur_base_rev IS DISTINCT FROM c.snap_base_rev

  UNION ALL
  -- billed_revenue_cents
  SELECT c.proj_name, 'billed_revenue_cents',
    c.snap_billed_rev::TEXT, COALESCE(c.cur_billed_rev::TEXT, 'MISSING'),
    (COALESCE(c.cur_billed_rev, 0) - c.snap_billed_rev)::TEXT
  FROM comparisons c
  WHERE c.cur_billed_rev IS DISTINCT FROM c.snap_billed_rev

  UNION ALL
  -- milestone_override_cents
  SELECT c.proj_name, 'milestone_override_cents',
    COALESCE(c.snap_milestone::TEXT, 'NULL'),
    COALESCE(c.cur_milestone::TEXT, 'NULL'),
    CASE
      WHEN c.snap_milestone IS NULL AND c.cur_milestone IS NULL THEN '0'
      ELSE (COALESCE(c.cur_milestone, 0) - COALESCE(c.snap_milestone, 0))::TEXT
    END
  FROM comparisons c
  WHERE c.cur_milestone IS DISTINCT FROM c.snap_milestone

  UNION ALL
  -- rate_used
  SELECT c.proj_name, 'rate_used',
    c.snap_rate::TEXT, COALESCE(c.cur_rate::TEXT, 'MISSING'),
    (COALESCE(c.cur_rate, 0) - c.snap_rate)::TEXT
  FROM comparisons c
  WHERE c.cur_rate IS DISTINCT FROM c.snap_rate

  UNION ALL
  -- rounding_used
  SELECT c.proj_name, 'rounding_used',
    c.snap_rounding::TEXT, COALESCE(c.cur_rounding::TEXT, 'MISSING'),
    (COALESCE(c.cur_rounding, 0) - c.snap_rounding)::TEXT
  FROM comparisons c
  WHERE c.cur_rounding IS DISTINCT FROM c.snap_rounding

  UNION ALL
  -- Projects in snapshot but missing from summary
  SELECT p.project_name, 'PROJECT_MISSING',
    'exists in snapshot', 'NOT IN project_monthly_summary', ''
  FROM billing_verification_snapshots snap
  JOIN projects p ON p.id = snap.project_id
  WHERE snap.summary_month = v_month
    AND NOT EXISTS (
      SELECT 1 FROM project_monthly_summary pms
      WHERE pms.project_id = snap.project_id
        AND pms.summary_month = v_month
    )

  ORDER BY 1, 2;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION verify_billing_month(DATE) IS
  'Compares current project_monthly_summary against the stored golden snapshot. '
  'Returns one row per discrepancy. Empty result means all values match.';

-- ============================================================================
-- STEP 4: Create verify_all_billing_months() function
-- ============================================================================
-- Quick check across all snapshotted months. Returns summary per month.

CREATE OR REPLACE FUNCTION verify_all_billing_months()
RETURNS TABLE (
  summary_month       DATE,
  snapshot_projects    INTEGER,
  discrepancy_count   INTEGER,
  status              TEXT
) AS $$
DECLARE
  v_month DATE;
  v_proj_count INTEGER;
  v_disc_count INTEGER;
BEGIN
  FOR v_month IN
    SELECT DISTINCT bvs.summary_month
    FROM billing_verification_snapshots bvs
    ORDER BY bvs.summary_month
  LOOP
    SELECT COUNT(DISTINCT bvs.project_id)
    INTO v_proj_count
    FROM billing_verification_snapshots bvs
    WHERE bvs.summary_month = v_month;

    SELECT COUNT(*)
    INTO v_disc_count
    FROM verify_billing_month(v_month) vbm
    WHERE vbm.field_name != 'summary_month'; -- exclude "no snapshot" messages

    summary_month := v_month;
    snapshot_projects := v_proj_count;
    discrepancy_count := v_disc_count;
    status := CASE WHEN v_disc_count = 0 THEN 'PASS' ELSE 'FAIL' END;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION verify_all_billing_months() IS
  'Runs verify_billing_month() for every snapshotted month. Returns PASS/FAIL per month.';

COMMIT;
