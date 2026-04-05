-- ============================================================================
-- 017: Add Client/Company Columns to Timesheet Daily Rollups
-- ============================================================================
-- Purpose: Enable Company => Project => Employee => Task hierarchy
--
-- Clockify: Uses native clientId/clientName from API
-- ClickUp: Maps space_id/space_name to client (Space = Company)
-- ============================================================================

BEGIN;

-- Add client columns
ALTER TABLE timesheet_daily_rollups
ADD COLUMN IF NOT EXISTS client_id TEXT,
ADD COLUMN IF NOT EXISTS client_name TEXT;

-- Index for client-based queries
CREATE INDEX IF NOT EXISTS idx_tdr_client_id
ON timesheet_daily_rollups (client_id)
WHERE client_id IS NOT NULL;

-- Report results
DO $$
BEGIN
    RAISE NOTICE '017 complete: Added client_id and client_name columns to timesheet_daily_rollups';
END $$;

COMMIT;
