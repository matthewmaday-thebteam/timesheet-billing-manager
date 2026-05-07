-- ============================================================================
-- mcp-schema-snapshot.sql
--
-- Asserts that the *exact* column list of every mcp_api.v_api_* view matches
-- the locked snapshot. This catches accidental column additions or
-- reorderings — both of which would change the wire shape of the MCP tool
-- responses.
--
-- How to run:
--   psql "$MANIFEST_CI_DB_URL" -v ON_ERROR_STOP=1 -f scripts/ci/mcp-schema-snapshot.sql
--
-- A single failed assertion raises an exception and aborts. CI must check
-- the psql exit code.
-- ============================================================================

DO $$
DECLARE
    -- One row per (view_name, expected_columns_csv).
    expected RECORD;
    actual_csv TEXT;
BEGIN
    FOR expected IN
        SELECT * FROM (VALUES
            (
                'v_api_employees',
                'canonical_employee_id,display_name,first_name,last_name,external_label,employment_type'
            ),
            (
                'v_api_companies',
                'canonical_company_id,display_name,source_name'
            ),
            (
                'v_api_projects',
                'canonical_project_id,project_name,canonical_company_id,company_display_name,first_seen_month'
            ),
            (
                'v_api_employee_daily',
                'canonical_employee_id,canonical_company_id,work_date,rounded_hours'
            ),
            (
                'v_api_employee_time_off',
                'canonical_employee_id,start_date,end_date,total_days,time_off_type,status'
            )
        ) AS t(view_name, expected_csv)
    LOOP
        SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
          INTO actual_csv
          FROM information_schema.columns
         WHERE table_schema = 'mcp_api'
           AND table_name = expected.view_name;

        IF actual_csv IS NULL THEN
            RAISE EXCEPTION 'mcp-schema-snapshot: view mcp_api.% does not exist', expected.view_name;
        END IF;

        IF actual_csv <> expected.expected_csv THEN
            RAISE EXCEPTION
                E'mcp-schema-snapshot: column drift on mcp_api.%\n'
                ' expected: %\n'
                ' actual:   %',
                expected.view_name, expected.expected_csv, actual_csv;
        END IF;
    END LOOP;

    RAISE NOTICE 'mcp-schema-snapshot: all 5 v_api_* views match the locked column list.';
END $$;
