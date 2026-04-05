-- ============================================================================
-- Migration 067: End of Month Reports — Table, Storage, RLS, Availability View
-- ============================================================================
-- Purpose: Create the infrastructure for automated end-of-month CSV report
-- generation and storage. Reports are snapshots of billing data frozen after
-- the month closes (5th of following month, Bulgarian timezone).
--
-- Changes:
--   1. eom_reports table (metadata + storage path for each company-month CSV)
--   2. eom-reports private storage bucket (CSV files)
--   3. RLS policies (authenticated SELECT, service_role write)
--   4. v_eom_report_availability view (eligible company-months)
--   5. Updated_at trigger (reuses existing update_updated_at_column)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE eom_reports TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS eom_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_year         INTEGER NOT NULL,
    report_month        INTEGER NOT NULL,
    company_id          UUID NOT NULL REFERENCES companies(id),
    company_name        TEXT NOT NULL,                          -- snapshot at generation time
    total_hours         NUMERIC(10,2) NOT NULL,
    total_revenue_cents BIGINT NOT NULL,
    project_count       INTEGER NOT NULL,
    storage_path        TEXT NOT NULL,                          -- path in eom-reports bucket
    file_size_bytes     BIGINT,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generated_by        UUID REFERENCES auth.users(id),
    generation_number   INTEGER NOT NULL DEFAULT 1,
    source_data_hash    TEXT,                                   -- SHA-256 of source data
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_eom_company_year_month UNIQUE (company_id, report_year, report_month),
    CONSTRAINT chk_eom_month_range CHECK (report_month BETWEEN 1 AND 12)
);

COMMENT ON TABLE eom_reports IS
    'End-of-month report metadata. Each row corresponds to one CSV file '
    'stored in the eom-reports bucket. Reports are snapshots frozen after '
    'the month closes (5th of following month, Bulgarian timezone).';

-- ============================================================================
-- STEP 2: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_eom_reports_year_month ON eom_reports (report_year, report_month);
CREATE INDEX IF NOT EXISTS idx_eom_reports_company ON eom_reports (company_id);
CREATE INDEX IF NOT EXISTS idx_eom_reports_generated_at ON eom_reports (generated_at DESC);

-- ============================================================================
-- STEP 3: UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_eom_reports_updated_at ON eom_reports;
CREATE TRIGGER trg_eom_reports_updated_at
    BEFORE UPDATE ON eom_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 4: RLS POLICIES
-- ============================================================================

ALTER TABLE eom_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read reports
DROP POLICY IF EXISTS "Allow authenticated read eom reports" ON eom_reports;
CREATE POLICY "Allow authenticated read eom reports"
    ON eom_reports FOR SELECT
    TO authenticated
    USING (true);

-- Service role can manage reports (generation, re-generation)
DROP POLICY IF EXISTS "Allow service role full access eom reports" ON eom_reports;
CREATE POLICY "Allow service role full access eom reports"
    ON eom_reports FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 5: GRANTS
-- ============================================================================

GRANT SELECT ON eom_reports TO authenticated;
GRANT ALL ON eom_reports TO service_role;

-- ============================================================================
-- STEP 6: CREATE eom-reports STORAGE BUCKET (private)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'eom-reports',
    'eom-reports',
    false,                  -- private bucket
    52428800,               -- 50MB limit
    ARRAY['text/csv', 'application/csv']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Authenticated users can download (SELECT) reports
DROP POLICY IF EXISTS "Authenticated users can read eom reports" ON storage.objects;
CREATE POLICY "Authenticated users can read eom reports"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'eom-reports');

-- Service role can upload/update CSV files
DROP POLICY IF EXISTS "Service role can write eom reports" ON storage.objects;
CREATE POLICY "Service role can write eom reports"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'eom-reports');

DROP POLICY IF EXISTS "Service role can update eom reports" ON storage.objects;
CREATE POLICY "Service role can update eom reports"
ON storage.objects
FOR UPDATE
TO service_role
USING (bucket_id = 'eom-reports');

DROP POLICY IF EXISTS "Service role can delete eom reports" ON storage.objects;
CREATE POLICY "Service role can delete eom reports"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'eom-reports');

