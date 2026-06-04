-- ============================================================================
-- Migration 120: DB-backed Release Notes — Table, RLS, Admin RPCs, Seed
-- ============================================================================
-- Purpose: Move release notes from the static file (src/data/releaseNotes.ts)
-- into a database table so they can be authored/published from the admin UI.
-- The static file remains as a runtime fallback (handled by the consumer page),
-- so this migration must seed the existing notes verbatim.
--
-- Mirrors existing precedent:
--   - legal_documents (publish via SECURITY DEFINER RPC, hook useLegalDocuments)
--   - migration 062 (admin-only write RLS via is_admin())
--   - migration 053 (REVOKE ALL ... FROM anon)
--   - migration 010 (is_admin() helper)
--   - update_updated_at_column() shared trigger function (009/067)
--
-- APPLICATION NOTE: This project does NOT use `supabase db push`. This file is
-- applied via the Supabase Management API. It is written to be fully
-- idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE release_notes TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.release_notes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_label TEXT NOT NULL,
    note_date     DATE NOT NULL,
    title         TEXT NOT NULL,
    highlights    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of strings
    status        TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published')),
    sort_order    INTEGER NOT NULL,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    created_by    UUID DEFAULT auth.uid(),
    updated_by    UUID
);

COMMENT ON TABLE public.release_notes IS
    'Release notes / changelog entries. Replaces the static '
    'src/data/releaseNotes.ts (which remains as a runtime fallback). '
    'Published rows are visible to all authenticated users; drafts are '
    'admin-only. Writes are admin-only (mirrors migration 062).';

-- Unique version_label keeps the seed idempotent and prevents duplicate builds.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_release_notes_version_label'
    ) THEN
        ALTER TABLE public.release_notes
            ADD CONSTRAINT uq_release_notes_version_label UNIQUE (version_label);
    END IF;
END $$;

-- ============================================================================
-- STEP 2: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_release_notes_sort_order
    ON public.release_notes (sort_order DESC);
CREATE INDEX IF NOT EXISTS idx_release_notes_status
    ON public.release_notes (status);

-- ============================================================================
-- STEP 3: UPDATED_AT TRIGGER (reuses existing update_updated_at_column)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_release_notes_updated_at ON public.release_notes;
CREATE TRIGGER trg_release_notes_updated_at
    BEFORE UPDATE ON public.release_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: ROW LEVEL SECURITY (mirrors migration 062 admin-write pattern)
-- ============================================================================

ALTER TABLE public.release_notes ENABLE ROW LEVEL SECURITY;

-- SELECT: published rows are visible to all authenticated users; admins see all.
DROP POLICY IF EXISTS "Allow authenticated read access to release notes" ON public.release_notes;
CREATE POLICY "Allow authenticated read access to release notes"
    ON public.release_notes FOR SELECT
    TO authenticated
    USING (status = 'published' OR is_admin());

-- INSERT: admin only.
DROP POLICY IF EXISTS "Allow admin insert access to release notes" ON public.release_notes;
CREATE POLICY "Allow admin insert access to release notes"
    ON public.release_notes FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

-- UPDATE: admin only.
DROP POLICY IF EXISTS "Allow admin update access to release notes" ON public.release_notes;
CREATE POLICY "Allow admin update access to release notes"
    ON public.release_notes FOR UPDATE
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- DELETE: admin only.
DROP POLICY IF EXISTS "Allow admin delete access to release notes" ON public.release_notes;
CREATE POLICY "Allow admin delete access to release notes"
    ON public.release_notes FOR DELETE
    TO authenticated
    USING (is_admin());

-- ============================================================================
-- STEP 5: GRANTS (mirrors migration 053 anon revoke)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.release_notes TO authenticated;
GRANT ALL ON public.release_notes TO service_role;
REVOKE ALL ON public.release_notes FROM anon;

