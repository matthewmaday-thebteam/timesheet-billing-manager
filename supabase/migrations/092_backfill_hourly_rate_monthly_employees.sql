-- Migration 072: Backfill hourly_rate for monthly-billing employees
--
-- Monthly-billing employees (Full-time / Part-time) should have
-- hourly_rate = monthly_cost / expected_hours.
-- This was previously left NULL because the Employee Editor did not
-- auto-calculate it on save.  Now the editor calculates it, but we
-- need to backfill existing rows.

UPDATE resources
SET hourly_rate   = ROUND(monthly_cost / NULLIF(expected_hours, 0), 2),
    updated_at    = now()
WHERE billing_mode    = 'monthly'
  AND monthly_cost    IS NOT NULL
  AND expected_hours  IS NOT NULL
  AND expected_hours  > 0
  AND hourly_rate     IS NULL;
