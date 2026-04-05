-- Enable pg_cron and pg_net extensions (both available on Supabase by default)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Store the service role key in Supabase Vault for secure access from pg_cron
-- NOTE: The actual secret value must be inserted via Supabase Dashboard > Vault,
-- or by running this in the SQL Editor with the real key substituted:
--   select vault.create_secret('<service-role-key>', 'manifest-service-role-key');
-- The cron job below reads it at runtime from the vault.

-- Schedule: every Monday at 7:00 AM EST (12:00 UTC)
-- Calls the send-weekly-revenue-report edge function with an empty body (automated mode)
select cron.schedule(
  'send-weekly-revenue-reports',          -- job name
  '0 12 * * 1',                           -- cron: every Monday at 12:00 UTC (7:00 AM EST)
  $$
  select net.http_post(
    url := 'https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/send-weekly-revenue-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'manifest-service-role-key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
