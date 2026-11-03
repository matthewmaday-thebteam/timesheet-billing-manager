-- ============================================================================
-- Migration 135: Gate every billing writer on the billing lock
-- ============================================================================
-- Purpose:
--   Root-cause analysis (2026-11) showed invoiced months being rewritten not
--   only by the timesheet sync queue but by every config trigger (rates,
--   rounding, limits, active status, company groups), by the carryover
--   cascade, by recalculate_fixed_billing_month (fires synchronously from
--   billing_transactions for ALL companies of a month), and by the
--   materialize-billing-floor cron's direct path. Gating only the queue would
--   leave those paths open, so the gate lives in the writers themselves:
--
--     recalculate_project_month(uuid, date)       PMS row + carryover + cascade
--     recalculate_fixed_billing_month(date)       milestone_override_cents +
--                                                 monthly_fixed_billing_summary
--     sync_project_carryover(uuid,date,num,num,num) project_carryover_hours
--
--   Locked month => no write; an `invoiced_month_source_changed` alert is
--   raised (entity_id '<canonical project uuid>:<YYYY-MM>') ONLY when the
--   would-be result actually differs from what is stored, and never for a
--   project-month listed in billing_accepted_variances. A carryover cascade
--   that would change a locked month's carryover-in stops there and alerts.
--
--   Deliberate manual override (owner only, never automation):
--       BEGIN;
--       SET LOCAL manifest.allow_locked_recalc = 'on';
--       SELECT recalculate_project_month('<uuid>', '2026-09-01');
--       COMMIT;
--   It is honoured only when the session's login role is a member of
--   `postgres` (SQL editor / psql). API sessions log in as `authenticator`
--   and can never activate it. Every overridden write raises a
--   `locked_month_override_recalc` alert as an audit trail.
--
--   Function bodies are the LIVE prod definitions (pg_get_functiondef,
--   2026-11-03; identical md5 to the prod catalog) with the gate inserted.
--   Signatures, return types, volatility, SECURITY and search_path settings
--   are unchanged so every caller (sync edge functions, triggers,
--   recalculate_month, materialize_billing_floor_projects) is unaffected.
--
-- Depends on: 134.
-- APPLICATION NOTE: This project does NOT use `supabase db push`. Applied via the
-- Supabase Management API. Idempotent (CREATE OR REPLACE).
-- Rollback: supabase/rollbacks/135_billing_lock_gate_writers_rollback.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Manual override predicate
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_locked_recalc_override()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT COALESCE(current_setting('manifest.allow_locked_recalc', TRUE), '') = 'on'
       AND pg_has_role(session_user, 'postgres', 'MEMBER');
$function$;

COMMENT ON FUNCTION public.billing_locked_recalc_override() IS
    'TRUE only when the owner explicitly ran SET LOCAL manifest.allow_locked_recalc = ''on'' from a postgres-member login (never via the API). Migration 135.';

