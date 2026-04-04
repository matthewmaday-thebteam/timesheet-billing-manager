-- =============================================================================
-- Migration 079: Clockify timesheet sync cron job
-- =============================================================================
-- Schedules the sync-clockify-timesheets Edge Function to run every hour.
--
-- Replaces the n8n 7-node Clockify pipeline with a single Edge Function call.
--
-- Uses the same vault secret (manifest-service-role-key) as BambooHR cron jobs
-- (migration 077), weekly report (070), and EOM report (072).
-- =============================================================================

-- Clockify timesheet sync — every hour at :00
select cron.schedule(
  'sync-clockify-timesheets',               -- job name
  '0 * * * *',                              -- cron: every hour at :00
  $$
  select net.http_post(
    url := 'https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/sync-clockify-timesheets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'manifest-service-role-key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
