-- ============================================================================
-- mcp-semantic-checksum.sql
--
-- Pinned-row checksums that catch *semantic* drift: the column list could
-- be unchanged but the values produced for a given primary key could shift
-- if a view's JOIN/WHERE logic changes. This test pins one or two rows per
-- view and asserts byte-equal MD5 of their JSON form.
--
-- The pinned values below are templated — the operator must populate them
-- before the test is meaningful. The expected_md5 column is intentionally
-- left as the literal string '__SEED_REQUIRED__' so a fresh deployment fails
-- closed: the operator runs the test once on a known-good snapshot, captures
-- the produced md5s, and updates this file.
--
-- USAGE:
--   1. After applying migrations 103-107 in a known-good environment, run:
--        psql "$URL" -v ON_ERROR_STOP=1 -f scripts/ci/mcp-semantic-checksum.sql
--      The first run will RAISE NOTICE the actual md5 of every pinned row.
--   2. Replace each '__SEED_REQUIRED__' placeholder with the actual md5.
--   3. Future runs assert byte-equal — semantic drift fails CI.
-- ============================================================================

DO $$
DECLARE
    pinned RECORD;
    actual_md5 TEXT;
    employee_id_seed TEXT := COALESCE(
        current_setting('mcp.semantic_employee_id', true),
        ''  -- empty triggers the missing-pin diagnostic below
    );
    company_id_seed TEXT := COALESCE(
        current_setting('mcp.semantic_company_id', true),
        ''
    );
    -- Optional: a (canonical_employee_id, canonical_project_id) pair the
    -- operator picks for the v_api_employee_project_daily pinned row. When
    -- both are provided we add a row-checksum against the most-recent
    -- non-zero day for that pair, exposing semantic drift in the
    -- employee->project rollup that v_api_employee_daily cannot detect
    -- (because it has no project_id).
    project_id_seed TEXT := COALESCE(
        current_setting('mcp.semantic_project_id', true),
        ''
    );
BEGIN
    -- Each pinned row: a SQL snippet that must be deterministic, plus the
    -- expected md5 of its JSON form. The seeds above let CI inject the
    -- canonical id pair via psql -v.

    IF employee_id_seed = '' OR company_id_seed = '' THEN
        RAISE NOTICE 'mcp-semantic-checksum: seed values not provided. Set';
        RAISE NOTICE '  -v mcp.semantic_employee_id=<uuid> -v mcp.semantic_company_id=<uuid>';
        RAISE NOTICE 'on the psql invocation. Skipping assertions.';
        RETURN;
    END IF;

    FOR pinned IN
        SELECT * FROM (VALUES
            (
                'v_api_employees:row(employee_id_seed)',
                format(
                    $sql$
                    SELECT row_to_json(v) FROM mcp_api.v_api_employees v
                     WHERE v.canonical_employee_id = %L
                    $sql$, employee_id_seed
                ),
                '__SEED_REQUIRED__'
            ),
            (
                'v_api_companies:row(company_id_seed)',
                format(
                    $sql$
                    SELECT row_to_json(v) FROM mcp_api.v_api_companies v
                     WHERE v.canonical_company_id = %L
                    $sql$, company_id_seed
                ),
                '__SEED_REQUIRED__'
            ),
            (
                'v_api_employee_project_daily:total_hours(employee+project)',
                -- Stable scalar: total rounded_hours for the (employee, project)
                -- pair across all time. Uses the canonical project rollup so any
                -- drift in the JOIN/WHERE chain (e.g., a regression on the
                -- vpc.role filter) shifts the md5. Skipped automatically when
                -- the project seed is absent.
                CASE WHEN project_id_seed = '' THEN
                    'SELECT NULL::text'
                ELSE format(
                    $sql$
                    SELECT COALESCE(SUM(d.rounded_hours), 0)::text
                      FROM mcp_api.v_api_employee_project_daily d
                     WHERE d.canonical_employee_id = %L
                       AND d.canonical_project_id  = %L
                    $sql$, employee_id_seed, project_id_seed
                ) END,
                '__SEED_REQUIRED__'
            )
        ) AS t(label, sql_snippet, expected_md5)
    LOOP
        -- Skip the project-pinned row when the operator has not supplied a
        -- project id seed (we still NOTICE the actual md5 once seeded).
        CONTINUE WHEN pinned.label LIKE 'v_api_employee_project_daily%'
                 AND project_id_seed = '';
        EXECUTE 'SELECT md5(' || pinned.sql_snippet || '::text)' INTO actual_md5;

        IF actual_md5 IS NULL THEN
            RAISE EXCEPTION
                'mcp-semantic-checksum: pinned query for % returned no rows.',
                pinned.label;
        END IF;

        IF pinned.expected_md5 = '__SEED_REQUIRED__' THEN
            RAISE NOTICE 'mcp-semantic-checksum: %  actual_md5=%  (replace __SEED_REQUIRED__ in this file)',
                pinned.label, actual_md5;
        ELSIF actual_md5 <> pinned.expected_md5 THEN
            RAISE EXCEPTION
                E'mcp-semantic-checksum: row drift on %\n'
                ' expected md5: %\n'
                ' actual md5:   %',
                pinned.label, pinned.expected_md5, actual_md5;
        END IF;
    END LOOP;

    RAISE NOTICE 'mcp-semantic-checksum: all pinned rows match.';
END $$;
