-- ============================================================================
-- Migration 051: Fix Milestone Override When No Transactions Exist
-- Task: 038 - Fix $4,200 FCS0001 discrepancy
-- ============================================================================
-- Problem: recalculate_fixed_billing_month() Part 1 uses JOIN billing_transactions
-- which requires transactions to exist in the target month. If a revenue_milestone
-- billing has no transactions for a month, the override is never set (stays NULL).
-- The view then uses COALESCE(milestone_override_cents, billed_revenue_cents),
-- so NULL means the full timesheet revenue is counted — but the frontend correctly
-- computes the override as $0.
--
-- Also, Part 2 clears overrides by checking for transactions in the month. If
-- no transactions exist, it clears the override (sets NULL) even though the
-- milestone billing still exists and should override to $0.
--
-- Fix:
--   Part 1: LEFT JOIN billing_transactions so milestones with no transactions
--           get COALESCE(SUM(...), 0) = 0 as the override.
--   Part 2: Only clear override when no revenue_milestone billing is linked
--           to the project at all (not just when no transactions exist).
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Replace recalculate_fixed_billing_month() with fixed version
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_fixed_billing_month(p_month DATE)
RETURNS VOID AS $$
DECLARE
  v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
  -- ========================================================================
  -- Part 1: Update milestone_override_cents on project_monthly_summary
  -- For each project with a linked revenue_milestone billing, sum the
  -- transaction amounts for the month. If no transactions exist, override = 0.
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = sub.total_cents,
      updated_at = NOW()
  FROM (
    SELECT
      p.id AS project_id,
      COALESCE(SUM(bt.amount_cents), 0) AS total_cents
    FROM billings b
    JOIN projects p ON p.id = b.linked_project_id
    LEFT JOIN billing_transactions bt
      ON bt.billing_id = b.id
      AND bt.transaction_month = v_month
    WHERE b.type = 'revenue_milestone'
      AND b.linked_project_id IS NOT NULL
    GROUP BY p.id
  ) sub
  WHERE pms.project_id = sub.project_id
    AND pms.summary_month = v_month;

  -- ========================================================================
  -- Part 2: Clear milestone_override_cents for projects that NO LONGER
  -- have any milestone billing linked (e.g., milestone was deleted or
  -- unlinked from the project entirely)
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = NULL,
      updated_at = NOW()
  WHERE pms.summary_month = v_month
    AND pms.milestone_override_cents IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM billings b
      WHERE b.linked_project_id = pms.project_id
        AND b.type = 'revenue_milestone'
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
  'Milestones with no transactions in the month get override = 0 (not NULL). '
  'Call after billing_transactions changes. Idempotent.';

-- ============================================================================
-- STEP 2: Re-run for all months to fix existing data
-- ============================================================================

DO $$
DECLARE
  v_month DATE;
  v_count INTEGER := 0;
BEGIN
  -- Process all months that have summary data (not just months with transactions,
  -- since the fix specifically addresses months WITHOUT transactions)
  FOR v_month IN
    SELECT DISTINCT summary_month
    FROM project_monthly_summary
    WHERE summary_month >= '2026-01-01'
    ORDER BY 1
  LOOP
    PERFORM recalculate_fixed_billing_month(v_month);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Migration 051: Re-ran recalculate_fixed_billing_month for % months', v_count;
END $$;

-- ============================================================================
-- STEP 3: Verification
-- ============================================================================

DO $$
DECLARE
  v_fcs_override BIGINT;
  v_feb_total BIGINT;
BEGIN
  -- Check FCS0001 milestone override for February
  SELECT pms.milestone_override_cents
  INTO v_fcs_override
  FROM project_monthly_summary pms
  WHERE pms.summary_month = '2026-02-01'
    AND pms.company_id = 'd3f439de-51b2-4a1e-8ae3-4763b9eebd10';

  -- Check total combined revenue for February
  SELECT SUM(combined_revenue_cents)
  INTO v_feb_total
  FROM v_combined_revenue_by_company_month
  WHERE summary_month = '2026-02-01';

  RAISE NOTICE 'Migration 051 Verification:';
  RAISE NOTICE '  FCS0001 Feb milestone_override_cents: % (expected: 0)', v_fcs_override;
  RAISE NOTICE '  Feb total combined_revenue_cents: % (expected: ~5860750)', v_feb_total;
END $$;

COMMIT;
