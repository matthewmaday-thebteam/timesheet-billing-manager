-- Migration 028: Create Billing Rules Infrastructure
-- This migration creates tables and functions for:
-- - Monthly billing limits (minimum/maximum hours, carryover)
-- - Active status (controls whether minimum billing applies)
-- - Carryover tracking (excess hours rolled to next month)
-- - Billing month status (race condition prevention)
-- - Audit logging (financial compliance)

-- ============================================================================
-- STEP 1: CREATE PROJECT_MONTHLY_BILLING_LIMITS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_monthly_billing_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    limits_month DATE NOT NULL,

    -- Billing limits
    minimum_hours NUMERIC(10, 2) DEFAULT NULL,  -- NULL = no minimum
    maximum_hours NUMERIC(10, 2) DEFAULT NULL,  -- NULL = unlimited
    carryover_enabled BOOLEAN NOT NULL DEFAULT false,

    -- Financial Audit Addition: Carryover limits to prevent unbounded liability
    carryover_max_hours NUMERIC(10, 2) DEFAULT NULL,  -- Maximum carryover accumulation
    carryover_expiry_months INTEGER DEFAULT NULL,     -- Months until carryover expires

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_monthly_limits UNIQUE (project_id, limits_month),
    CONSTRAINT chk_limits_month_first CHECK (EXTRACT(DAY FROM limits_month) = 1),
    CONSTRAINT chk_min_non_negative CHECK (minimum_hours IS NULL OR minimum_hours >= 0),
    CONSTRAINT chk_max_non_negative CHECK (maximum_hours IS NULL OR maximum_hours >= 0),
    CONSTRAINT chk_min_le_max CHECK (
        minimum_hours IS NULL OR maximum_hours IS NULL OR minimum_hours <= maximum_hours
    ),
    -- DBA Addition: Reasonable upper bounds
    CONSTRAINT chk_min_reasonable CHECK (minimum_hours IS NULL OR minimum_hours <= 744),
    CONSTRAINT chk_max_reasonable CHECK (maximum_hours IS NULL OR maximum_hours <= 744),
    CONSTRAINT chk_carryover_max_reasonable CHECK (carryover_max_hours IS NULL OR carryover_max_hours <= 744),
    CONSTRAINT chk_carryover_expiry_positive CHECK (carryover_expiry_months IS NULL OR carryover_expiry_months > 0)
);

COMMENT ON TABLE project_monthly_billing_limits IS 'Monthly billing limits per project. Controls minimum/maximum billable hours and carryover settings.';
COMMENT ON COLUMN project_monthly_billing_limits.minimum_hours IS 'Minimum hours billed (retainer). NULL = no minimum.';
COMMENT ON COLUMN project_monthly_billing_limits.maximum_hours IS 'Maximum billable hours cap. NULL = unlimited.';
COMMENT ON COLUMN project_monthly_billing_limits.carryover_enabled IS 'When true, excess hours carry to next month. When false, excess becomes unbillable.';
COMMENT ON COLUMN project_monthly_billing_limits.carryover_max_hours IS 'Maximum carryover accumulation to prevent unbounded liability. NULL = unlimited.';
COMMENT ON COLUMN project_monthly_billing_limits.carryover_expiry_months IS 'Months until carryover expires (FIFO). NULL = never expires.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_billing_limits_project ON project_monthly_billing_limits(project_id);
CREATE INDEX IF NOT EXISTS idx_billing_limits_month ON project_monthly_billing_limits(limits_month);
CREATE INDEX IF NOT EXISTS idx_billing_limits_project_month ON project_monthly_billing_limits(project_id, limits_month DESC);

-- ============================================================================
-- STEP 2: CREATE PROJECT_MONTHLY_ACTIVE_STATUS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_monthly_active_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status_month DATE NOT NULL,

    -- Active status controls whether minimum billing applies
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_monthly_status UNIQUE (project_id, status_month),
    CONSTRAINT chk_status_month_first CHECK (EXTRACT(DAY FROM status_month) = 1)
);

COMMENT ON TABLE project_monthly_active_status IS 'Monthly active status per project. Controls whether minimum billing applies.';
COMMENT ON COLUMN project_monthly_active_status.is_active IS 'When true, minimum hours are billed even if actual < minimum. When false, only bill actual/carryover hours.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_active_status_project ON project_monthly_active_status(project_id);
CREATE INDEX IF NOT EXISTS idx_active_status_month ON project_monthly_active_status(status_month);

