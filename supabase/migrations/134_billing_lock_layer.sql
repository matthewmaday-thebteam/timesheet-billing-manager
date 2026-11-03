-- ============================================================================
-- Migration 134: Billing lock layer (invoiced / closed months)
-- ============================================================================
-- Purpose:
--   A month that has been invoiced must never be silently rewritten by the
--   automatic recalculation pipeline. Owner decision ("keep and alert"): a
--   locked month is never recalculated automatically; a sync_alerts row is
--   raised instead. This migration adds ONLY the lock vocabulary — tables and
--   pure predicate/alert helpers. Nothing calls them yet; migration 135 wires
--   them into the writers.
--
--   Lock rule for (company, month) — evaluated over the company's whole
--   canonical family (company_groups primary + every member company, because
--   invoices may be logged under a pre-merge member id, e.g. "Luxus"
--   9e785353... whose May–Sep invoices predate its 2026-10-29 merge into
--   "luxus" 67b1cf93...):
--     (a) qbo_invoice_log has a 'sent' or 'pending' invoice for any family
--         company whose invoice month is >= the month. ANY later invoice locks
--         every earlier month, because carryover only flows forward: an earlier
--         month's change would leak into an already-invoiced later month.
--     (b) month <= billing_settings.billing_closed_through (owner: months
--         through 2026-09 were invoiced outside Manifest for some customers).
--     (c) a manual billing_month_locks row exists for any family company.
--
--   billing_accepted_variances records owner-accepted differences between a
--   locked month's stored summary and its current source data, so they do not
--   alert (NeoCurrency 2026-07 carryover hours: "leave them"; FoodCycler
--   Hypercare 2026-06: "it was paid" — both owner decisions of 2026-10-05).
--
-- Public contract (shared with the edge-function work; do not change shapes):
--   is_company_month_locked(p_company_id uuid, p_month date) -> boolean
--   raise_billing_alert(p_type text, p_entity_id text, p_title text,
--                       p_metadata jsonb, p_severity text) -> void
--
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Idempotent (IF NOT EXISTS / CREATE OR REPLACE /
-- ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS).
-- Rollback: supabase/rollbacks/134_billing_lock_layer_rollback.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

-- Single-row settings table (id is always TRUE).
CREATE TABLE IF NOT EXISTS public.billing_settings (
    id                     BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    billing_closed_through DATE NOT NULL
        CHECK (billing_closed_through = DATE_TRUNC('month', billing_closed_through)::DATE),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by             TEXT NOT NULL DEFAULT CURRENT_USER
);

COMMENT ON TABLE public.billing_settings IS
    'Single-row billing configuration. billing_closed_through: every month <= this date is locked for every company (migration 134).';

INSERT INTO public.billing_settings (id, billing_closed_through, updated_by)
VALUES (TRUE, DATE '2026-09-01', 'migration 134: owner decision, months through 2026-09 locked by date')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.billing_month_locks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
    month      DATE NOT NULL CHECK (month = DATE_TRUNC('month', month)::DATE),
    reason     TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    created_by TEXT NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_month_locks_company_month UNIQUE (company_id, month)
);

COMMENT ON TABLE public.billing_month_locks IS
    'Manual (company, month) billing locks. Applies to the company''s whole canonical family (migration 134).';

CREATE TABLE IF NOT EXISTS public.billing_accepted_variances (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
    month      DATE NOT NULL CHECK (month = DATE_TRUNC('month', month)::DATE),
    reason     TEXT NOT NULL CHECK (BTRIM(reason) <> ''),
    decided_by TEXT NOT NULL CHECK (BTRIM(decided_by) <> ''),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_accepted_variances_project_month UNIQUE (project_id, month)
);

COMMENT ON TABLE public.billing_accepted_variances IS
    'Owner-accepted differences between a locked month''s stored summary and its source data. Suppresses invoiced_month_source_changed alerts for that canonical project-month (migration 134).';

-- Seeds (owner decisions of 2026-10-05). Project uuids resolved read-only from
-- prod on 2026-11-03; the FK makes the insert fail loudly if either is absent.
INSERT INTO public.billing_accepted_variances (project_id, month, reason, decided_by, decided_at)
VALUES
    ('a93b6d26-89b3-4a04-b13e-dd07b838928c', DATE '2026-07-01',
     'NeoCurrency July 2026 carryover hours: "leave them" (PMS rounded 1,444.50h, carryover out 556.20h kept as invoiced)',
     'owner', TIMESTAMPTZ '2026-10-05 00:00:00+00'),
    ('eec6792f-214b-4796-8d5b-d02660b35962', DATE '2026-06-01',
     'FoodCycler Hypercare June 2026: "it was paid"',
     'owner', TIMESTAMPTZ '2026-10-05 00:00:00+00')
