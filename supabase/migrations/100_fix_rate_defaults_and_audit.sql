-- Migration 100: Fix rate defaults, restore CASE source logic, add audit trigger
--
-- Fixes three regressions introduced in migration 098:
--   1. COALESCE(rl.rate, 0) -> COALESCE(rl.rate, get_default_rate())
--      Zero-default silently broke billing for projects without explicit rates.
--   2. Restore full 4-state CASE logic for source columns (explicit/inherited/
--      backfill/default) that was collapsed to 2-state in 098.
--   3. Add billing_audit_trigger on project_monthly_rates so rate changes are
--      logged in billing_audit_log, matching all other billing tables.

-- ============================================================================
-- STEP 1: Recreate get_all_project_rates_for_month with fixes
-- ============================================================================

DROP FUNCTION IF EXISTS get_all_project_rates_for_month(DATE);

CREATE FUNCTION get_all_project_rates_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    external_project_id TEXT,
    project_name TEXT,
    client_id TEXT,
    client_name TEXT,
    canonical_client_id TEXT,
    canonical_client_name TEXT,
    first_seen_month DATE,
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE,
    existed_in_month BOOLEAN,
    effective_rounding INTEGER,
    rounding_source TEXT,
    rounding_source_month DATE,
    effective_rounding_mode TEXT,
    minimum_hours NUMERIC,
    maximum_hours NUMERIC,
    carryover_enabled BOOLEAN,
    carryover_max_hours NUMERIC,
    carryover_expiry_months INTEGER,
    limits_source TEXT,
    limits_source_month DATE,
    is_active BOOLEAN,
    active_source TEXT,
    active_source_month DATE,
    carryover_hours_in NUMERIC
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    RETURN QUERY
    WITH rate_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.project_id AS ext_id,
            p.project_name,
            p.client_id,
            p.client_name,
            COALESCE(canonical_c.client_id, c.client_id, p.client_id) AS canonical_client_id,
            COALESCE(canonical_c.display_name, canonical_c.client_name, c.display_name, c.client_name, p.client_name) AS canonical_client_name,
            p.first_seen_month,
            pmr.rate,
            pmr.rate_month
        FROM projects p
        LEFT JOIN v_project_canonical vpc ON vpc.project_id = p.id
        LEFT JOIN companies c ON c.client_id = p.client_id
        LEFT JOIN v_company_canonical vcc ON vcc.company_id = c.id
        LEFT JOIN companies canonical_c ON canonical_c.id = vcc.canonical_company_id
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = p.id
           AND pmr.rate_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
          AND (vpc.role IS NULL OR vpc.role != 'member')
        ORDER BY p.id, pmr.rate_month DESC
    ),
    rounding_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pround.rounding_increment,
            pround.rounding_month,
            pround.rounding_mode
        FROM projects p
        LEFT JOIN project_monthly_rounding pround
            ON pround.project_id = p.id
           AND pround.rounding_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pround.rounding_month DESC
    ),
    limits_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            bl.minimum_hours,
            bl.maximum_hours,
            bl.carryover_enabled,
            bl.carryover_max_hours,
            bl.carryover_expiry_months,
            bl.limits_month
        FROM projects p
        LEFT JOIN project_monthly_billing_limits bl
            ON bl.project_id = p.id
           AND bl.limits_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, bl.limits_month DESC
    ),
    active_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            ast.is_active,
            ast.status_month
        FROM projects p
        LEFT JOIN project_monthly_active_status ast
            ON ast.project_id = p.id
           AND ast.status_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, ast.status_month DESC
    ),
    carryover_lookup AS (
        SELECT
            pch.project_id AS proj_id,
            SUM(pch.carryover_hours) AS total_carryover
        FROM project_carryover_hours pch
        WHERE pch.carryover_month = v_month
        GROUP BY pch.project_id
    )
    SELECT
        rl.proj_id AS project_id,
        rl.ext_id AS external_project_id,
        rl.project_name,
        rl.client_id,
        rl.client_name,
        rl.canonical_client_id,
        rl.canonical_client_name,
        rl.first_seen_month,
        -- Fix 1: Restore get_default_rate() instead of hardcoded 0
        COALESCE(rl.rate, get_default_rate()) AS effective_rate,
        -- Fix 2: Restore full 4-state CASE for rate source
        CASE
            WHEN rl.rate IS NULL THEN 'default'::TEXT
            WHEN v_month < rl.first_seen_month THEN 'backfill'::TEXT
            WHEN rl.rate_month = v_month THEN 'explicit'::TEXT
            ELSE 'inherited'::TEXT
        END AS source,
        rl.rate_month AS source_month,
        (v_month >= rl.first_seen_month) AS existed_in_month,
        -- Rounding with full 4-state CASE
        COALESCE(rnd.rounding_increment, 15) AS effective_rounding,
        CASE
            WHEN rnd.rounding_increment IS NULL THEN 'default'::TEXT
            WHEN v_month < rnd.first_seen_month THEN 'backfill'::TEXT
            WHEN rnd.rounding_month = v_month THEN 'explicit'::TEXT
            ELSE 'inherited'::TEXT
        END AS rounding_source,
        rnd.rounding_month AS rounding_source_month,
        COALESCE(rnd.rounding_mode, 'task') AS effective_rounding_mode,
        -- Billing limits with full 4-state CASE
        ll.minimum_hours,
        ll.maximum_hours,
        COALESCE(ll.carryover_enabled, false) AS carryover_enabled,
        ll.carryover_max_hours,
        ll.carryover_expiry_months,
        CASE
            WHEN ll.minimum_hours IS NULL AND ll.maximum_hours IS NULL THEN 'default'::TEXT
            WHEN v_month < ll.first_seen_month THEN 'backfill'::TEXT
            WHEN ll.limits_month = v_month THEN 'explicit'::TEXT
            ELSE 'inherited'::TEXT
        END AS limits_source,
        ll.limits_month AS limits_source_month,
        -- Active status with full 4-state CASE
        COALESCE(al.is_active, true) AS is_active,
        CASE
            WHEN al.is_active IS NULL THEN 'default'::TEXT
            WHEN v_month < al.first_seen_month THEN 'backfill'::TEXT
            WHEN al.status_month = v_month THEN 'explicit'::TEXT
            ELSE 'inherited'::TEXT
        END AS active_source,
        al.status_month AS active_source_month,
        -- Carryover
        COALESCE(cl.total_carryover, 0) AS carryover_hours_in
    FROM rate_lookup rl
    LEFT JOIN rounding_lookup rnd ON rnd.proj_id = rl.proj_id
    LEFT JOIN limits_lookup ll ON ll.proj_id = rl.proj_id
    LEFT JOIN active_lookup al ON al.proj_id = rl.proj_id
    LEFT JOIN carryover_lookup cl ON cl.proj_id = rl.proj_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_all_project_rates_for_month(DATE) IS
    'Returns all projects with effective rates, rounding (with mode), limits, and active status for a given month. v4: restores get_default_rate() and 4-state source CASE logic.';

GRANT EXECUTE ON FUNCTION get_all_project_rates_for_month(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_project_rates_for_month(DATE) TO service_role;

-- ============================================================================
-- STEP 2: Add audit trigger on project_monthly_rates
-- ============================================================================
-- The billing_audit_trigger() function already exists (created in migration 028).
-- It logs INSERT/UPDATE/DELETE to billing_audit_log. All other billing tables
-- already have this trigger; project_monthly_rates was missed.

DROP TRIGGER IF EXISTS trg_audit_monthly_rates ON project_monthly_rates;
CREATE TRIGGER trg_audit_monthly_rates
    AFTER INSERT OR UPDATE OR DELETE ON project_monthly_rates
    FOR EACH ROW EXECUTE FUNCTION billing_audit_trigger();
