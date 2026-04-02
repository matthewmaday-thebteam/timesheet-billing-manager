-- Schedule EOM report generation: 1st of every month at 6:00 AM UTC (9:00 AM Europe/Sofia)
-- Generates reports for the previous month for all companies with billing data.
-- Uses the same vault secret as the weekly report cron (manifest-service-role-key).

select cron.schedule(
  'generate-eom-reports',                 -- job name
  '0 6 1 * *',                            -- cron: 1st of every month at 06:00 UTC
  $$
  select net.http_post(
    url := 'https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/generate-eom-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'manifest-service-role-key' limit 1)
    ),
    body := '{"backfill": true}'::jsonb
  );
  $$
);
