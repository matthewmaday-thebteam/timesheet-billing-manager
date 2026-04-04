-- Migration 081: Add source_hours and manifest_hours to sync_runs
-- Allows diagnostics to compare total hours (or days for BambooHR) between source and manifest.
-- For Clockify: stores hours. For BambooHR time-off: stores days. For BambooHR employees: NULL.

ALTER TABLE sync_runs
  ADD COLUMN source_hours NUMERIC(10,2) DEFAULT NULL,
  ADD COLUMN manifest_hours NUMERIC(10,2) DEFAULT NULL;

COMMENT ON COLUMN sync_runs.source_hours IS 'Total hours from source (Clockify) or days (BambooHR time-off). NULL for employee directory syncs.';
COMMENT ON COLUMN sync_runs.manifest_hours IS 'Total hours in Manifest after sync (Clockify) or days (BambooHR time-off). NULL for employee directory syncs.';
