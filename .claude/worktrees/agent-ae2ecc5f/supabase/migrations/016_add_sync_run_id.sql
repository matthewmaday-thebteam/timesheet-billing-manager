-- ============================================================================
-- Migration 016: Add sync_run_id for Deletion Handling in Multi-Source Sync
-- ============================================================================
-- Purpose: Enable "mark and sweep" cleanup pattern where:
--   1. Each sync run stamps entries with a unique sync_run_id
--   2. After successful fetch, cleanup deletes entries not touched by this run
--   3. This allows proper deletion of entries removed in source systems
--
-- Safety: Cleanup only runs when fetch_complete = true (handled in n8n)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Add sync_run_id column
-- ============================================================================
-- UUID identifies which sync run last touched this entry.
-- NULL indicates legacy data not yet synced with run tracking.

ALTER TABLE public.timesheet_daily_rollups
  ADD COLUMN IF NOT EXISTS sync_run_id UUID;

-- ============================================================================
-- STEP 2: Add timestamp for sync auditing
-- ============================================================================
-- Track when entries are stamped by a sync run (useful for debugging).

ALTER TABLE public.timesheet_daily_rollups
  ADD COLUMN IF NOT EXISTS sync_run_at TIMESTAMPTZ;

-- ============================================================================
-- STEP 3: Add partial index for legacy NULL cleanup
-- ============================================================================
-- The cleanup query is:
--   DELETE FROM timesheet_daily_rollups
--   WHERE clockify_workspace_id = :workspace_id
--     AND work_date BETWEEN :start_date AND :end_date
--     AND sync_run_id IS DISTINCT FROM :run_id
--
-- The existing idx_tdr_ws_date on (clockify_workspace_id, work_date)
-- handles the leading columns efficiently.
--
-- This partial index helps identify legacy rows (NULL sync_run_id) quickly.

CREATE INDEX IF NOT EXISTS idx_tdr_sync_run_null
  ON public.timesheet_daily_rollups (clockify_workspace_id, work_date)
  WHERE sync_run_id IS NULL;

-- ============================================================================
-- STEP 4: Add column comments for documentation
-- ============================================================================

COMMENT ON COLUMN public.timesheet_daily_rollups.sync_run_id IS
  'UUID of the sync run that last inserted/updated this entry. NULL for legacy data. Used for deletion detection.';

COMMENT ON COLUMN public.timesheet_daily_rollups.sync_run_at IS
  'Timestamp when this entry was last touched by a sync run. Used for debugging sync issues.';

-- ============================================================================
-- STEP 5: Create RPC function for cleanup (handles NULL correctly)
-- ============================================================================
-- PostgREST's .not('sync_run_id', 'eq', :id) does NOT match NULL values.
-- This function uses IS DISTINCT FROM which correctly handles NULL.

CREATE OR REPLACE FUNCTION public.cleanup_stale_timesheet_entries(
  p_workspace_id TEXT,
  p_range_start DATE,
  p_range_end DATE,
  p_sync_run_id UUID
)
RETURNS TABLE (deleted_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH deleted AS (
    DELETE FROM public.timesheet_daily_rollups
    WHERE clockify_workspace_id = p_workspace_id
      AND work_date BETWEEN p_range_start AND p_range_end
      AND (sync_run_id IS DISTINCT FROM p_sync_run_id)
    RETURNING 1
  )
  SELECT COUNT(*)::BIGINT FROM deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.cleanup_stale_timesheet_entries TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_timesheet_entries TO service_role;

COMMENT ON FUNCTION public.cleanup_stale_timesheet_entries IS
  'Deletes timesheet entries not touched by the current sync run. Used for deletion detection in multi-source sync.';

-- ============================================================================
-- Report migration results
-- ============================================================================

DO $$
DECLARE
  v_total_rows INTEGER;
  v_null_run_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_rows FROM public.timesheet_daily_rollups;
  SELECT COUNT(*) INTO v_null_run_rows FROM public.timesheet_daily_rollups WHERE sync_run_id IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Migration 016: sync_run_id for deletion handling - COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes applied:';
  RAISE NOTICE '  - Added sync_run_id UUID column';
  RAISE NOTICE '  - Added sync_run_at TIMESTAMPTZ column';
  RAISE NOTICE '  - Created partial index idx_tdr_sync_run_null';
  RAISE NOTICE '  - Created RPC function cleanup_stale_timesheet_entries()';
  RAISE NOTICE '';
  RAISE NOTICE 'Current state:';
  RAISE NOTICE '  - Total rows: %', v_total_rows;
  RAISE NOTICE '  - Rows with NULL sync_run_id (legacy): %', v_null_run_rows;
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT:';
  RAISE NOTICE '  - Legacy rows (NULL sync_run_id) will be cleaned up on first';
  RAISE NOTICE '    successful sync for each source+month combination.';
  RAISE NOTICE '  - This is expected behavior - data rebuilds from source.';
  RAISE NOTICE '';
END $$;

COMMIT;