ON CONFLICT (project_id, month) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. RLS — authenticated may read; writes are owner-only (SQL), never via API.
--    (ENABLE without FORCE so SECURITY DEFINER helpers owned by postgres read
--    them regardless of the caller.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_month_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accepted_variances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read billing settings" ON public.billing_settings;
CREATE POLICY "Allow authenticated read billing settings"
    ON public.billing_settings FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "Allow authenticated read billing month locks" ON public.billing_month_locks;
CREATE POLICY "Allow authenticated read billing month locks"
    ON public.billing_month_locks FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "Allow authenticated read billing accepted variances" ON public.billing_accepted_variances;
CREATE POLICY "Allow authenticated read billing accepted variances"
    ON public.billing_accepted_variances FOR SELECT TO authenticated USING (TRUE);

-- Default privileges in this project grant ALL on new tables to anon and
-- authenticated; narrow them explicitly.
REVOKE ALL ON public.billing_settings, public.billing_month_locks, public.billing_accepted_variances FROM anon;
REVOKE ALL ON public.billing_settings, public.billing_month_locks, public.billing_accepted_variances FROM authenticated;
GRANT SELECT ON public.billing_settings, public.billing_month_locks, public.billing_accepted_variances TO authenticated;
GRANT SELECT ON public.billing_settings, public.billing_month_locks, public.billing_accepted_variances TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Resolution helpers
-- ----------------------------------------------------------------------------

-- Canonical company + every member company of its group (or just itself).
CREATE OR REPLACE FUNCTION public.billing_company_family(p_company_id UUID)
RETURNS TABLE(company_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    WITH canon AS (
        SELECT COALESCE(
            (SELECT g.primary_company_id
               FROM company_group_members m
               JOIN company_groups g ON g.id = m.group_id
              WHERE m.member_company_id = p_company_id),
            p_company_id
        ) AS id
    )
    SELECT canon.id FROM canon WHERE canon.id IS NOT NULL
    UNION
    SELECT m.member_company_id
      FROM canon
      JOIN company_groups g ON g.primary_company_id = canon.id
      JOIN company_group_members m ON m.group_id = g.id;
$function$;

-- Member project -> its group's primary; standalone/primary -> itself;
-- unknown project -> NULL.
CREATE OR REPLACE FUNCTION public.billing_canonical_project(p_project_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT COALESCE(pg.primary_project_id, p.id)
      FROM projects p
      LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
      LEFT JOIN project_groups pg ON pg.id = pgm.group_id
     WHERE p.id = p_project_id;
$function$;

-- Why (company, month) is locked, or NULL when it is open. The text is
-- informational (alert metadata); callers test IS NOT NULL.
CREATE OR REPLACE FUNCTION public.billing_month_lock_reason(p_company_id UUID, p_month DATE)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_month         DATE := DATE_TRUNC('month', p_month)::DATE;
    v_closed        DATE;
    v_invoice_month DATE;
    v_invoice_state TEXT;
BEGIN
    IF p_month IS NULL THEN
        RAISE EXCEPTION 'billing_month_lock_reason: p_month must not be NULL';
    END IF;

    SELECT s.billing_closed_through INTO v_closed FROM billing_settings s WHERE s.id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'billing_month_lock_reason: billing_settings row is missing';
    END IF;

    IF v_month <= v_closed THEN
        RETURN 'closed_through:' || TO_CHAR(v_closed, 'YYYY-MM');
    END IF;

    IF p_company_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM billing_month_locks l
         WHERE l.month = v_month
           AND l.company_id IN (SELECT f.company_id FROM billing_company_family(p_company_id) f)
    ) THEN
        RETURN 'manual_lock';
    END IF;

    SELECT MAKE_DATE(q.report_year, q.report_month, 1), q.status
      INTO v_invoice_month, v_invoice_state
      FROM qbo_invoice_log q
     WHERE q.status IN ('sent', 'pending')
       AND q.company_id IN (SELECT f.company_id FROM billing_company_family(p_company_id) f)
       AND MAKE_DATE(q.report_year, q.report_month, 1) >= v_month
     ORDER BY MAKE_DATE(q.report_year, q.report_month, 1)
     LIMIT 1;

    IF FOUND THEN
        RETURN 'invoice_' || v_invoice_state || ':' || TO_CHAR(v_invoice_month, 'YYYY-MM');
    END IF;

    RETURN NULL;
END;
$function$;

-- CONTRACT: is_company_month_locked(p_company_id uuid, p_month date) -> boolean
CREATE OR REPLACE FUNCTION public.is_company_month_locked(p_company_id UUID, p_month DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT billing_month_lock_reason(p_company_id, p_month) IS NOT NULL;
$function$;

-- Project-grain lock reason: canonical project -> its company -> family rule.
CREATE OR REPLACE FUNCTION public.billing_project_month_lock_reason(p_project_id UUID, p_month DATE)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_canonical UUID := billing_canonical_project(p_project_id);
    v_company   UUID;
BEGIN
    IF v_canonical IS NULL THEN
        RAISE EXCEPTION 'billing_project_month_lock_reason: project % not found', p_project_id;
    END IF;

    SELECT p.company_id INTO v_company FROM projects p WHERE p.id = v_canonical;

    RETURN billing_month_lock_reason(v_company, p_month);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_billing_month_locked(p_project_id UUID, p_month DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT billing_project_month_lock_reason(p_project_id, p_month) IS NOT NULL;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Alerting
-- ----------------------------------------------------------------------------
-- CONTRACT: raise_billing_alert(p_type, p_entity_id, p_title, p_metadata,
-- p_severity) -> void. Upserts the single ACTIVE alert per (alert_type,
-- entity_id) (partial unique index idx_sync_alerts_unique_active). A changed
-- title, detail or severity re-surfaces a dismissed alert (billing alert
-- titles embed the numbers that matter, so a new discrepancy changes the
-- title); a metadata-only refresh (e.g. which trigger reason re-checked it)
-- keeps the dismissal; an identical repeat is a no-op.
-- Optional metadata keys copied into columns: entity_type, entity_name, detail.
CREATE OR REPLACE FUNCTION public.raise_billing_alert(
    p_type      TEXT,
    p_entity_id TEXT,
    p_title     TEXT,
    p_metadata  JSONB,
    p_severity  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_metadata JSONB := COALESCE(p_metadata, '{}'::JSONB);
BEGIN
    IF p_type IS NULL OR BTRIM(p_type) = '' THEN
        RAISE EXCEPTION 'raise_billing_alert: p_type is required';
    END IF;
    IF p_entity_id IS NULL OR BTRIM(p_entity_id) = '' THEN
        -- A NULL entity_id would bypass the unique-active index and duplicate.
        RAISE EXCEPTION 'raise_billing_alert: p_entity_id is required (type %)', p_type;
    END IF;
    IF p_title IS NULL OR BTRIM(p_title) = '' THEN
        RAISE EXCEPTION 'raise_billing_alert: p_title is required (type %)', p_type;
    END IF;
    IF p_severity IS NULL OR p_severity NOT IN ('warning', 'error') THEN
        RAISE EXCEPTION 'raise_billing_alert: p_severity must be warning or error, got %', p_severity;
    END IF;
    IF JSONB_TYPEOF(v_metadata) <> 'object' THEN
        RAISE EXCEPTION 'raise_billing_alert: p_metadata must be a JSON object';
    END IF;

    INSERT INTO sync_alerts (
        alert_type, severity, title, detail,
        entity_type, entity_id, entity_name, metadata
    ) VALUES (
        p_type, p_severity, p_title, v_metadata->>'detail',
        COALESCE(v_metadata->>'entity_type', 'billing'), p_entity_id,
        v_metadata->>'entity_name', v_metadata
    )
    ON CONFLICT (alert_type, entity_id) WHERE resolved_at IS NULL
    DO UPDATE SET
        severity     = EXCLUDED.severity,
        title        = EXCLUDED.title,
        detail       = EXCLUDED.detail,
        entity_type  = EXCLUDED.entity_type,
        entity_name  = COALESCE(EXCLUDED.entity_name, sync_alerts.entity_name),
        metadata     = EXCLUDED.metadata,
        dismissed_at = CASE WHEN (sync_alerts.title, sync_alerts.detail, sync_alerts.severity)
                                 IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.detail, EXCLUDED.severity)
                            THEN NULL ELSE sync_alerts.dismissed_at END,
        dismissed_by = CASE WHEN (sync_alerts.title, sync_alerts.detail, sync_alerts.severity)
                                 IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.detail, EXCLUDED.severity)
                            THEN NULL ELSE sync_alerts.dismissed_by END,
        updated_at   = NOW()
    WHERE (sync_alerts.severity, sync_alerts.title, sync_alerts.detail,
           sync_alerts.entity_type, sync_alerts.metadata)
          IS DISTINCT FROM
          (EXCLUDED.severity, EXCLUDED.title, EXCLUDED.detail,
           EXCLUDED.entity_type, EXCLUDED.metadata);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Privileges (new functions default to EXECUTE for anon in this project)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_company_family(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_canonical_project(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_month_lock_reason(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_company_month_locked(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_project_month_lock_reason(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_billing_month_locked(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.raise_billing_alert(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.billing_company_family(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_canonical_project(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_month_lock_reason(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_month_locked(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_project_month_lock_reason(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_billing_month_locked(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.raise_billing_alert(TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;

COMMIT;
