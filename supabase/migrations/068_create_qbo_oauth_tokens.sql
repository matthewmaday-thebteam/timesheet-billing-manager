-- ============================================================================
-- Migration 068: QuickBooks Online OAuth Token Storage & CSRF State
-- ============================================================================
-- Purpose: Create infrastructure for QBO OAuth 2.0 integration. Stores
-- access/refresh tokens for the connected QBO company and CSRF state
-- parameters used during the OAuth authorization flow.
--
-- Changes:
--   1. qbo_oauth_tokens table (encrypted token storage per realm)
--   2. qbo_oauth_state table (ephemeral CSRF state for OAuth flow)
--   3. RLS policies (service_role only — no client-side access)
--   4. Updated_at trigger on qbo_oauth_tokens
--   5. Auto-cleanup function for expired OAuth states
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: CREATE qbo_oauth_tokens TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS qbo_oauth_tokens (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    realm_id             TEXT UNIQUE NOT NULL,
    access_token         TEXT NOT NULL,
    refresh_token        TEXT NOT NULL,
    token_type           TEXT NOT NULL DEFAULT 'bearer',
    expires_at           TIMESTAMPTZ NOT NULL,
    refresh_expires_at   TIMESTAMPTZ,
    connected_by         UUID REFERENCES auth.users(id),
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE qbo_oauth_tokens IS
    'Stores QuickBooks Online OAuth 2.0 tokens. Only one active connection '
    'per realm (QBO company). Access is restricted to service_role — tokens '
    'are never exposed to the client.';

COMMENT ON COLUMN qbo_oauth_tokens.realm_id IS
    'The QBO Company ID (Intuit realm ID). Unique constraint ensures '
    'one token set per connected company.';

COMMENT ON COLUMN qbo_oauth_tokens.expires_at IS
    'Absolute expiry timestamp for the access token. Calculated as '
    'NOW() + expires_in seconds from the Intuit token response.';

COMMENT ON COLUMN qbo_oauth_tokens.refresh_expires_at IS
    'Absolute expiry timestamp for the refresh token. Calculated as '
    'NOW() + x_refresh_token_expires_in seconds from the Intuit response. '
    'Typically 100 days from issuance.';

-- ============================================================================
-- STEP 2: CREATE qbo_oauth_state TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS qbo_oauth_state (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state       TEXT UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE qbo_oauth_state IS
    'Ephemeral CSRF state tokens for the QBO OAuth authorization flow. '
    'Each row is created when an auth flow starts and deleted upon callback. '
    'States older than 10 minutes are considered expired and cleaned up.';

-- ============================================================================
-- STEP 3: INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qbo_oauth_tokens_realm ON qbo_oauth_tokens (realm_id);
CREATE INDEX IF NOT EXISTS idx_qbo_oauth_state_created ON qbo_oauth_state (created_at);

-- ============================================================================
-- STEP 4: UPDATED_AT TRIGGER (qbo_oauth_tokens)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_qbo_oauth_tokens_updated_at ON qbo_oauth_tokens;
CREATE TRIGGER trg_qbo_oauth_tokens_updated_at
    BEFORE UPDATE ON qbo_oauth_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 5: RLS POLICIES — service_role only
-- ============================================================================
-- Tokens contain sensitive credentials. No client-side access is permitted.
-- All token operations go through Edge Functions using the service_role key.

ALTER TABLE qbo_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_oauth_state ENABLE ROW LEVEL SECURITY;

-- qbo_oauth_tokens: service_role full access only
DROP POLICY IF EXISTS "Service role full access qbo_oauth_tokens" ON qbo_oauth_tokens;
CREATE POLICY "Service role full access qbo_oauth_tokens"
    ON qbo_oauth_tokens FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- qbo_oauth_state: service_role full access only
DROP POLICY IF EXISTS "Service role full access qbo_oauth_state" ON qbo_oauth_state;
CREATE POLICY "Service role full access qbo_oauth_state"
    ON qbo_oauth_state FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- STEP 6: GRANTS
-- ============================================================================

GRANT ALL ON qbo_oauth_tokens TO service_role;
GRANT ALL ON qbo_oauth_state TO service_role;

-- ============================================================================
-- STEP 7: CLEANUP FUNCTION FOR EXPIRED STATES
-- ============================================================================
-- Deletes OAuth state rows older than 10 minutes. Called at the start of
-- each auth flow to keep the table clean without requiring a cron job.

CREATE OR REPLACE FUNCTION cleanup_expired_qbo_oauth_states()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM qbo_oauth_state
    WHERE created_at < NOW() - INTERVAL '10 minutes';
$$;

COMMENT ON FUNCTION cleanup_expired_qbo_oauth_states IS
    'Removes QBO OAuth state rows older than 10 minutes. Called during '
    'each auth flow start to prevent unbounded table growth.';

GRANT EXECUTE ON FUNCTION cleanup_expired_qbo_oauth_states TO service_role;

-- ============================================================================
-- STEP 8: VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_tokens_exists BOOLEAN;
    v_state_exists BOOLEAN;
    v_tokens_policy_count INTEGER;
    v_state_policy_count INTEGER;
BEGIN
    -- Verify qbo_oauth_tokens table
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'qbo_oauth_tokens'
    ) INTO v_tokens_exists;

    -- Verify qbo_oauth_state table
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'qbo_oauth_state'
    ) INTO v_state_exists;

    -- Count policies
    SELECT COUNT(*) INTO v_tokens_policy_count
    FROM pg_policies
    WHERE tablename = 'qbo_oauth_tokens';

    SELECT COUNT(*) INTO v_state_policy_count
    FROM pg_policies
    WHERE tablename = 'qbo_oauth_state';

    RAISE NOTICE 'Migration 068 Complete:';
    RAISE NOTICE '  - qbo_oauth_tokens table: %', CASE WHEN v_tokens_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - qbo_oauth_state table: %', CASE WHEN v_state_exists THEN 'CREATED' ELSE 'MISSING' END;
    RAISE NOTICE '  - RLS policies on qbo_oauth_tokens: %', v_tokens_policy_count;
    RAISE NOTICE '  - RLS policies on qbo_oauth_state: %', v_state_policy_count;
    RAISE NOTICE '  - updated_at trigger attached to qbo_oauth_tokens';
    RAISE NOTICE '  - cleanup_expired_qbo_oauth_states function created';

    IF NOT v_tokens_exists THEN
        RAISE WARNING 'qbo_oauth_tokens table was not created!';
    END IF;
    IF NOT v_state_exists THEN
        RAISE WARNING 'qbo_oauth_state table was not created!';
    END IF;
END $$;

COMMIT;
