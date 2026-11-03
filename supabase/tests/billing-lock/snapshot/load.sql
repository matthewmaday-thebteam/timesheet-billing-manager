-- Load a read-only billing-table extract (JSON per table, from pull.mjs) into a
-- prod-schema test database. Usage: PGOPTIONS="-c snap.dir=/abs/dir" psql -f load.sql
SET session_replication_role = replica;
DO $$
DECLARE t text; cols text; d text := current_setting('snap.dir');
BEGIN
  FOREACH t IN ARRAY ARRAY['employment_types','companies','company_groups','company_group_members','projects','project_groups','project_group_members','project_monthly_rates','project_monthly_rounding','project_monthly_billing_limits','project_monthly_active_status','billings','billing_transactions','project_monthly_summary','project_carryover_hours','monthly_fixed_billing_summary','task_monthly_totals','qbo_invoice_log','eom_reports','sync_alerts','recalculation_queue','timesheet_daily_rollups'] LOOP
    EXECUTE format('DELETE FROM public.%I', t);
    SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) INTO cols
      FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND is_generated='NEVER';
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM json_populate_recordset(NULL::public.%I, pg_read_file(%L)::json)', t, cols, cols, t, d || '/' || t || '.json');
  END LOOP;
END $$;
SET session_replication_role = origin;