-- ============================================================================
-- STEP 7: CREATE v_eom_report_availability VIEW
-- ============================================================================
-- Shows which company-months are eligible for report generation.
-- A month is eligible when:
--   current_date (in Europe/Sofia) >= first day of following month + 4 days
--   i.e., the 5th of the following month has arrived in Bulgarian timezone.
--
-- Sources:
--   - v_canonical_project_monthly_summary: companies with timesheet/hourly data
--   - monthly_fixed_billing_summary: companies with only fixed billings
--
-- Joined with eom_reports to show generation status.

CREATE OR REPLACE VIEW v_eom_report_availability AS
WITH company_months AS (
    -- Companies with timesheet/hourly/C.O. data
    SELECT DISTINCT
        cpms.company_id,
        EXTRACT(YEAR FROM cpms.summary_month)::INTEGER AS report_year,
        EXTRACT(MONTH FROM cpms.summary_month)::INTEGER AS report_month
    FROM v_canonical_project_monthly_summary cpms

    UNION

    -- Companies with only fixed billings (no timesheet data)
    SELECT DISTINCT
        mfbs.company_id,
        EXTRACT(YEAR FROM mfbs.summary_month)::INTEGER AS report_year,
        EXTRACT(MONTH FROM mfbs.summary_month)::INTEGER AS report_month
    FROM monthly_fixed_billing_summary mfbs
),
eligible AS (
    SELECT
        cm.company_id,
        cm.report_year,
        cm.report_month,
        c.client_id,
        COALESCE(c.display_name, c.client_name) AS company_name
    FROM company_months cm
    JOIN companies c ON c.id = cm.company_id
    WHERE (CURRENT_DATE AT TIME ZONE 'Europe/Sofia')::DATE >=
          (make_date(
              CASE WHEN cm.report_month = 12 THEN cm.report_year + 1 ELSE cm.report_year END,
              CASE WHEN cm.report_month = 12 THEN 1 ELSE cm.report_month + 1 END,
              1
          ) + INTERVAL '4 days')::DATE
)
SELECT
    e.company_id,
    e.client_id,
    e.company_name,
    e.report_year,
    e.report_month,
    -- Report status
    er.id AS report_id,
    er.generated_at,
    er.generation_number,
    er.storage_path,
    er.file_size_bytes,
    er.total_hours,
    er.total_revenue_cents,
    er.project_count,
    er.source_data_hash,
    CASE WHEN er.id IS NOT NULL THEN true ELSE false END AS has_report
FROM eligible e
LEFT JOIN eom_reports er
    ON er.company_id = e.company_id
    AND er.report_year = e.report_year
    AND er.report_month = e.report_month
ORDER BY e.report_year DESC, e.report_month DESC, e.company_name;

COMMENT ON VIEW v_eom_report_availability IS
    'Shows which company-months are eligible for EOM report generation. '
    'A month becomes eligible on the 5th of the following month (Europe/Sofia timezone). '
    'Includes generation status from eom_reports.';

GRANT SELECT ON v_eom_report_availability TO authenticated;
GRANT SELECT ON v_eom_report_availability TO service_role;

-- ============================================================================
-- STEP 8: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_table_exists BOOLEAN;
    v_bucket_exists BOOLEAN;
    v_view_exists BOOLEAN;
    v_policy_count INTEGER;
BEGIN
    -- Verify table
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'eom_reports'
    ) INTO v_table_exists;

    -- Verify bucket
    SELECT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'eom-reports'
    ) INTO v_bucket_exists;

    -- Verify view
    SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = 'v_eom_report_availability'
    ) INTO v_view_exists;

    -- Count policies
    SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies
    WHERE tablename = 'eom_reports';

    RAISE NOTICE 'Migration 067 Complete:';
    RAISE NOTICE '  - eom_reports table: %', CASE WHEN v_table_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - eom-reports storage bucket: %', CASE WHEN v_bucket_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - v_eom_report_availability view: %', CASE WHEN v_view_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - RLS policies on eom_reports: %', v_policy_count;
    RAISE NOTICE '  - updated_at trigger attached';

    IF NOT v_table_exists THEN
        RAISE WARNING 'eom_reports table was not created!';
    END IF;
    IF NOT v_bucket_exists THEN
        RAISE WARNING 'eom-reports storage bucket was not created!';
    END IF;
END $$;

COMMIT;
