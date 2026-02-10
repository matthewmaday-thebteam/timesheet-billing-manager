-- ============================================================================
-- Migration 047: Fixed Billing Summary Integration
-- Task: 033 - Frontend Billing Migration (Step 2B)
-- ============================================================================
-- Purpose: Add fixed billing (service fees, subscriptions, licenses,
-- reimbursements, unlinked milestones) and milestone overrides to the summary
-- table system, enabling a combined revenue comparison that matches the
-- Dashboard's combinedTotalRevenue formula.
--
-- Changes:
--   1. New table: monthly_fixed_billing_summary (company-month level)
--   2. New column: project_monthly_summary.milestone_override_cents
--   3. New function: recalculate_fixed_billing_month(DATE)
--   4. New view: v_combined_revenue_by_company_month
--   5. New trigger: auto-enqueue recalculation on billing_transactions changes
--   6. Backfill: populate data for all existing months
--
-- Safety: All changes are additive. No existing tables, functions, or views
-- are modified. No frontend code reads from these objects until explicitly
-- updated.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Create monthly_fixed_billing_summary table
-- ============================================================================
-- Company-month level aggregation of non-milestone billing_transactions.
-- This captures: service_fee, subscription, license, reimbursement, and
-- unlinked milestones (milestones without linked_project_id).

CREATE TABLE monthly_fixed_billing_summary (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_month           DATE NOT NULL,
  company_id              UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Non-milestone fixed billings (service_fee, subscription, license,
  -- reimbursement, unlinked milestones)
  fixed_billing_cents     BIGINT NOT NULL DEFAULT 0,
  fixed_billing_count     INTEGER NOT NULL DEFAULT 0,

  -- Audit
  calculated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_fixed_billing_month UNIQUE (company_id, summary_month),
  CONSTRAINT chk_fixed_month_first CHECK (EXTRACT(DAY FROM summary_month) = 1)
);

-- Indexes
CREATE INDEX idx_fixed_billing_month ON monthly_fixed_billing_summary (summary_month);
CREATE INDEX idx_fixed_billing_company ON monthly_fixed_billing_summary (company_id);

-- Updated_at trigger
CREATE TRIGGER trg_fixed_billing_updated_at
  BEFORE UPDATE ON monthly_fixed_billing_summary
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE monthly_fixed_billing_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read fixed billing summaries"
  ON monthly_fixed_billing_summary
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage fixed billing summaries"
  ON monthly_fixed_billing_summary
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- STEP 2: Add milestone_override_cents to project_monthly_summary
-- ============================================================================
-- NULL = no override (use billed_revenue_cents as-is)
-- Non-NULL = milestone replaces timesheet revenue for this project

ALTER TABLE project_monthly_summary
  ADD COLUMN IF NOT EXISTS milestone_override_cents BIGINT DEFAULT NULL;

COMMENT ON COLUMN project_monthly_summary.milestone_override_cents IS
  'When set, this milestone amount replaces billed_revenue_cents for combined revenue. '
  'NULL means no milestone override exists for this project-month.';

-- ============================================================================
-- STEP 3: Create recalculate_fixed_billing_month() function
-- ============================================================================
-- Populates both:
--   a) milestone_override_cents on project_monthly_summary (for linked milestones)
--   b) monthly_fixed_billing_summary (for everything else)
--
-- This mirrors the Dashboard's three-part formula:
--   totalRevenue + filteredBillingCents + milestoneAdjustment

CREATE OR REPLACE FUNCTION recalculate_fixed_billing_month(p_month DATE)
RETURNS VOID AS $$
DECLARE
  v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
  -- ========================================================================
  -- Part 1: Update milestone_override_cents on project_monthly_summary
  -- For each project with a linked revenue_milestone billing, sum the
  -- transaction amounts for the month
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = sub.total_cents,
      updated_at = NOW()
  FROM (
    SELECT
      p.id AS project_id,
      SUM(bt.amount_cents) AS total_cents
    FROM billings b
    JOIN billing_transactions bt ON bt.billing_id = b.id
    JOIN projects p ON p.id = b.linked_project_id
    WHERE b.type = 'revenue_milestone'
      AND b.linked_project_id IS NOT NULL
      AND bt.transaction_month = v_month
    GROUP BY p.id
  ) sub
  WHERE pms.project_id = sub.project_id
    AND pms.summary_month = v_month;

  -- ========================================================================
  -- Part 2: Clear milestone_override_cents for projects that NO LONGER
  -- have milestones (e.g., milestone was deleted or moved to different month)
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = NULL,
      updated_at = NOW()
  WHERE pms.summary_month = v_month
    AND pms.milestone_override_cents IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM billings b
      JOIN billing_transactions bt ON bt.billing_id = b.id
      WHERE b.linked_project_id = pms.project_id
        AND b.type = 'revenue_milestone'
        AND bt.transaction_month = v_month
    );

  -- ========================================================================
  -- Part 3: Upsert monthly_fixed_billing_summary per company
  -- Fixed billings = everything EXCEPT linked milestones
  -- This matches the Dashboard's filteredBillingCents filter:
  --   NOT (type='revenue_milestone' AND linked_project_id IS NOT NULL)
  -- ========================================================================
  INSERT INTO monthly_fixed_billing_summary (
    summary_month, company_id,
    fixed_billing_cents, fixed_billing_count,
    calculated_at
  )
  SELECT
    v_month,
    b.company_id,
    COALESCE(SUM(bt.amount_cents), 0),
    COUNT(DISTINCT b.id),
    NOW()
  FROM billings b
  JOIN billing_transactions bt ON bt.billing_id = b.id
  WHERE bt.transaction_month = v_month
    AND NOT (
      b.type = 'revenue_milestone'
      AND b.linked_project_id IS NOT NULL
    )
  GROUP BY b.company_id
  ON CONFLICT (company_id, summary_month) DO UPDATE SET
    fixed_billing_cents = EXCLUDED.fixed_billing_cents,
    fixed_billing_count = EXCLUDED.fixed_billing_count,
    calculated_at = NOW(),
    updated_at = NOW();

  -- ========================================================================
  -- Part 4: Clean up fixed billing rows for companies that no longer have
  -- any fixed billings for this month
  -- ========================================================================
  DELETE FROM monthly_fixed_billing_summary fbs
  WHERE fbs.summary_month = v_month
    AND NOT EXISTS (
      SELECT 1
      FROM billings b
      JOIN billing_transactions bt ON bt.billing_id = b.id
      WHERE bt.transaction_month = v_month
        AND b.company_id = fbs.company_id
        AND NOT (
          b.type = 'revenue_milestone'
          AND b.linked_project_id IS NOT NULL
        )
    );

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_fixed_billing_month(DATE) IS
  'Recalculates fixed billing summary and milestone overrides for a given month. '
  'Call after billing_transactions changes. Idempotent.';

