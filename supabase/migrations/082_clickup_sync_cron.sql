-- =============================================================================
-- Migration 082: ClickUp timesheet sync cron job + drop legacy table
-- =============================================================================
-- 1. Schedules the sync-clickup-timesheets Edge Function to run every hour.
--
--    Replaces the n8n ClickUp pipeline with a single Edge Function call.
--
--    Uses the same vault secret (manifest-service-role-key) as BambooHR cron jobs
--    (migration 077), Clockify (079), weekly report (070), and EOM report (072).
--
-- 2. Drops the legacy clickup_time_entries table.
--    This table was used by the old n8n workflow and has deny-all RLS
--    (migration 053). It is completely unused by the application.
--    All ClickUp time data now flows into timesheet_daily_rollups
--    (same table as Clockify, keyed by clockify_workspace_id = ClickUp Team ID).
-- =============================================================================

-- ClickUp timesheet sync -- every hour at :30 (offset from Clockify's :00)
select cron.schedule(
  'sync-clickup-timesheets',               -- job name
  '30 * * * *',                            -- cron: every hour at :30
  $$
  select net.http_post(
    url := 'https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/sync-clickup-timesheets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'manifest-service-role-key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- =============================================================================
-- Drop legacy clickup_time_entries table
-- =============================================================================
-- Safety: This table has deny-all RLS (migration 053), no application code
-- references it, and all ClickUp data now goes to timesheet_daily_rollups.
-- =============================================================================
DROP TABLE IF EXISTS public.clickup_time_entries;

-- Report
DO $$
BEGIN
    RAISE NOTICE '082 complete:';
    RAISE NOTICE '  - Scheduled sync-clickup-timesheets (hourly at :30)';
    RAISE NOTICE '  - Dropped legacy clickup_time_entries table';
END $$;
