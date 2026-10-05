-- =============================================================================
-- Migration 135: Daily sync alert digest cron job
-- =============================================================================
-- Schedules the send-sync-alert-digest Edge Function once a day at 06:45 UTC.
--
-- Why 06:45 UTC:
--   * after bamboohr-employees (06:00) and the ClickUp sync (06:30), so the
--     digest reports on alerts those runs have already refreshed;
--   * collides with nothing else -- Clockify :00, ClickUp :30,
--     bamboohr-timeoff 0 */2, audit cleanup 03:15, weekly reports Mon 12:00,
--     billing floor 05:00 on the 1st, EOM reports 06:00 on the 1st;
--   * well before the US workday, so the digest is waiting when people start.
--
-- The digest ALWAYS sends, including all-clear. sync_alerts is currently empty,
-- so silence would be the normal state and a broken digest would look identical
-- to a healthy system -- which is the exact failure this is here to remove.
--
-- Every run writes a sync_runs row with sync_type = 'alert_digest'.
-- sync-clickup-timesheets raises an `alert_digest_stale` alert when the newest
-- such row is over 36 hours old, so the hourly sync watches the daily digest
-- while the daily digest reports the hourly sync's alerts.
--
-- Uses the same vault secret (manifest-service-role-key) as the BambooHR cron
-- jobs (077), Clockify (079), ClickUp (082), weekly report (070), EOM (072).
-- =============================================================================

select cron.schedule(
  'send-sync-alert-digest',                -- job name
  '45 6 * * *',                            -- cron: daily at 06:45 UTC
  $$
  select net.http_post(
    url := 'https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/send-sync-alert-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'manifest-service-role-key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Report
DO $$
BEGIN
    RAISE NOTICE '135 complete:';
    RAISE NOTICE '  - Scheduled send-sync-alert-digest (daily at 06:45 UTC)';
END $$;

-- =============================================================================
-- Rollback
-- =============================================================================
-- select cron.unschedule('send-sync-alert-digest');
-- =============================================================================