-- ============================================================================
-- STEP 4: Create v_combined_revenue_by_company_month view
-- ============================================================================
-- Combines timesheet revenue (with milestone overrides) and fixed billings
-- into a single view per company-month.

CREATE OR REPLACE VIEW v_combined_revenue_by_company_month AS
SELECT
  pms.summary_month,
  pms.company_id,
  c.client_id,
  COALESCE(c.display_name, c.client_name) AS company_name,

  -- Timesheet revenue (from project_monthly_summary)
  SUM(pms.billed_revenue_cents) AS timesheet_revenue_cents,

  -- Effective revenue: milestone overrides replace timesheet revenue per-project
  SUM(COALESCE(pms.milestone_override_cents, pms.billed_revenue_cents)) AS effective_revenue_cents,

  -- Fixed billings (from monthly_fixed_billing_summary)
  COALESCE(fbs.fixed_billing_cents, 0) AS fixed_billing_cents,

  -- Combined total: effective + fixed
  SUM(COALESCE(pms.milestone_override_cents, pms.billed_revenue_cents))
    + COALESCE(fbs.fixed_billing_cents, 0) AS combined_revenue_cents,

  -- Hours (unchanged by fixed billing integration)
  SUM(pms.billed_hours) AS total_billed_hours,
  SUM(pms.actual_hours) AS total_actual_hours

FROM project_monthly_summary pms
JOIN companies c ON c.id = pms.company_id
LEFT JOIN monthly_fixed_billing_summary fbs
  ON fbs.company_id = pms.company_id
  AND fbs.summary_month = pms.summary_month
GROUP BY
  pms.summary_month,
  pms.company_id,
  c.client_id,
  c.display_name,
  c.client_name,
  fbs.fixed_billing_cents;

COMMENT ON VIEW v_combined_revenue_by_company_month IS
  'Combined revenue per company-month: timesheet (with milestone overrides) + fixed billings. '
  'Mirrors the Dashboard combinedTotalRevenue formula.';

-- ============================================================================
-- STEP 5: Create trigger on billing_transactions
-- ============================================================================
-- When billing_transactions are inserted, updated, or deleted, enqueue the
-- affected month for fixed billing recalculation.

CREATE OR REPLACE FUNCTION enqueue_fixed_billing_recalc()
RETURNS TRIGGER AS $$
DECLARE
  v_month DATE;
BEGIN
  -- Determine the affected month
  IF TG_OP = 'DELETE' THEN
    v_month := OLD.transaction_month;
  ELSE
    v_month := NEW.transaction_month;
  END IF;

  -- Perform immediate recalculation for the affected month
  PERFORM recalculate_fixed_billing_month(v_month);

  -- If UPDATE changed the month, also recalculate the old month
  IF TG_OP = 'UPDATE' AND OLD.transaction_month IS DISTINCT FROM NEW.transaction_month THEN
    PERFORM recalculate_fixed_billing_month(OLD.transaction_month);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enqueue_fixed_recalc
  AFTER INSERT OR UPDATE OR DELETE
  ON billing_transactions
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_fixed_billing_recalc();

-- ============================================================================
-- STEP 6: Backfill all existing months
-- ============================================================================
-- Run recalculate_fixed_billing_month() for every month that has
-- billing_transactions data.

DO $$
DECLARE
  v_month DATE;
  v_count INTEGER := 0;
BEGIN
  FOR v_month IN
    SELECT DISTINCT DATE_TRUNC('month', transaction_month)::DATE
    FROM billing_transactions
    ORDER BY 1
  LOOP
    PERFORM recalculate_fixed_billing_month(v_month);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % months processed', v_count;
END $$;

COMMIT;