-- ============================================================================
-- STEP 3: CREATE PROJECT_CARRYOVER_HOURS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_carryover_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    carryover_month DATE NOT NULL,  -- Month hours carry INTO
    source_month DATE NOT NULL,     -- Month excess hours came FROM

    carryover_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,

    -- Audit trail for carryover calculation
    actual_hours_worked NUMERIC(10, 2) NOT NULL,
    maximum_applied NUMERIC(10, 2) NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_carryover UNIQUE (project_id, carryover_month, source_month),
    CONSTRAINT chk_carryover_month_first CHECK (EXTRACT(DAY FROM carryover_month) = 1),
    CONSTRAINT chk_source_month_first CHECK (EXTRACT(DAY FROM source_month) = 1),
    CONSTRAINT chk_source_before_target CHECK (source_month < carryover_month),
    CONSTRAINT chk_carryover_non_negative CHECK (carryover_hours >= 0),
    CONSTRAINT chk_carryover_reasonable CHECK (carryover_hours <= 744)
);

COMMENT ON TABLE project_carryover_hours IS 'Tracks excess hours carried from one month to another. Supports multiple source months per destination.';
COMMENT ON COLUMN project_carryover_hours.carryover_month IS 'The month these hours carry INTO (destination).';
COMMENT ON COLUMN project_carryover_hours.source_month IS 'The month excess hours came FROM (origin).';
COMMENT ON COLUMN project_carryover_hours.actual_hours_worked IS 'Hours actually worked in source month (for audit).';
COMMENT ON COLUMN project_carryover_hours.maximum_applied IS 'Maximum cap that was applied in source month (for audit).';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carryover_project ON project_carryover_hours(project_id);
CREATE INDEX IF NOT EXISTS idx_carryover_source ON project_carryover_hours(project_id, source_month);
CREATE INDEX IF NOT EXISTS idx_carryover_month ON project_carryover_hours(carryover_month);

-- ============================================================================
-- STEP 4: CREATE BILLING_MONTH_STATUS TABLE (Race Condition Prevention)
-- ============================================================================

CREATE TABLE IF NOT EXISTS billing_month_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    billing_month DATE NOT NULL,

    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'calculating', 'closed', 'reopened')),

    -- Snapshot of calculated values at close time
    total_hours_worked NUMERIC(10, 2),
    total_billed_hours NUMERIC(10, 2),
    carryover_generated NUMERIC(10, 2),

    -- Close/reopen tracking
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES auth.users(id),
    reopened_at TIMESTAMPTZ,
    reopened_by UUID REFERENCES auth.users(id),
    reopen_reason TEXT,

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT uq_project_billing_month UNIQUE (project_id, billing_month),
    CONSTRAINT chk_billing_month_first CHECK (EXTRACT(DAY FROM billing_month) = 1)
);

COMMENT ON TABLE billing_month_status IS 'Tracks billing month lifecycle to prevent race conditions during carryover calculation.';
COMMENT ON COLUMN billing_month_status.status IS 'open=editable, calculating=locked for calculation, closed=finalized, reopened=was closed but reopened for edits.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_billing_status_project ON billing_month_status(project_id);
CREATE INDEX IF NOT EXISTS idx_billing_status_month ON billing_month_status(billing_month);
CREATE INDEX IF NOT EXISTS idx_billing_status_status ON billing_month_status(status);

-- ============================================================================
-- STEP 5: CREATE BILLING_AUDIT_LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS billing_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data JSONB,
    new_data JSONB,

    -- Financial Audit Addition: Billing context
    billing_month DATE,
    project_id UUID,
    hours_impact NUMERIC(10, 2),
    revenue_impact NUMERIC(12, 2),

    -- Change tracking
    changed_by UUID REFERENCES auth.users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Reason tracking
    adjustment_reason TEXT CHECK (adjustment_reason IS NULL OR adjustment_reason IN (
        'rate_change', 'time_correction', 'carryover_adjustment',
        'minimum_override', 'maximum_override', 'write_off',
        'client_dispute', 'system_recalculation', 'manual_correction'
    ))
);

