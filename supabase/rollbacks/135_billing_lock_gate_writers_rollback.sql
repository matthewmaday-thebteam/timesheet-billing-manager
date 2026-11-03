-- ============================================================================
-- Rollback for migration 135: gate billing writers
-- ============================================================================
-- CREATE OR REPLACE keeps existing grants, so no GRANT statements needed.
-- Run rollbacks in reverse order (140 -> 134). Function bodies restored here
-- are the LIVE prod definitions captured verbatim with pg_get_functiondef on
-- 2026-11-03 (md5-checked against the prod catalog), not repo migration files.
-- ============================================================================

BEGIN;

-- Live recalculate_project_month (pre-135)
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

-- Live recalculate_fixed_billing_month (pre-135)
CREATE OR REPLACE FUNCTION public.recalculate_fixed_billing_month(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
  -- ========================================================================
  -- Part 1: Update milestone_override_cents on project_monthly_summary
  -- For each project with a linked revenue_milestone billing, sum the
  -- transaction amounts for the month. If no transactions exist, override = 0.
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = sub.total_cents,
      updated_at = NOW()
  FROM (
    SELECT
      p.id AS project_id,
      COALESCE(SUM(bt.amount_cents), 0) AS total_cents
    FROM billings b
    JOIN projects p ON p.id = b.linked_project_id
    LEFT JOIN billing_transactions bt
      ON bt.billing_id = b.id
      AND bt.transaction_month = v_month
    WHERE b.type = 'revenue_milestone'
      AND b.linked_project_id IS NOT NULL
    GROUP BY p.id
  ) sub
  WHERE pms.project_id = sub.project_id
    AND pms.summary_month = v_month;

  -- ========================================================================
  -- Part 2: Clear milestone_override_cents for projects that NO LONGER
  -- have any milestone billing linked (e.g., milestone was deleted or
  -- unlinked from the project entirely)
  -- ========================================================================
  UPDATE project_monthly_summary pms
  SET milestone_override_cents = NULL,
      updated_at = NOW()
  WHERE pms.summary_month = v_month
    AND pms.milestone_override_cents IS NOT NULL
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
  -- ========================================================================
  INSERT INTO monthly_fixed_billing_summary (
    summary_month, company_id,
    fixed_billing_cents, fixed_billing_count,
    calculated_at
  )
  SELECT
    v_month,
    b.company_id,
    COALESCE(SUM(bt.amount_cents), 0),
    COUNT(DISTINCT b.id),
    NOW()
  FROM billings b
  JOIN billing_transactions bt ON bt.billing_id = b.id
  WHERE bt.transaction_month = v_month
    AND NOT (
      b.type = 'revenue_milestone'
      AND b.linked_project_id IS NOT NULL
    )
  GROUP BY b.company_id
  ON CONFLICT (company_id, summary_month) DO UPDATE SET
    fixed_billing_cents = EXCLUDED.fixed_billing_cents,
    fixed_billing_count = EXCLUDED.fixed_billing_count,
    calculated_at = NOW(),
    updated_at = NOW();

  -- ========================================================================
  -- Part 4: Clean up fixed billing rows for companies that no longer have
  -- any fixed billings for this month
  -- ========================================================================
  DELETE FROM monthly_fixed_billing_summary fbs
  WHERE fbs.summary_month = v_month
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

-- Live sync_project_carryover (pre-135)
CREATE OR REPLACE FUNCTION public.sync_project_carryover(p_project_id uuid, p_source_month date, p_carryover_hours numeric, p_actual_hours_worked numeric, p_maximum_applied numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_source_month DATE := DATE_TRUNC('month', p_source_month)::DATE;
    v_carryover_month DATE := (v_source_month + INTERVAL '1 month')::DATE;
BEGIN
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

DROP FUNCTION IF EXISTS public.billing_fixed_billing_targets(DATE);
DROP FUNCTION IF EXISTS public.billing_milestone_override_targets(DATE);
DROP FUNCTION IF EXISTS public.billing_lock_gate(UUID, DATE, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.billing_alert_locked_month(UUID, DATE, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.billing_project_month_compare(UUID, DATE);
DROP FUNCTION IF EXISTS public.billing_locked_recalc_override();

COMMIT;
