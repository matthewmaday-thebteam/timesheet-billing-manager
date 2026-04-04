-- =============================================================================
-- Migration 077: BambooHR sync cron jobs (split into two functions)
-- =============================================================================
-- Replaces the monolithic sync-bamboohr Edge Function with two targeted functions:
--
--   1. sync-bamboohr-employees — daily employee directory sync (6 AM UTC)
--   2. sync-bamboohr-timeoff   — time-off requests every 2 hours
--
-- Uses the same vault secret (manifest-service-role-key) as the weekly report
-- and EOM report cron jobs (migrations 070 and 072).
-- =============================================================================

-- Unschedule the old monolithic job if it exists
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-bamboohr') then
    perform cron.unschedule('sync-bamboohr');
  end if;
end
$$;

-- 1. Employee directory sync — daily at 6:00 AM UTC
select cron.schedule(
  'sync-bamboohr-employees',                -- job name
  '0 6 * * *',                              -- cron: daily at 06:00 UTC
  $$
  select net.http_post(
    url := 'https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/sync-bamboohr-employees',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'manifest-service-role-key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 2. Time-off requests sync — every 2 hours at :00
select cron.schedule(
  'sync-bamboohr-timeoff',                  -- job name
  '0 */2 * * *',                            -- cron: every 2 hours at :00
  $$
  select net.http_post(
    url := 'https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/sync-bamboohr-timeoff',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'manifest-service-role-key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