COMMENT ON TABLE billing_audit_log IS 'Audit trail for all billing-related changes. Required for financial compliance.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_table_record ON billing_audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON billing_audit_log(changed_at);
CREATE INDEX IF NOT EXISTS idx_audit_project ON billing_audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_billing_month ON billing_audit_log(billing_month);

-- ============================================================================
-- STEP 6: CREATE UPDATED_AT TRIGGERS
-- ============================================================================

-- Reuse existing update_updated_at_column function from earlier migrations

DROP TRIGGER IF EXISTS trg_billing_limits_updated_at ON project_monthly_billing_limits;
CREATE TRIGGER trg_billing_limits_updated_at
    BEFORE UPDATE ON project_monthly_billing_limits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_active_status_updated_at ON project_monthly_active_status;
CREATE TRIGGER trg_active_status_updated_at
    BEFORE UPDATE ON project_monthly_active_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_carryover_hours_updated_at ON project_carryover_hours;
CREATE TRIGGER trg_carryover_hours_updated_at
    BEFORE UPDATE ON project_carryover_hours
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_billing_month_status_updated_at ON billing_month_status;
CREATE TRIGGER trg_billing_month_status_updated_at
    BEFORE UPDATE ON billing_month_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 7: CREATE AUDIT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION billing_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO billing_audit_log (
            table_name, record_id, action, new_data,
            project_id, changed_by
        ) VALUES (
            TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW),
            NEW.project_id, auth.uid()
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO billing_audit_log (
            table_name, record_id, action, old_data, new_data,
            project_id, changed_by
        ) VALUES (
            TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
            NEW.project_id, auth.uid()
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO billing_audit_log (
            table_name, record_id, action, old_data,
            project_id, changed_by
        ) VALUES (
            TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD),
            OLD.project_id, auth.uid()
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers to billing tables
DROP TRIGGER IF EXISTS trg_audit_billing_limits ON project_monthly_billing_limits;
CREATE TRIGGER trg_audit_billing_limits
    AFTER INSERT OR UPDATE OR DELETE ON project_monthly_billing_limits
    FOR EACH ROW EXECUTE FUNCTION billing_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_active_status ON project_monthly_active_status;
CREATE TRIGGER trg_audit_active_status
    AFTER INSERT OR UPDATE OR DELETE ON project_monthly_active_status
    FOR EACH ROW EXECUTE FUNCTION billing_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_carryover_hours ON project_carryover_hours;
CREATE TRIGGER trg_audit_carryover_hours
    AFTER INSERT OR UPDATE OR DELETE ON project_carryover_hours
    FOR EACH ROW EXECUTE FUNCTION billing_audit_trigger();

-- ============================================================================
-- STEP 8: CREATE EFFECTIVE BILLING LIMITS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_project_billing_limits(
    p_project_id UUID,
    p_month DATE
)
RETURNS TABLE (
    minimum_hours NUMERIC,
    maximum_hours NUMERIC,
    carryover_enabled BOOLEAN,
    carryover_max_hours NUMERIC,
    carryover_expiry_months INTEGER,
    source TEXT,
    source_month DATE
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_first_seen_month DATE;
    v_lookup_month DATE;
    v_result RECORD;
BEGIN
    -- Get first_seen_month for this project
    SELECT first_seen_month INTO v_first_seen_month
    FROM projects WHERE id = p_project_id;

    -- Handle NULL first_seen_month
    IF v_first_seen_month IS NULL THEN
        RETURN QUERY SELECT
            NULL::NUMERIC, NULL::NUMERIC, false, NULL::NUMERIC, NULL::INTEGER,
            'default'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    -- Determine which month to look up (backfill if before first_seen)
    v_lookup_month := GREATEST(v_month, v_first_seen_month);

    -- Find most recent limits <= lookup month
    SELECT
        pbl.minimum_hours,
        pbl.maximum_hours,
        pbl.carryover_enabled,
        pbl.carryover_max_hours,
        pbl.carryover_expiry_months,
        pbl.limits_month
    INTO v_result
    FROM project_monthly_billing_limits pbl
    WHERE pbl.project_id = p_project_id
      AND pbl.limits_month <= v_lookup_month
    ORDER BY pbl.limits_month DESC
    LIMIT 1;

    -- Determine source
    IF v_result.limits_month IS NOT NULL THEN
        IF v_month < v_first_seen_month THEN
            RETURN QUERY SELECT
                v_result.minimum_hours, v_result.maximum_hours,
                v_result.carryover_enabled, v_result.carryover_max_hours,
                v_result.carryover_expiry_months,
                'backfill'::TEXT, v_result.limits_month;
        ELSIF v_result.limits_month = v_month THEN
            RETURN QUERY SELECT
                v_result.minimum_hours, v_result.maximum_hours,
                v_result.carryover_enabled, v_result.carryover_max_hours,
                v_result.carryover_expiry_months,
                'explicit'::TEXT, v_result.limits_month;
        ELSE
            RETURN QUERY SELECT
                v_result.minimum_hours, v_result.maximum_hours,
                v_result.carryover_enabled, v_result.carryover_max_hours,
                v_result.carryover_expiry_months,
                'inherited'::TEXT, v_result.limits_month;
        END IF;
    ELSE
        -- No explicit limits set - return defaults (no limits)
        RETURN QUERY SELECT
            NULL::NUMERIC, NULL::NUMERIC, false, NULL::NUMERIC, NULL::INTEGER,
            'default'::TEXT, NULL::DATE;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_effective_project_billing_limits(UUID, DATE) IS 'Returns effective billing limits for a project in a given month with source tracking.';

-- ============================================================================
-- STEP 9: CREATE EFFECTIVE ACTIVE STATUS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_effective_project_active_status(
    p_project_id UUID,
    p_month DATE
)
RETURNS TABLE (
    is_active BOOLEAN,
    source TEXT,
    source_month DATE
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_first_seen_month DATE;
    v_lookup_month DATE;
    v_result RECORD;
BEGIN
    -- Get first_seen_month for this project
    SELECT first_seen_month INTO v_first_seen_month
    FROM projects WHERE id = p_project_id;

    -- Handle NULL first_seen_month
    IF v_first_seen_month IS NULL THEN
        RETURN QUERY SELECT true, 'default'::TEXT, NULL::DATE;
        RETURN;
    END IF;

    -- Determine which month to look up
    v_lookup_month := GREATEST(v_month, v_first_seen_month);

    -- Find most recent status <= lookup month
    SELECT pas.is_active, pas.status_month
    INTO v_result
    FROM project_monthly_active_status pas
    WHERE pas.project_id = p_project_id
      AND pas.status_month <= v_lookup_month
    ORDER BY pas.status_month DESC
    LIMIT 1;

    -- Determine source
    IF v_result.status_month IS NOT NULL THEN
        IF v_month < v_first_seen_month THEN
            RETURN QUERY SELECT v_result.is_active, 'backfill'::TEXT, v_result.status_month;
        ELSIF v_result.status_month = v_month THEN
            RETURN QUERY SELECT v_result.is_active, 'explicit'::TEXT, v_result.status_month;
        ELSE
            RETURN QUERY SELECT v_result.is_active, 'inherited'::TEXT, v_result.status_month;
        END IF;
    ELSE
        -- No explicit status set - default to active
        RETURN QUERY SELECT true, 'default'::TEXT, NULL::DATE;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_effective_project_active_status(UUID, DATE) IS 'Returns effective active status for a project in a given month with source tracking.';

-- ============================================================================
-- STEP 10: CREATE CARRYOVER AVAILABLE FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_project_carryover_available(
    p_project_id UUID,
    p_month DATE
)
RETURNS TABLE (
    total_carryover_hours NUMERIC,
    sources JSONB
) AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
    v_carryover_max NUMERIC;
    v_carryover_expiry INTEGER;
    v_total NUMERIC;
    v_sources JSONB;
BEGIN
    -- Get carryover limits for this project/month
    SELECT bl.carryover_max_hours, bl.carryover_expiry_months
    INTO v_carryover_max, v_carryover_expiry
    FROM get_effective_project_billing_limits(p_project_id, p_month) bl;

    -- Calculate total carryover, respecting expiry if set
    SELECT
        COALESCE(SUM(pch.carryover_hours), 0),
        COALESCE(jsonb_agg(jsonb_build_object(
            'source_month', pch.source_month,
            'hours', pch.carryover_hours,
            'calculated_at', pch.calculated_at
        ) ORDER BY pch.source_month), '[]'::jsonb)
    INTO v_total, v_sources
    FROM project_carryover_hours pch
    WHERE pch.project_id = p_project_id
      AND pch.carryover_month = v_month
      AND (
          v_carryover_expiry IS NULL
          OR pch.source_month >= (v_month - (v_carryover_expiry || ' months')::INTERVAL)::DATE
      );

    -- Apply carryover max if set
    IF v_carryover_max IS NOT NULL AND v_total > v_carryover_max THEN
        v_total := v_carryover_max;
    END IF;

    RETURN QUERY SELECT v_total, v_sources;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_project_carryover_available(UUID, DATE) IS 'Returns total carryover hours available for a project in a given month, respecting limits and expiry.';

-- ============================================================================
-- STEP 11: CREATE SET BILLING LIMITS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION set_project_billing_limits_for_month(
    p_project_id UUID,
    p_month DATE,
    p_minimum_hours NUMERIC DEFAULT NULL,
    p_maximum_hours NUMERIC DEFAULT NULL,
    p_carryover_enabled BOOLEAN DEFAULT false,
    p_carryover_max_hours NUMERIC DEFAULT NULL,
    p_carryover_expiry_months INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    -- Validate minimum <= maximum
    IF p_minimum_hours IS NOT NULL AND p_maximum_hours IS NOT NULL
       AND p_minimum_hours > p_maximum_hours THEN
        RAISE EXCEPTION 'Minimum hours (%) cannot exceed maximum hours (%)',
            p_minimum_hours, p_maximum_hours;
    END IF;

    -- Upsert billing limits
    INSERT INTO project_monthly_billing_limits (
        project_id, limits_month, minimum_hours, maximum_hours,
        carryover_enabled, carryover_max_hours, carryover_expiry_months
    )
    VALUES (
        p_project_id, v_month, p_minimum_hours, p_maximum_hours,
        p_carryover_enabled, p_carryover_max_hours, p_carryover_expiry_months
    )
    ON CONFLICT (project_id, limits_month) DO UPDATE
    SET
        minimum_hours = EXCLUDED.minimum_hours,
        maximum_hours = EXCLUDED.maximum_hours,
        carryover_enabled = EXCLUDED.carryover_enabled,
        carryover_max_hours = EXCLUDED.carryover_max_hours,
        carryover_expiry_months = EXCLUDED.carryover_expiry_months,
        updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_project_billing_limits_for_month IS 'Sets or updates billing limits for a project in a specific month (admin function).';

-- ============================================================================
-- STEP 12: CREATE SET ACTIVE STATUS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION set_project_active_status_for_month(
    p_project_id UUID,
    p_month DATE,
    p_is_active BOOLEAN
)
RETURNS BOOLEAN AS $$
DECLARE
    v_month DATE := DATE_TRUNC('month', p_month)::DATE;
BEGIN
    -- Upsert active status
    INSERT INTO project_monthly_active_status (project_id, status_month, is_active)
    VALUES (p_project_id, v_month, p_is_active)
    ON CONFLICT (project_id, status_month) DO UPDATE
    SET is_active = EXCLUDED.is_active, updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_project_active_status_for_month IS 'Sets or updates active status for a project in a specific month (admin function).';

-- ============================================================================
-- STEP 13: UPDATE get_all_project_rates_for_month TO INCLUDE BILLING FIELDS
-- ============================================================================

DROP FUNCTION IF EXISTS get_all_project_rates_for_month(DATE);

CREATE OR REPLACE FUNCTION get_all_project_rates_for_month(p_month DATE)
RETURNS TABLE (
    project_id UUID,
    external_project_id TEXT,
    project_name TEXT,
    client_id TEXT,
    client_name TEXT,
    first_seen_month DATE,
    -- Rate fields
    effective_rate NUMERIC,
    source TEXT,
    source_month DATE,
    existed_in_month BOOLEAN,
    -- Rounding fields
    effective_rounding INTEGER,
    rounding_source TEXT,
    rounding_source_month DATE,
    -- Billing limits fields
    minimum_hours NUMERIC,
    maximum_hours NUMERIC,
    carryover_enabled BOOLEAN,
    carryover_max_hours NUMERIC,
    carryover_expiry_months INTEGER,
    limits_source TEXT,
    limits_source_month DATE,
    -- Active status fields
    is_active BOOLEAN,
    active_source TEXT,
    active_source_month DATE,
    -- Carryover available
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
            p.first_seen_month,
            pmr.rate,
            pmr.rate_month
        FROM projects p
        LEFT JOIN project_monthly_rates pmr
            ON pmr.project_id = p.id
           AND pmr.rate_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pmr.rate_month DESC
    ),
    rounding_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pround.rounding_increment,
            pround.rounding_month
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
            pbl.minimum_hours,
            pbl.maximum_hours,
            pbl.carryover_enabled,
            pbl.carryover_max_hours,
            pbl.carryover_expiry_months,
            pbl.limits_month
        FROM projects p
        LEFT JOIN project_monthly_billing_limits pbl
            ON pbl.project_id = p.id
           AND pbl.limits_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pbl.limits_month DESC
    ),
    status_lookup AS (
        SELECT DISTINCT ON (p.id)
            p.id AS proj_id,
            p.first_seen_month,
            pas.is_active,
            pas.status_month
        FROM projects p
        LEFT JOIN project_monthly_active_status pas
            ON pas.project_id = p.id
           AND pas.status_month <= GREATEST(v_month, COALESCE(p.first_seen_month, v_month))
        WHERE p.first_seen_month IS NOT NULL
        ORDER BY p.id, pas.status_month DESC
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
        rl.first_seen_month,
        -- Rate
        COALESCE(rl.rate, get_default_rate()) AS effective_rate,
        CASE
            WHEN rl.rate IS NULL THEN 'default'
            WHEN v_month < rl.first_seen_month THEN 'backfill'
            WHEN rl.rate_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS source,
        rl.rate_month AS source_month,
        (v_month >= rl.first_seen_month) AS existed_in_month,
        -- Rounding
        COALESCE(rndl.rounding_increment, get_default_rounding_increment()) AS effective_rounding,
        CASE
            WHEN rndl.rounding_increment IS NULL THEN 'default'
            WHEN v_month < rndl.first_seen_month THEN 'backfill'
            WHEN rndl.rounding_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS rounding_source,
        rndl.rounding_month AS rounding_source_month,
        -- Billing limits
        ll.minimum_hours,
        ll.maximum_hours,
        COALESCE(ll.carryover_enabled, false) AS carryover_enabled,
        ll.carryover_max_hours,
        ll.carryover_expiry_months,
        CASE
            WHEN ll.limits_month IS NULL THEN 'default'
            WHEN v_month < ll.first_seen_month THEN 'backfill'
            WHEN ll.limits_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS limits_source,
        ll.limits_month AS limits_source_month,
        -- Active status
        COALESCE(sl.is_active, true) AS is_active,
        CASE
            WHEN sl.status_month IS NULL THEN 'default'
            WHEN v_month < sl.first_seen_month THEN 'backfill'
            WHEN sl.status_month = v_month THEN 'explicit'
            ELSE 'inherited'
        END AS active_source,
        sl.status_month AS active_source_month,
        -- Carryover
        COALESCE(cl.total_carryover, 0) AS carryover_hours_in
    FROM rate_lookup rl
    LEFT JOIN rounding_lookup rndl ON rndl.proj_id = rl.proj_id
    LEFT JOIN limits_lookup ll ON ll.proj_id = rl.proj_id
    LEFT JOIN status_lookup sl ON sl.proj_id = rl.proj_id
    LEFT JOIN carryover_lookup cl ON cl.proj_id = rl.proj_id
    ORDER BY rl.client_name NULLS LAST, rl.project_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_all_project_rates_for_month(DATE) IS 'Returns all projects with effective rates, rounding, billing limits, active status, and carryover for a given month (for Rates page).';

-- ============================================================================
-- STEP 14: CREATE CARRYOVER TOTALS VIEW (Performance Optimization)
-- ============================================================================

CREATE OR REPLACE VIEW v_project_carryover_totals AS
SELECT
    project_id,
    carryover_month,
    SUM(carryover_hours) AS total_carryover_hours,
    COUNT(*) AS source_count,
    MIN(source_month) AS oldest_source,
    MAX(source_month) AS newest_source
FROM project_carryover_hours
GROUP BY project_id, carryover_month;

COMMENT ON VIEW v_project_carryover_totals IS 'Aggregated carryover totals per project per month for performance.';

-- ============================================================================
-- STEP 15: ENABLE RLS AND CREATE POLICIES
-- ============================================================================

ALTER TABLE project_monthly_billing_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_monthly_active_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_carryover_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_month_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_audit_log ENABLE ROW LEVEL SECURITY;

-- Billing Limits Policies
DROP POLICY IF EXISTS "Allow authenticated read billing limits" ON project_monthly_billing_limits;
DROP POLICY IF EXISTS "Allow authenticated insert billing limits" ON project_monthly_billing_limits;
DROP POLICY IF EXISTS "Allow authenticated update billing limits" ON project_monthly_billing_limits;
DROP POLICY IF EXISTS "Allow service role full access billing limits" ON project_monthly_billing_limits;

CREATE POLICY "Allow authenticated read billing limits"
    ON project_monthly_billing_limits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert billing limits"
    ON project_monthly_billing_limits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update billing limits"
    ON project_monthly_billing_limits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow service role full access billing limits"
    ON project_monthly_billing_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Active Status Policies
DROP POLICY IF EXISTS "Allow authenticated read active status" ON project_monthly_active_status;
DROP POLICY IF EXISTS "Allow authenticated insert active status" ON project_monthly_active_status;
DROP POLICY IF EXISTS "Allow authenticated update active status" ON project_monthly_active_status;
DROP POLICY IF EXISTS "Allow service role full access active status" ON project_monthly_active_status;

CREATE POLICY "Allow authenticated read active status"
    ON project_monthly_active_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert active status"
    ON project_monthly_active_status FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update active status"
    ON project_monthly_active_status FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow service role full access active status"
    ON project_monthly_active_status FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Carryover Hours Policies (more restrictive - prefer RPC access)
DROP POLICY IF EXISTS "Allow authenticated read carryover" ON project_carryover_hours;
DROP POLICY IF EXISTS "Allow service role full access carryover" ON project_carryover_hours;

CREATE POLICY "Allow authenticated read carryover"
    ON project_carryover_hours FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role full access carryover"
    ON project_carryover_hours FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Billing Month Status Policies
DROP POLICY IF EXISTS "Allow authenticated read billing status" ON billing_month_status;
DROP POLICY IF EXISTS "Allow authenticated insert billing status" ON billing_month_status;
DROP POLICY IF EXISTS "Allow authenticated update billing status" ON billing_month_status;
DROP POLICY IF EXISTS "Allow service role full access billing status" ON billing_month_status;

CREATE POLICY "Allow authenticated read billing status"
    ON billing_month_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert billing status"
    ON billing_month_status FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update billing status"
    ON billing_month_status FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow service role full access billing status"
    ON billing_month_status FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Audit Log Policies (read-only for authenticated, full for service role)
DROP POLICY IF EXISTS "Allow authenticated read audit log" ON billing_audit_log;
DROP POLICY IF EXISTS "Allow service role full access audit log" ON billing_audit_log;

CREATE POLICY "Allow authenticated read audit log"
    ON billing_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role full access audit log"
    ON billing_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- STEP 16: GRANTS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON project_monthly_billing_limits TO authenticated;
GRANT SELECT, INSERT, UPDATE ON project_monthly_active_status TO authenticated;
GRANT SELECT ON project_carryover_hours TO authenticated;
GRANT SELECT, INSERT, UPDATE ON billing_month_status TO authenticated;
GRANT SELECT ON billing_audit_log TO authenticated;
GRANT SELECT ON v_project_carryover_totals TO authenticated;

GRANT ALL ON project_monthly_billing_limits TO service_role;
GRANT ALL ON project_monthly_active_status TO service_role;
GRANT ALL ON project_carryover_hours TO service_role;
GRANT ALL ON billing_month_status TO service_role;
GRANT ALL ON billing_audit_log TO service_role;
GRANT ALL ON v_project_carryover_totals TO service_role;

GRANT EXECUTE ON FUNCTION get_effective_project_billing_limits(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_project_active_status(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_project_carryover_available(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION set_project_billing_limits_for_month(UUID, DATE, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION set_project_active_status_for_month(UUID, DATE, BOOLEAN) TO authenticated;

-- ============================================================================
-- STEP 17: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_name IN (
        'project_monthly_billing_limits',
        'project_monthly_active_status',
        'project_carryover_hours',
        'billing_month_status',
        'billing_audit_log'
    );

    IF v_table_count = 5 THEN
        RAISE NOTICE 'Migration 028 Complete: All 5 billing rules tables created successfully';
    ELSE
        RAISE EXCEPTION 'Migration 028 Failed: Expected 5 tables, found %', v_table_count;
    END IF;
END $$;
