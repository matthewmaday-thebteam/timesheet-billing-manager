-- ============================================================================
-- Migration 032: Add target_hours column to projects
-- ============================================================================
-- Purpose: Allow admins to set a target hours value for each project.
--          0 means no target.
--          The DEFAULT ensures auto-provisioned projects get target_hours = 0.
-- ============================================================================

BEGIN;

-- Add target_hours column with DEFAULT 0
-- The DEFAULT ensures new auto-provisioned projects automatically get target_hours = 0
ALTER TABLE projects ADD COLUMN target_hours NUMERIC(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN projects.target_hours IS 'Target hours for the project. 0 means no target.';

DO $$
BEGIN
    RAISE NOTICE '032 Add project target_hours migration complete';
END $$;

COMMIT;
