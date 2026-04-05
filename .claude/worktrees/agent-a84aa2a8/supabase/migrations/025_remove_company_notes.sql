-- ============================================================================
-- Migration 025: Remove notes column from companies
-- ============================================================================

BEGIN;

ALTER TABLE companies DROP COLUMN IF EXISTS notes;

DO $$
BEGIN
    RAISE NOTICE '025 Remove company notes migration complete';
END $$;

COMMIT;
