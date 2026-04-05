-- ============================================================================
-- Migration 057: Fix NULL client_name crash in upsert_company_from_project
-- ============================================================================
-- PROBLEM:
--   When a time entry has a client_id but no client_name (e.g., a Clockify
--   project with a client assigned but the client name is empty/null), the
--   upsert_company_from_project() function attempts:
--     INSERT INTO companies (client_id, client_name) VALUES ('abc', NULL)
--   This violates the NOT NULL constraint on companies.client_name.
--
-- FIX:
--   Add a NULL guard for p_client_name — use 'Unknown Client' as fallback.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION upsert_company_from_project(
    p_client_id TEXT,
    p_client_name TEXT
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_name TEXT;
BEGIN
    -- Skip if client_id is null
    IF p_client_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Fallback for null client_name
    v_name := COALESCE(NULLIF(TRIM(p_client_name), ''), 'Unknown Client');

    -- Try to insert, on conflict update name if different
    INSERT INTO companies (client_id, client_name)
    VALUES (p_client_id, v_name)
    ON CONFLICT (client_id) DO UPDATE
        SET client_name = EXCLUDED.client_name,
            updated_at = NOW()
        WHERE companies.client_name != EXCLUDED.client_name
    RETURNING id INTO v_id;

    -- If no insert/update happened, get the existing id
    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM companies WHERE client_id = p_client_id;
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
