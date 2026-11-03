-- Run on the snapshot database BEFORE migrations 134-140: keeps a verbatim
-- copy of every billing output table for byte-identity checks.
CREATE SCHEMA IF NOT EXISTS t_before;
CREATE TABLE t_before.pms AS SELECT * FROM public.project_monthly_summary;
CREATE TABLE t_before.pch AS SELECT * FROM public.project_carryover_hours;
CREATE TABLE t_before.mfbs AS SELECT * FROM public.monthly_fixed_billing_summary;
CREATE TABLE t_before.alerts AS SELECT * FROM public.sync_alerts;