-- ============================================================================
-- STEP 6: ADMIN RPCs — publish / unpublish (mirrors publish_legal_document
--          + migration 107 SECURITY DEFINER admin-assert pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_release_note(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Re-assert admin inside the SECURITY DEFINER body (defense in depth).
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.release_notes
    SET status = 'published',
        published_at = NOW(),
        updated_by = auth.uid()
    WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_release_note(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_release_note(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.publish_release_note(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.unpublish_release_note(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Access denied: admin privileges required.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE public.release_notes
    SET status = 'draft',
        published_at = NULL,
        updated_by = auth.uid()
    WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.unpublish_release_note(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unpublish_release_note(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.unpublish_release_note(UUID) TO authenticated;

-- ============================================================================
-- STEP 7: SEED the 13 existing notes from src/data/releaseNotes.ts
-- ============================================================================
-- Seeded verbatim. Index 0 = newest.
--   version_label = '1.0.0.' || (97 + 13 - 1 - i)  ->  097..109 (newest 109)
--   sort_order    = (13 - i) * 10                  ->  oldest 10 .. newest 130
--   status        = 'published'; published_at = NOW()
-- Idempotent via ON CONFLICT (version_label) DO NOTHING.

INSERT INTO public.release_notes
    (version_label, note_date, title, highlights, status, sort_order, published_at)
VALUES
    -- i=0 (newest)
    ('1.0.0.109', '2026-06-04',
     'QuickBooks Invoice Fix & Always-On SLA/Milestone Revenue',
     jsonb_build_array(
        'Fixed: QuickBooks invoices now send for customers with very large task lists. When a project''s task breakdown exceeded QuickBooks’ 4,000-character description limit, the invoice was rejected (first hit by Neocurrency at 4,968 characters). The breakdown is now safely summarized with a "…(+N more tasks, X.X hrs)" line so the invoice always sends. Billed amounts, quantities, and rates are unchanged.',
        'Fixed: fixed-rate / minimum-hours (SLA) projects now show their committed monthly revenue on reports and invoices even in months with zero logged hours. Previously a zero-activity month produced no revenue row, so the monthly amount silently disappeared (surfaced on a $9,600/mo SLA).',
        'Added: automatic month-start materialization of SLA/floor revenue so a future zero-activity month can never silently drop the committed amount again.',
        'Fixed: recovered a recorded milestone payment that was missing from a current-month total — a $7,500 June milestone that had not been applied to the monthly summary.',
        'Internal: began foundational work to resolve revenue at read time so contractual revenue (floor, fixed, and milestone) is always represented consistently across every screen and report. This groundwork is not yet active in the UI — no user-facing display changed in this release.'
     ),
     'published', 130, NOW()),

    -- i=1
    ('1.0.0.108', '2026-05-06',
     'Revenue Report Task Row Math Fix',
     jsonb_build_array(
        'Fixed: on the Revenue page, Detailed Revenue CSV, Customer Revenue Report, and End-of-Month CSV exports, the task rows now sum exactly to the project total. The project total used per-entry rounding while the task rows were using a legacy task-aggregate method, which caused the breakdown to under-state hours whenever a task had multiple time entries.',
        'No client invoice amounts were affected — already-sent invoices remain correct. The fix changes how task hours display beneath the project total, not the billable totals themselves.',
        'Future QBO invoices: task-line descriptions now sum cleanly to the line amount header.',
        'Backfilled all 56 stored End-of-Month CSVs for January through April 2026 so historical exports are consistent with the new behavior.',
        'Repaired two stale project_monthly_summary rows surfaced by the new integrity check: Paideia SLA February 2026 (under-recorded by 15 minutes / $12.50) and a phantom True Productions April 2026 row that had 7 hours stored but no underlying time entries.',
        'Added internal integrity assertion to all three billing edge functions — task-row rounded minutes must equal the project total or the function fails loudly. Future drift will surface immediately instead of silently shipping inconsistent numbers.',
        'Added explicit pagination on task_monthly_totals reads in edge functions (defense in depth against PostgREST row caps).'
     ),
     'published', 120, NOW()),

    -- i=2
    ('1.0.0.107', '2026-04-09',
     'Rate Table Guardrails & Audit Trail',
     jsonb_build_array(
        'Fixed critical bug: projects without explicit rates were showing $0/hr instead of the $45 default due to a regression in migrations 096-098.',
        'Restored 4-state rate source tracking (explicit/inherited/backfill/default) that was collapsed to 2-state, breaking the ability to distinguish inherited rates.',
        'Added audit trigger on project_monthly_rates table — was the only billing table missing audit coverage. All rate INSERT/UPDATE/DELETE now logged.',
        'Rate table now shows Inherited/Backfill/Default badges next to rates so users can see which values are explicitly set vs auto-populated.',
        'New $0 rate warning: saving a $0 rate requires explicit checkbox acknowledgment and warns about inheritance to future months.',
        'New confirmation dialog: all rate changes now show a field-by-field old → new comparison before saving.',
        'Employees page now sorted by profit generated (highest first) instead of hours worked.'
     ),
     'published', 110, NOW()),

    -- i=3
    ('1.0.0.106', '2026-04-06',
     'Per-Entry Rounding & Billing Data Hierarchy',
     jsonb_build_array(
        'Critical fix: billing engine was rounding per-task-aggregate instead of per-entry, systematically underbilling clients. New configurable rounding mode (task vs entry) per project per month via Rate page.',
        'Built 3-layer data hierarchy: Layer 1 (raw entries with rounding), Layer 2 (employee+task+day), Layer 3 (task+day, employee daily, task monthly with actual/entry-rounded/task-rounded columns).',
        'Dashboard, Burn, Employees, and Projects pages now use Layer 2/3 rounded hours — no carryover contamination in work-performed views.',
        'Employees page: revenue = rounded hours x project rate, profit = revenue - (rounded hours x employee hourly rate). Renamed "Total Revenue" to "Earned Revenue".',
        'Employee hourly rate auto-calculated on save for FT/PT (monthly cost / expected hours). Contractors enter manually.',
        'Revenue page: added C/O (Carryover) column, renamed Rounding to INC, added date range to report headers, filtered out 0-hour tasks and 0-revenue projects.',
        'Billing engine reads from task_monthly_totals with rounding mode switch. April 2026 set to per-entry rounding for all projects.',
        'Canonical company resolution trigger on project_monthly_summary prevents duplicate company rows across sync sources.',
        'Rate page: fixed project filter that was excluding 31 of 54 projects, restored existed_in_month indicator, added rounding mode toggle.',
        'Diagnostics page: export buttons for Layer 1, Layer 2 Employees, Layer 3 Tasks, Layer 3 Employee Daily Totals, Task Monthly Totals, and Legacy Billing Summary.',
        'Sync scope temporarily limited to first of current month to protect pre-April Layer data (revert in May).'
     ),
     'published', 100, NOW()),

    -- i=4
    ('1.0.0.105', '2026-04-04',
     'ClickUp Sync Migration & Revenue Trend Fix',
     jsonb_build_array(
        'Migrated ClickUp sync from n8n to Supabase Edge Function: multi-step API fetch (team → spaces → folders → per-member time entries), single-pass transform, batch upsert, hourly cron at :30',
        'ClickUp sync includes all Clockify guardrails: fetchComplete tracking, conditional cleanup, 4 reconciliation alert types (sync_incomplete, zero_entries, high_deletion_count, hours_mismatch), and sync_runs diagnostics',
        'Diagnostics page now shows ClickUp sync runs alongside BambooHR and Clockify',
        'Dropped legacy clickup_time_entries table (deny-all RLS, unused since migration to timesheet_daily_rollups)',
        'Removed old sync-bamboohr Edge Function directory (superseded by sync-bamboohr-timeoff)',
        'All 3 n8n workflows now replaced by Supabase Edge Functions — n8n decommission ready',
        'Investor Dashboard: replaced custom MonthPicker with standard RangeSelector molecule used by all other pages',
        '12-Month Revenue Trend chart: optimistic/pessimistic bands now use +/- 15% of projected Total Revenue YTD (workday-based formula with vacation deductions), shared across Dashboard and Investor page',
        'Revenue trend bands fan from last actual cumulative revenue to year-end projected values instead of evenly proportioning'
     ),
     'published', 90, NOW()),

    -- i=5
    ('1.0.0.104', '2026-04-04',
     'Clockify Sync Migration & Sync Diagnostics',
     jsonb_build_array(
        'Migrated Clockify sync from n8n to Supabase Edge Function: paginated fetch, single-pass transform, batch upsert, stale entry cleanup, and billing recalculation — all in one function running hourly via pg_cron',
        'Clockify hours reconciliation: compares per-user minutes from Clockify API against Manifest after every sync, with mismatch alerts on the dashboard',
        'New Diagnostics page: shows last 60 sync runs across all integrations (Clockify, BambooHR) with entry counts, source/manifest hours, deleted count, and error details',
        'Hours comparison uses actual DB values vs source data — mismatches are highlighted in warning on the Diagnostics table',
        'Sync alerts banner renamed from "BambooHR Sync Alerts" to generic "Sync Alerts" covering all integrations',
        'All sync functions now persist run results to sync_runs table for full audit trail'
     ),
     'published', 80, NOW()),

    -- i=6
    ('1.0.0.103', '2026-04-04',
     'BambooHR Sync Migration & Reconciliation Alerts',
     jsonb_build_array(
        'Migrated BambooHR sync from n8n to Supabase Edge Functions: employee directory syncs daily, time-off syncs every 2 hours via pg_cron',
        'New reconciliation alerts: detects time-off day mismatches between BambooHR and Manifest, and flags unmatched resources on the dashboard',
        'Alerts are group-aware (respects physical person groups) and employment-type-aware (excludes contractors, vendors, and extended leave)',
        'Dashboard alert banners with dismiss functionality and red nav badge showing active alert count',
        'Alerts auto-resolve when discrepancies are fixed on the next sync cycle',
        'New "Extended Leave" employment type for employees on long-term leave: excluded from utilization, expected hours, and BambooHR linking',
        'Employee Editor now allows saving Extended Leave resources with 0 expected hours',
        'Added Profit column to Employee Performance table across all 4 tiers (employee, company, project, task) with CSV export',
        'Paginated data fetching across timesheet queries and revenue report Edge Functions to guarantee complete results',
        'Fixed date range queries to use interval overlap logic, resolving false mismatches for cross-year time-off records',
        'Removed legacy test accounts (John Smith, Kalin Test, Jane Doe) from BambooHR employees'
     ),
     'published', 70, NOW()),

    -- i=7
    ('1.0.0.102', '2026-04-03',
     'Investor Dashboard Projection Fixes',
     jsonb_build_array(
        'Fixed Avg Daily Revenue: now averages actual per-day revenue values instead of dividing monthly total by workdays — excludes today (partial day)',
        'Fixed Projected Monthly Revenue: MTD + (avg daily × remaining workdays) instead of inflated RPC calculation',
        'Fixed Projected YTD: YTD + (avg daily × remaining year workdays) − scheduled vacation deductions for full-time (8 hrs) and part-time (5 hrs) employees',
        'Fixed Projected Quarterly Revenue: same formula scoped to the current quarter instead of multiplying one month''s projection by 3',
        'Added rest-of-year time off fetch to power vacation-adjusted projections'
     ),
     'published', 60, NOW()),

    -- i=8
    ('1.0.0.101', '2026-04-02',
     'QuickBooks Invoice Generation & EOM Report Scheduling',
     jsonb_build_array(
        'New "Send to QB" on EOM Reports: create QuickBooks invoices directly from monthly billing data with one click',
        'Invoices include per-project task breakdown with hours, Net 10 payment terms, wire transfer details, and customer email',
        'Product/Service mapping: hourly projects use "Time and Materials", milestones use "Fixed Bid Development"',
        'Duplicate prevention: each company-month can only have one invoice, with clear Sent/Error/Retry status indicators',
        '"Send All to QB" batch action with sequential sending and real-time progress ("Sending 3 of 7...")',
        'EOM report generation moved from the 5th to the 1st of each month with automated pg_cron scheduling',
        'QBO customer dropdown now shows all customers (was limited to first 100) and spans full modal width',
        'Zero-revenue companies (e.g. internal, unassigned) are now hidden from EOM Reports',
        'QuickBooks integration upgraded to production credentials with automatic fallback'
     ),
     'published', 50, NOW()),

    -- i=9
    ('1.0.0.100', '2026-03-31',
     'Investor Dashboard: Month Selector & Daily Revenue Chart',
     jsonb_build_array(
        'Added month selector to scope all Investor Dashboard data to any month, not just the current one',
        'Past months show final totals — "Projected" values and "MTD" labels are hidden for completed months',
        'New Daily Revenue bar chart shows per-day revenue breakdown for the selected month',
        'Chart displays overlapping Billed (solid) and Earned (semi-transparent) bars to visualize billing cap impact',
        'Extended BarChartAtom with yAxisFormatter and fillColor props for currency display'
     ),
     'published', 40, NOW()),

    -- i=10
    ('1.0.0.99', '2026-03-30',
     'Weekly Status Reports & Automated Email Delivery',
     jsonb_build_array(
        'New Weekly Status view on the Reports page — browse weekly revenue reports by Year > Month > Week > Company',
        'Automated Monday email delivery: weekly CSV reports sent to project managers via SendGrid for projects with "Send Weekly Report" enabled',
        'Manual resend and on-demand download for any company-week from the Weekly Status view',
        'Reports now match the exact 9-column format from the Revenue export (includes Rate, Project Revenue, Company Revenue)',
        'Replaced n8n-based report automation with built-in edge function and pg_cron scheduling',
        'Renamed "EOM Reports" to "Reports" with End of Month and Weekly Status toggle'
     ),
     'published', 30, NOW()),

    -- i=11
    ('1.0.0.98', '2026-03-05',
     'Security Hardening & Employee Fixes',
     jsonb_build_array(
        'Added "Send Weekly Reports" toggle to Edit Project modal',
        'Added filtering by Manager, Company, and Report status on Project Management page',
        'Fixed employee names not displaying when auto-created from timesheet data',
        'Fixed billing summaries not updating when company groups change',
        'Hardened database security: admin-only writes on financial tables, RLS on core tables, JWT verification on Edge Functions'
     ),
     'published', 20, NOW()),

    -- i=12 (oldest)
    ('1.0.0.97', '2026-03-04',
     'BambooHR Time-Off Sync Fix',
     jsonb_build_array(
        'Fixed cancelled vacation days still appearing in Manifest',
        'Fixed approved vacation days not syncing from BambooHR',
        'Added automatic cleanup of stale time-off records'
     ),
     'published', 10, NOW())
ON CONFLICT (version_label) DO NOTHING;

-- ============================================================================
-- STEP 8: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_table_exists  BOOLEAN;
    v_policy_count  INTEGER;
    v_row_count     INTEGER;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'release_notes'
    ) INTO v_table_exists;

    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'release_notes';

    SELECT COUNT(*) INTO v_row_count FROM public.release_notes;

    RAISE NOTICE 'Migration 120 Complete:';
    RAISE NOTICE '  - release_notes table: %', CASE WHEN v_table_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - RLS policies on release_notes: %', v_policy_count;
    RAISE NOTICE '  - seeded rows present: %', v_row_count;
    RAISE NOTICE '  - publish_release_note / unpublish_release_note RPCs created';
    RAISE NOTICE '  - updated_at trigger attached (update_updated_at_column)';
    RAISE NOTICE '  - anon access revoked';
END $$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (run manually if needed — NOT executed by this migration)
-- ============================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.publish_release_note(UUID);
--   DROP FUNCTION IF EXISTS public.unpublish_release_note(UUID);
--   DROP TABLE IF EXISTS public.release_notes;   -- drops policies, trigger,
--                                                 -- indexes, and constraints
-- COMMIT;
-- ============================================================================
