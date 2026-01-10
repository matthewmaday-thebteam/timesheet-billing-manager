-- ============================================================================
-- Resources Table Migration
-- Supports employee enrichment with self-healing upsert for n8n integration
-- ============================================================================

-- Create employment_type enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE employment_type AS ENUM ('full-time', 'part-time');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create resources table
CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_label TEXT NOT NULL UNIQUE,  -- System ID from Clockify (user_name)
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    teams_account TEXT,
    employment_type employment_type NOT NULL DEFAULT 'full-time',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on external_label for fast lookups
CREATE INDEX IF NOT EXISTS idx_resources_external_label ON resources(external_label);

-- Create index on employment_type for filtering
CREATE INDEX IF NOT EXISTS idx_resources_employment_type ON resources(employment_type);

-- ============================================================================
-- Self-Healing Upsert Function for n8n Integration
--
-- Usage in n8n: Call this function via Supabase RPC
-- This ensures resources are auto-created when new users appear in Clockify
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_resource_from_clockify(
    p_external_label TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_resource_id UUID;
BEGIN
    -- Try to find existing resource
    SELECT id INTO v_resource_id
    FROM resources
    WHERE external_label = p_external_label;

    -- If not found, create new resource with defaults
    IF v_resource_id IS NULL THEN
        INSERT INTO resources (external_label, employment_type)
        VALUES (p_external_label, 'full-time')
        RETURNING id INTO v_resource_id;
    END IF;

    RETURN v_resource_id;
END;
$$;

-- ============================================================================
-- Batch Upsert Function for Syncing Multiple Resources
--
-- Usage: Call when syncing timesheet data to ensure all users exist
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_resources_from_clockify(
    p_external_labels TEXT[]
)
RETURNS TABLE (
    external_label TEXT,
    resource_id UUID,
    is_new BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH existing AS (
        SELECT r.external_label, r.id, FALSE AS is_new
        FROM resources r
        WHERE r.external_label = ANY(p_external_labels)
    ),
    new_labels AS (
        SELECT unnest(p_external_labels) AS label
        EXCEPT
        SELECT external_label FROM existing
    ),
    inserted AS (
        INSERT INTO resources (external_label, employment_type)
        SELECT label, 'full-time'
        FROM new_labels
        RETURNING external_label, id, TRUE AS is_new
    )
    SELECT * FROM existing
    UNION ALL
    SELECT * FROM inserted;
END;
$$;

-- ============================================================================
-- Trigger to auto-update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_resources_updated_at ON resources;
CREATE TRIGGER set_resources_updated_at
    BEFORE UPDATE ON resources
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS) Policies
-- Enable RLS and create policies for authenticated access
-- ============================================================================

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all resources
CREATE POLICY "Allow authenticated read access"
    ON resources FOR SELECT
    TO authenticated
    USING (true);

-- Allow authenticated users to update resources
CREATE POLICY "Allow authenticated update access"
    ON resources FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Allow service role (n8n) to insert new resources
CREATE POLICY "Allow service role insert"
    ON resources FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Allow service role (n8n) full access
CREATE POLICY "Allow service role full access"
    ON resources FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON resources TO authenticated;
GRANT ALL ON resources TO service_role;
GRANT EXECUTE ON FUNCTION upsert_resource_from_clockify TO service_role;
GRANT EXECUTE ON FUNCTION sync_resources_from_clockify TO service_role;
