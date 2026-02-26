-- Migration 055: Remove reasonable-hours caps from billing limits
-- The 744-hour caps were too restrictive for business needs.

ALTER TABLE project_monthly_billing_limits
  DROP CONSTRAINT IF EXISTS chk_min_reasonable,
  DROP CONSTRAINT IF EXISTS chk_max_reasonable,
  DROP CONSTRAINT IF EXISTS chk_carryover_max_reasonable;

DO $$
BEGIN
  RAISE NOTICE '055 Remove billing hours caps complete';
END $$;
