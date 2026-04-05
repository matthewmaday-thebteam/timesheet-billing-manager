-- Migration: Create resource_user_associations table
-- Purpose: Allow multiple time tracking system IDs (Clockify, ClickUp) to be associated with a single employee
-- Note: This migration ONLY creates new objects - NO alterations to existing tables

-- ============================================================================
-- Create the associations table
-- ============================================================================
CREATE TABLE IF NOT EXISTS resource_user_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('clockify', 'clickup')),
  user_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, source) -- same user_id can exist in different sources (unlikely but possible)
);

-- ============================================================================
-- Indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_rua_resource_id ON resource_user_associations(resource_id);
CREATE INDEX IF NOT EXISTS idx_rua_user_id ON resource_user_associations(user_id);
CREATE INDEX IF NOT EXISTS idx_rua_source ON resource_user_associations(source);

-- ============================================================================
-- Updated_at trigger (reuses existing function from resources table)
-- ============================================================================
DROP TRIGGER IF EXISTS set_resource_user_associations_updated_at ON resource_user_associations;
CREATE TRIGGER set_resource_user_associations_updated_at
  BEFORE UPDATE ON resource_user_associations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Row Level Security (required for Supabase)
-- ============================================================================
ALTER TABLE resource_user_associations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on resource_user_associations" ON resource_user_associations;
CREATE POLICY "Allow authenticated read on resource_user_associations"
  ON resource_user_associations
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on resource_user_associations" ON resource_user_associations;
CREATE POLICY "Allow authenticated insert on resource_user_associations"
  ON resource_user_associations
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update on resource_user_associations" ON resource_user_associations;
CREATE POLICY "Allow authenticated update on resource_user_associations"
  ON resource_user_associations
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated delete on resource_user_associations" ON resource_user_associations;
CREATE POLICY "Allow authenticated delete on resource_user_associations"
  ON resource_user_associations
  FOR DELETE TO authenticated
  USING (true);

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT ALL ON resource_user_associations TO authenticated;
GRANT ALL ON resource_user_associations TO service_role;

-- ============================================================================
-- Migrate existing data (non-destructive)
-- Copies existing resources.user_id values to the new associations table
-- Does NOT modify the resources table
-- ============================================================================
INSERT INTO resource_user_associations (resource_id, user_id, source, user_name)
SELECT
  id as resource_id,
  user_id,
  'clockify' as source,
  external_label as user_name
FROM resources
WHERE user_id IS NOT NULL
ON CONFLICT (user_id, source) DO NOTHING;

-- ============================================================================
-- Verification query (can be run after migration to confirm success)
-- ============================================================================
-- SELECT
--   r.id as resource_id,
--   r.external_label,
--   rua.user_id,
--   rua.source,
--   rua.user_name
-- FROM resources r
-- LEFT JOIN resource_user_associations rua ON r.id = rua.resource_id
-- ORDER BY r.external_label;