-- ----------------------------------------------------------------------------
-- 2. Stored vs would-be comparison for a (canonical) project-month
-- ----------------------------------------------------------------------------
-- Returns the stored summary values next to what the engine would write now
-- (resolve_project_month_revenue is the engine's pure routine), plus
-- `changed`. pms_min = stored rounded minutes; tmt_min = rounded minutes the
-- engine reads from task_monthly_totals today.
CREATE OR REPLACE FUNCTION public.billing_project_month_compare(p_project_id UUID, p_month DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_month     DATE := DATE_TRUNC('month', p_month)::DATE;
    v_canonical UUID := billing_canonical_project(p_project_id);
    v           project_month_revenue;
    s           project_monthly_summary%ROWTYPE;
    v_changed   BOOLEAN;
BEGIN
    IF v_canonical IS NULL THEN
        RAISE EXCEPTION 'billing_project_month_compare: project % not found', p_project_id;
    END IF;

    SELECT * INTO v FROM resolve_project_month_revenue(v_canonical, v_month);

    SELECT * INTO s
      FROM project_monthly_summary pms
     WHERE pms.project_id = v_canonical
       AND pms.summary_month = v_month;

    IF s.id IS NULL THEN
        v_changed := COALESCE(v.rounded_minutes, 0) <> 0
                  OR COALESCE(v.billed_revenue_cents, 0) <> 0
                  OR COALESCE(v.carryover_out_hours, 0) <> 0;
    ELSE
        v_changed := (s.rounded_minutes, s.billed_hours, s.billed_revenue_cents,
                      s.carryover_in_hours, s.carryover_out_hours, s.minimum_padding_hours)
                     IS DISTINCT FROM
                     (v.rounded_minutes, v.billed_hours, v.billed_revenue_cents,
                      v.carryover_in_hours, v.carryover_out_hours, v.minimum_padding_hours);
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'changed',                   v_changed,
        'pms_exists',                s.id IS NOT NULL,
        'pms_min',                   s.rounded_minutes,
        'tmt_min',                   v.rounded_minutes,
        'pms_billed_hours',          s.billed_hours,
        'new_billed_hours',          v.billed_hours,
        'pms_billed_revenue_cents',  s.billed_revenue_cents,
        'new_billed_revenue_cents',  v.billed_revenue_cents,
        'pms_carryover_in_hours',    s.carryover_in_hours,
        'new_carryover_in_hours',    v.carryover_in_hours,
        'pms_carryover_out_hours',   s.carryover_out_hours,
        'new_carryover_out_hours',   v.carryover_out_hours
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Locked-month alert (shared by the writers, the drain and reconcile)
-- ----------------------------------------------------------------------------
-- Raises `invoiced_month_source_changed` for a locked canonical project-month
-- unless it is an accepted variance. p_extra: NULL => alert only if the
-- comparison shows a change; non-NULL => the caller has independent evidence
-- of a change (carryover cascade, milestone, reconcile drift) and the alert
-- is raised regardless; its keys are merged into metadata and an optional
-- 'title_detail' key replaces the hours detail in the title.
-- Returns TRUE when an alert was raised/refreshed.
CREATE OR REPLACE FUNCTION public.billing_alert_locked_month(
    p_project_id  UUID,
    p_month       DATE,
    p_reason      TEXT,
    p_lock_reason TEXT,
    p_extra       JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_month     DATE := DATE_TRUNC('month', p_month)::DATE;
    v_canonical UUID := billing_canonical_project(p_project_id);
    v_cmp       JSONB;
    v_project   RECORD;
    v_detail    TEXT;
BEGIN
    IF v_canonical IS NULL THEN
        RAISE EXCEPTION 'billing_alert_locked_month: project % not found', p_project_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM billing_accepted_variances a
         WHERE a.project_id = v_canonical AND a.month = v_month
    ) THEN
        RETURN FALSE;
    END IF;

    v_cmp := billing_project_month_compare(v_canonical, v_month);
    IF p_extra IS NULL AND NOT (v_cmp->>'changed')::BOOLEAN THEN
        RETURN FALSE;
    END IF;

    SELECT p.project_name, p.company_id,
           COALESCE(c.display_name, c.client_name) AS company_name,
           vcc.canonical_company_id
      INTO v_project
      FROM projects p
      LEFT JOIN v_company_canonical vcc ON vcc.company_id = p.company_id
      LEFT JOIN companies c ON c.id = vcc.canonical_company_id
     WHERE p.id = v_canonical;

    v_detail := COALESCE(
        p_extra->>'title_detail',
        FORMAT('stored %sh, source now %sh',
               COALESCE(ROUND((v_cmp->>'pms_min')::NUMERIC / 60, 2)::TEXT, 'none'),
               COALESCE(ROUND((v_cmp->>'tmt_min')::NUMERIC / 60, 2)::TEXT, '0'))
    );

    PERFORM raise_billing_alert(
        'invoiced_month_source_changed',
        v_canonical::TEXT || ':' || TO_CHAR(v_month, 'YYYY-MM'),
        FORMAT('%s / %s %s: locked (invoiced) month changed at source, not recalculated (%s)',
               COALESCE(v_project.company_name, 'Unknown company'), v_project.project_name,
               TO_CHAR(v_month, 'YYYY-MM'), v_detail),
        v_cmp - 'changed'
            || COALESCE(p_extra - 'title_detail', '{}'::JSONB)
            || JSONB_BUILD_OBJECT(
                   'entity_type', 'project_month',
                   'entity_name', v_project.project_name,
                   'project_id',  v_canonical,
                   'month',       TO_CHAR(v_month, 'YYYY-MM'),
                   'company_id',  v_project.canonical_company_id,
                   'reason',      p_reason,
                   'lock_reason', p_lock_reason),
        'warning'
    );
    RETURN TRUE;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. The gate: may this writer write (project, month)?
-- ----------------------------------------------------------------------------
-- TRUE  => open month, or locked month under the explicit owner override
--          (override use is recorded as a `locked_month_override_recalc` alert).
-- FALSE => locked: caller must skip the write; the alert rule above applied.
CREATE OR REPLACE FUNCTION public.billing_lock_gate(
    p_project_id UUID,
    p_month      DATE,
    p_reason     TEXT,
    p_extra      JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_lock  TEXT := billing_project_month_lock_reason(p_project_id, p_month);
BEGIN
    IF v_lock IS NULL THEN
        RETURN TRUE;
    END IF;

    IF billing_locked_recalc_override() THEN
        PERFORM raise_billing_alert(
            'locked_month_override_recalc',
            billing_canonical_project(p_project_id)::TEXT || ':' || TO_CHAR(v_month, 'YYYY-MM'),
            FORMAT('Locked month %s recalculated by manual override (%s)', TO_CHAR(v_month, 'YYYY-MM'), p_reason),
            JSONB_BUILD_OBJECT(
                'entity_type', 'project_month',
                'project_id',  billing_canonical_project(p_project_id),
                'month',       TO_CHAR(v_month, 'YYYY-MM'),
                'reason',      p_reason,
                'lock_reason', v_lock,
                'session_user', session_user::TEXT,
                'at',          NOW()),
            'warning'
        );
        RAISE NOTICE 'billing lock override: writing locked month % for project % (%)', v_month, p_project_id, p_reason;
        RETURN TRUE;
    END IF;

    PERFORM billing_alert_locked_month(p_project_id, v_month, p_reason, v_lock, p_extra);
    RETURN FALSE;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. recalculate_project_month — live body + gate (month itself, and the
--    carryover cascade into the next month)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_project_month(p_project_id uuid, p_month date)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_company_id UUID;
    v_external_project_id TEXT;

    -- Pure rule output
    v project_month_revenue;

    -- Company-grain invoiced (migration 095 STEP 7) — stays in the write engine
    v_invoiced_revenue_cents BIGINT := 0;
BEGIN
    -- Resolve project info (mirror of migration 095 guard clauses, so behavior
    -- on missing project / NULL company is identical: WARNING + RETURN, no row).
    SELECT p.project_id, p.company_id
    INTO v_external_project_id, v_company_id
    FROM projects p WHERE p.id = p_project_id;

    IF v_external_project_id IS NULL THEN
        RAISE WARNING 'Project % not found', p_project_id;
        RETURN;
    END IF;

    IF v_company_id IS NULL THEN
        RAISE WARNING 'Project % has NULL company_id', p_project_id;
        RETURN;
    END IF;

    -- Billing lock gate (migration 135): a locked (invoiced / closed) month is
    -- never rewritten automatically. billing_lock_gate raises the
    -- invoiced_month_source_changed alert when the source actually changed.
    IF NOT billing_lock_gate(p_project_id, v_month, 'recalculate_project_month') THEN
        RETURN;
    END IF;

    -- (a) Compute every project-grain field via the shared pure routine.
    SELECT * INTO v FROM resolve_project_month_revenue(p_project_id, v_month);

    IF v IS NULL THEN
        -- Defensive: resolver returned NULL only if project/company vanished
        -- between the guard above and the call. Match prior no-op behavior.
        RETURN;
    END IF;

    -- (b) STEP 7 (migration 095 L255-260): company-grain invoiced revenue.
    SELECT COALESCE(SUM(bt.amount_cents), 0)
    INTO v_invoiced_revenue_cents
    FROM billing_transactions bt
    JOIN billings b ON b.id = bt.billing_id
    WHERE b.company_id = v_company_id
        AND bt.transaction_month = v_month;

    -- (c) STEP 8 (migration 095 L265-317): UPSERT the snapshot row — identical
    -- column list, identical ON CONFLICT, identical calculation_version. Note:
    -- milestone_override_cents is intentionally NOT in this list (unchanged from
    -- migration 095; owned by recalculate_fixed_billing_month).
    INSERT INTO project_monthly_summary (
        summary_month, project_id, company_id,
        actual_minutes, rounded_minutes, actual_hours, rounded_hours,
        carryover_in_hours, adjusted_hours, billed_hours,
        unbillable_hours, carryover_out_hours, minimum_padding_hours,
        minimum_applied, maximum_applied, has_billing_limits, is_active_used,
        base_revenue_cents, billed_revenue_cents, invoiced_revenue_cents,
        rate_used, rate_source, rounding_used,
        minimum_hours_config, maximum_hours_config, carryover_enabled_config,
        resource_count, task_count, source_entry_count,
        calculated_at, calculation_version
    ) VALUES (
        v_month, p_project_id, v_company_id,
        v.actual_minutes, v.rounded_minutes, v.actual_hours, v.rounded_hours,
        v.carryover_in_hours, v.adjusted_hours, v.billed_hours,
        v.unbillable_hours, v.carryover_out_hours, v.minimum_padding_hours,
        v.minimum_applied, v.maximum_applied, v.has_billing_limits, v.is_active_used,
        v.base_revenue_cents, v.billed_revenue_cents, v_invoiced_revenue_cents,
        v.rate_used, v.rate_source, v.rounding_used,
        v.minimum_hours_config, v.maximum_hours_config, v.carryover_enabled_config,
        v.resource_count, v.task_count, v.source_entry_count,
        NOW(), 'v2.1-tmt-canonical'
    )
    ON CONFLICT (project_id, summary_month) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        actual_minutes = EXCLUDED.actual_minutes,
        rounded_minutes = EXCLUDED.rounded_minutes,
        actual_hours = EXCLUDED.actual_hours,
        rounded_hours = EXCLUDED.rounded_hours,
        carryover_in_hours = EXCLUDED.carryover_in_hours,
        adjusted_hours = EXCLUDED.adjusted_hours,
        billed_hours = EXCLUDED.billed_hours,
        unbillable_hours = EXCLUDED.unbillable_hours,
        carryover_out_hours = EXCLUDED.carryover_out_hours,
        minimum_padding_hours = EXCLUDED.minimum_padding_hours,
        minimum_applied = EXCLUDED.minimum_applied,
        maximum_applied = EXCLUDED.maximum_applied,
        has_billing_limits = EXCLUDED.has_billing_limits,
        is_active_used = EXCLUDED.is_active_used,
        base_revenue_cents = EXCLUDED.base_revenue_cents,
        billed_revenue_cents = EXCLUDED.billed_revenue_cents,
        invoiced_revenue_cents = EXCLUDED.invoiced_revenue_cents,
        rate_used = EXCLUDED.rate_used,
        rate_source = EXCLUDED.rate_source,
        rounding_used = EXCLUDED.rounding_used,
        minimum_hours_config = EXCLUDED.minimum_hours_config,
        maximum_hours_config = EXCLUDED.maximum_hours_config,
        carryover_enabled_config = EXCLUDED.carryover_enabled_config,
        resource_count = EXCLUDED.resource_count,
        task_count = EXCLUDED.task_count,
        source_entry_count = EXCLUDED.source_entry_count,
        calculated_at = NOW(),
        calculation_version = EXCLUDED.calculation_version;

    -- (d) STEP 9 (migration 095 L322-364): carryover-out WRITE + queue cascade,
    -- byte-identical. Uses v.carryover_out_hours / v.rounded_hours /
    -- v.maximum_hours_config / v.carryover_enabled_config from the pure record
    -- (same values the inline engine computed).
    DECLARE
        v_old_carryover_out NUMERIC(10,2);
        v_next_month DATE := (v_month + INTERVAL '1 month')::DATE;
    BEGIN
        SELECT COALESCE(SUM(pch.carryover_hours), 0)
        INTO v_old_carryover_out
        FROM project_carryover_hours pch
        WHERE pch.project_id = p_project_id
            AND pch.source_month = v_month;

        IF v.carryover_out_hours IS DISTINCT FROM v_old_carryover_out THEN
            -- Billing lock gate (migration 135): this month's carryover-out is
            -- the next month's carryover-in. If the next month is locked the
            -- cascade stops here: nothing is written or queued for it, and an
            -- invoiced_month_source_changed alert is raised for it instead.
            IF NOT billing_lock_gate(
                p_project_id, v_next_month, 'carryover_cascade',
                JSONB_BUILD_OBJECT(
                    'source_month', TO_CHAR(v_month, 'YYYY-MM'),
                    'carryover_in_stored_hours', v_old_carryover_out,
                    'carryover_in_new_hours', v.carryover_out_hours,
                    'title_detail', FORMAT('carryover in from %s would change %sh -> %sh',
                        TO_CHAR(v_month, 'YYYY-MM'), v_old_carryover_out, v.carryover_out_hours))
            ) THEN
                RETURN;
            END IF;

            IF v.carryover_enabled_config AND v.carryover_out_hours > 0 THEN
                INSERT INTO project_carryover_hours (
                    project_id, carryover_month, source_month,
                    carryover_hours, actual_hours_worked, maximum_applied
                ) VALUES (
                    p_project_id, v_next_month, v_month,
                    v.carryover_out_hours, v.rounded_hours, v.maximum_hours_config
                )
                ON CONFLICT (project_id, carryover_month, source_month) DO UPDATE SET
                    carryover_hours = EXCLUDED.carryover_hours,
                    actual_hours_worked = EXCLUDED.actual_hours_worked,
                    maximum_applied = EXCLUDED.maximum_applied,
                    calculated_at = NOW();

                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (p_project_id, v_next_month, 'cascade')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;

            ELSIF v_old_carryover_out > 0 THEN
                DELETE FROM project_carryover_hours
                WHERE project_id = p_project_id
                    AND source_month = v_month
                    AND carryover_month = v_next_month;

                INSERT INTO recalculation_queue (project_id, queue_month, reason)
                VALUES (p_project_id, v_next_month, 'cascade')
                ON CONFLICT (project_id, queue_month) WHERE processed_at IS NULL
                DO NOTHING;
            END IF;
        END IF;
    END;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5b. sync_project_carryover — live body + gate on both months it touches
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_project_carryover(p_project_id uuid, p_source_month date, p_carryover_hours numeric, p_actual_hours_worked numeric, p_maximum_applied numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_source_month DATE := DATE_TRUNC('month', p_source_month)::DATE;
    v_carryover_month DATE := (v_source_month + INTERVAL '1 month')::DATE;
    v_existing NUMERIC;
    v_extra JSONB;
BEGIN
    -- Billing lock gate (migration 135): the row is both the source month's
    -- carryover-out and the carryover month's carryover-in; both must be open.
    SELECT pch.carryover_hours INTO v_existing
    FROM project_carryover_hours pch
    WHERE pch.project_id = p_project_id
      AND pch.carryover_month = v_carryover_month
      AND pch.source_month = v_source_month;

    IF COALESCE(v_existing, 0) IS DISTINCT FROM
       (CASE WHEN p_carryover_hours > 0 THEN p_carryover_hours ELSE 0 END) THEN
        v_extra := JSONB_BUILD_OBJECT(
            'source_month', TO_CHAR(v_source_month, 'YYYY-MM'),
            'carryover_stored_hours', v_existing,
            'carryover_new_hours', p_carryover_hours,
            'title_detail', FORMAT('carryover %s -> %s would change %sh -> %sh',
                TO_CHAR(v_source_month, 'YYYY-MM'), TO_CHAR(v_carryover_month, 'YYYY-MM'),
                COALESCE(v_existing, 0), p_carryover_hours));
    END IF;

    IF NOT billing_lock_gate(p_project_id, v_source_month, 'sync_project_carryover', v_extra)
       OR NOT billing_lock_gate(p_project_id, v_carryover_month, 'sync_project_carryover', v_extra) THEN
        RETURN;
    END IF;

    IF p_carryover_hours > 0 THEN
        -- Upsert carryover into next month
        INSERT INTO project_carryover_hours (
            project_id,
            carryover_month,
            source_month,
            carryover_hours,
            actual_hours_worked,
            maximum_applied,
            calculated_at
        ) VALUES (
            p_project_id,
            v_carryover_month,
            v_source_month,
            p_carryover_hours,
            p_actual_hours_worked,
            p_maximum_applied,
            NOW()
        )
        ON CONFLICT (project_id, carryover_month, source_month)
        DO UPDATE SET
            carryover_hours = EXCLUDED.carryover_hours,
            actual_hours_worked = EXCLUDED.actual_hours_worked,
            maximum_applied = EXCLUDED.maximum_applied,
            calculated_at = NOW(),
            updated_at = NOW();
    ELSE
        -- Remove stale carryover if hours dropped to zero (e.g., time corrections)
        DELETE FROM project_carryover_hours
        WHERE project_id = p_project_id
          AND carryover_month = v_carryover_month
          AND source_month = v_source_month;
    END IF;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. recalculate_fixed_billing_month — per-company gate
-- ----------------------------------------------------------------------------
-- The would-be values are factored into two read-only helpers so the write
-- statements and the locked-month alert scan use one definition (verbatim
-- from the live Part 1 / Part 3 sub-selects).
CREATE OR REPLACE FUNCTION public.billing_milestone_override_targets(p_month DATE)
RETURNS TABLE(project_id UUID, total_cents BIGINT)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT
      p.id AS project_id,
      COALESCE(SUM(bt.amount_cents), 0)::BIGINT AS total_cents
    FROM billings b
    JOIN projects p ON p.id = b.linked_project_id
    LEFT JOIN billing_transactions bt
      ON bt.billing_id = b.id
      AND bt.transaction_month = DATE_TRUNC('month', p_month)::DATE
    WHERE b.type = 'revenue_milestone'
      AND b.linked_project_id IS NOT NULL
    GROUP BY p.id;
$function$;

CREATE OR REPLACE FUNCTION public.billing_fixed_billing_targets(p_month DATE)
RETURNS TABLE(company_id UUID, fixed_billing_cents BIGINT, fixed_billing_count INTEGER)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT
      b.company_id,
      COALESCE(SUM(bt.amount_cents), 0)::BIGINT,
      COUNT(DISTINCT b.id)::INTEGER
    FROM billings b
    JOIN billing_transactions bt ON bt.billing_id = b.id
    WHERE bt.transaction_month = DATE_TRUNC('month', p_month)::DATE
      AND NOT (
        b.type = 'revenue_milestone'
        AND b.linked_project_id IS NOT NULL
      )
    GROUP BY b.company_id;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_fixed_billing_month(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month DATE := DATE_TRUNC('month', p_month)::DATE;
  -- Billing lock gate (migration 135): companies (every family member
  -- included) whose month is locked, and whether the month is date-locked
  -- (which also covers rows with a NULL company).
  v_override BOOLEAN := billing_locked_recalc_override();
  v_locked UUID[];
  v_date_locked BOOLEAN;
  r RECORD;
BEGIN
  v_locked := ARRAY(
    SELECT c.id FROM companies c
    WHERE billing_month_lock_reason(c.id, v_month) IS NOT NULL
  );
  v_date_locked := billing_month_lock_reason(NULL, v_month) IS NOT NULL;

  IF v_override THEN
    IF cardinality(v_locked) > 0 OR v_date_locked THEN
      PERFORM raise_billing_alert(
        'locked_month_override_recalc',
        'fixed_billing:' || TO_CHAR(v_month, 'YYYY-MM'),
        FORMAT('Locked month %s fixed/milestone billing recalculated by manual override', TO_CHAR(v_month, 'YYYY-MM')),
        JSONB_BUILD_OBJECT('entity_type', 'month', 'month', TO_CHAR(v_month, 'YYYY-MM'),
                           'reason', 'recalculate_fixed_billing_month',
                           'session_user', session_user::TEXT, 'at', NOW()),
        'warning');
    END IF;
    v_locked := '{}';
    v_date_locked := FALSE;
  ELSE
    -- Locked rows are never written; alert where the value would change.
    FOR r IN
      SELECT pms.project_id, pms.milestone_override_cents AS stored_cents, sub.total_cents AS new_cents
      FROM project_monthly_summary pms
      LEFT JOIN billing_milestone_override_targets(v_month) sub ON sub.project_id = pms.project_id
      WHERE pms.summary_month = v_month
        AND COALESCE(pms.company_id = ANY(v_locked), v_date_locked)
        AND (
          (sub.project_id IS NOT NULL AND pms.milestone_override_cents IS DISTINCT FROM sub.total_cents)
          OR (sub.project_id IS NULL AND pms.milestone_override_cents IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM billings b
                              WHERE b.linked_project_id = pms.project_id
                                AND b.type = 'revenue_milestone'))
        )
    LOOP
      PERFORM billing_alert_locked_month(
        r.project_id, v_month, 'fixed_billing_milestone',
        billing_project_month_lock_reason(r.project_id, v_month),
        JSONB_BUILD_OBJECT(
          'milestone_override_stored_cents', r.stored_cents,
          'milestone_override_new_cents', r.new_cents,
          'title_detail', FORMAT('milestone override would change %s -> %s cents',
                                 COALESCE(r.stored_cents::TEXT, 'none'), COALESCE(r.new_cents::TEXT, 'none'))));
    END LOOP;

    FOR r IN
      SELECT COALESCE(t.company_id, f.company_id) AS company_id,
             f.fixed_billing_cents AS stored_cents, t.fixed_billing_cents AS new_cents,
             f.fixed_billing_count AS stored_count, t.fixed_billing_count AS new_count
      FROM billing_fixed_billing_targets(v_month) t
      FULL JOIN (SELECT * FROM monthly_fixed_billing_summary WHERE summary_month = v_month) f
        ON f.company_id = t.company_id
      WHERE COALESCE(COALESCE(t.company_id, f.company_id) = ANY(v_locked), v_date_locked)
        AND (f.fixed_billing_cents, f.fixed_billing_count)
            IS DISTINCT FROM (t.fixed_billing_cents, t.fixed_billing_count)
    LOOP
      PERFORM raise_billing_alert(
        'invoiced_month_source_changed',
        r.company_id::TEXT || ':' || TO_CHAR(v_month, 'YYYY-MM'),
        FORMAT('%s %s: locked (invoiced) month fixed billing changed at source, not recalculated (%s -> %s cents)',
               (SELECT COALESCE(c.display_name, c.client_name) FROM companies c WHERE c.id = r.company_id),
               TO_CHAR(v_month, 'YYYY-MM'),
               COALESCE(r.stored_cents::TEXT, 'none'), COALESCE(r.new_cents::TEXT, 'none')),
        JSONB_BUILD_OBJECT(
          'entity_type', 'company_month', 'scope', 'fixed_billing',
          'company_id', r.company_id, 'month', TO_CHAR(v_month, 'YYYY-MM'),
          'fixed_billing_stored_cents', r.stored_cents, 'fixed_billing_new_cents', r.new_cents,
          'fixed_billing_stored_count', r.stored_count, 'fixed_billing_new_count', r.new_count,
          'reason', 'recalculate_fixed_billing_month',
          'lock_reason', billing_month_lock_reason(r.company_id, v_month)),
        'warning');
    END LOOP;
  END IF;

  -- ========================================================================
  -- Part 1: Update milestone_override_cents on project_monthly_summary
  -- For each project with a linked revenue_milestone billing, sum the
  -- transaction amounts for the month. If no transactions exist, override = 0.
  -- (migration 135: locked company-months excluded)
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = sub.total_cents,
      updated_at = NOW()
  FROM billing_milestone_override_targets(v_month) sub
  WHERE pms.project_id = sub.project_id
    AND pms.summary_month = v_month
    AND NOT COALESCE(pms.company_id = ANY(v_locked), v_date_locked);

  -- ========================================================================
  -- Part 2: Clear milestone_override_cents for projects that NO LONGER
  -- have any milestone billing linked (e.g., milestone was deleted or
  -- unlinked from the project entirely)
  -- (migration 135: locked company-months excluded)
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = NULL,
      updated_at = NOW()
  WHERE pms.summary_month = v_month
    AND pms.milestone_override_cents IS NOT NULL
    AND NOT COALESCE(pms.company_id = ANY(v_locked), v_date_locked)
    AND NOT EXISTS (
      SELECT 1
      FROM billings b
      WHERE b.linked_project_id = pms.project_id
        AND b.type = 'revenue_milestone'
    );

  -- ========================================================================
  -- Part 3: Upsert monthly_fixed_billing_summary per company
  -- Fixed billings = everything EXCEPT linked milestones
  -- This matches the Dashboard's filteredBillingCents filter:
  --   NOT (type='revenue_milestone' AND linked_project_id IS NOT NULL)
  -- (migration 135: locked company-months excluded)
  -- ========================================================================
  INSERT INTO monthly_fixed_billing_summary (
    summary_month, company_id,
    fixed_billing_cents, fixed_billing_count,
    calculated_at
  )
  SELECT
    v_month,
    t.company_id,
    t.fixed_billing_cents,
    t.fixed_billing_count,
    NOW()
  FROM billing_fixed_billing_targets(v_month) t
  WHERE NOT COALESCE(t.company_id = ANY(v_locked), v_date_locked)
  ON CONFLICT (company_id, summary_month) DO UPDATE SET
    fixed_billing_cents = EXCLUDED.fixed_billing_cents,
    fixed_billing_count = EXCLUDED.fixed_billing_count,
    calculated_at = NOW(),
    updated_at = NOW();

  -- ========================================================================
  -- Part 4: Clean up fixed billing rows for companies that no longer have
  -- any fixed billings for this month
  -- (migration 135: locked company-months excluded)
  -- ========================================================================
  DELETE FROM monthly_fixed_billing_summary fbs
  WHERE fbs.summary_month = v_month
    AND NOT COALESCE(fbs.company_id = ANY(v_locked), v_date_locked)
    AND NOT EXISTS (
      SELECT 1
      FROM billings b
      JOIN billing_transactions bt ON bt.billing_id = b.id
      WHERE bt.transaction_month = v_month
        AND b.company_id = fbs.company_id
        AND NOT (
          b.type = 'revenue_milestone'
          AND b.linked_project_id IS NOT NULL
        )
    );

END;
$function$;

-- ----------------------------------------------------------------------------
-- 7. Privileges for the new helpers
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_locked_recalc_override() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_project_month_compare(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_alert_locked_month(UUID, DATE, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_lock_gate(UUID, DATE, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_milestone_override_targets(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_fixed_billing_targets(DATE) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.billing_locked_recalc_override() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_project_month_compare(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_alert_locked_month(UUID, DATE, TEXT, TEXT, JSONB) TO service_role;
-- billing_lock_gate is invoked from SECURITY INVOKER writers
-- (recalculate_project_month, recalculate_fixed_billing_month) which keep
-- their existing grants, so their callers need EXECUTE on it.
GRANT EXECUTE ON FUNCTION public.billing_lock_gate(UUID, DATE, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_milestone_override_targets(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_fixed_billing_targets(DATE) TO authenticated, service_role;

COMMIT;
