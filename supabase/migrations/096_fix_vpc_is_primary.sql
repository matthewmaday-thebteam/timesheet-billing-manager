-- Fix: vpc.is_primary does not exist in v_project_canonical. The column is "role".
-- This was introduced in migration 093's rewrite of get_all_project_rates_for_month().

-- Replace the broken WHERE clause in get_all_project_rates_for_month()
-- FROM: vpc.is_primary = true
-- TO:   vpc.role = 'primary'

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
    rate_source TEXT,
    rate_source_month DATE,
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
          AND (vpc.project_id IS NULL OR vpc.role = 'primary' OR NOT EXISTS (
              SELECT 1 FROM v_project_canonical vpc2 WHERE vpc2.project_id = p.id
          ))
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
        COALESCE(rl.rate, 0) AS effective_rate,
        CASE
            WHEN rl.rate IS NOT NULL THEN 'explicit'::TEXT
            ELSE 'default'::TEXT
        END AS rate_source,
        rl.rate_month AS rate_source_month,
        COALESCE(rnd.rounding_increment, 15) AS effective_rounding,
        CASE
            WHEN rnd.rounding_increment IS NOT NULL THEN 'explicit'::TEXT
            ELSE 'default'::TEXT
        END AS rounding_source,
        rnd.rounding_month AS rounding_source_month,
        COALESCE(rnd.rounding_mode, 'task') AS effective_rounding_mode,
        ll.minimum_hours,
        ll.maximum_hours,
        COALESCE(ll.carryover_enabled, false) AS carryover_enabled,
        ll.carryover_max_hours,
        ll.carryover_expiry_months,
        CASE
            WHEN ll.minimum_hours IS NOT NULL OR ll.maximum_hours IS NOT NULL THEN 'explicit'::TEXT
            ELSE 'default'::TEXT
        END AS limits_source,
        ll.limits_month AS limits_source_month,
        COALESCE(al.is_active, true) AS is_active,
        CASE
            WHEN al.is_active IS NOT NULL THEN 'explicit'::TEXT
            ELSE 'default'::TEXT
        END AS active_source,
        al.status_month AS active_source_month,
        COALESCE(cl.total_carryover, 0) AS carryover_hours_in
    FROM rate_lookup rl
    LEFT JOIN rounding_lookup rnd ON rnd.proj_id = rl.proj_id
    LEFT JOIN limits_lookup ll ON ll.proj_id = rl.proj_id
    LEFT JOIN active_lookup al ON al.proj_id = rl.proj_id
    LEFT JOIN carryover_lookup cl ON cl.proj_id = rl.proj_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
