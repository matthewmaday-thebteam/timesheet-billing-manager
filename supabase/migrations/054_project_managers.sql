-- ============================================================================
-- Migration 054: Project Managers
-- ============================================================================
-- Junction table linking projects to resources (employees) as project managers.
-- This is a data-storage feature for the product roadmap.

-- 1. Create junction table
CREATE TABLE IF NOT EXISTS project_managers (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (project_id, resource_id)
);

-- 2. Indexes on FK columns
CREATE INDEX IF NOT EXISTS idx_project_managers_project_id
    ON project_managers (project_id);

CREATE INDEX IF NOT EXISTS idx_project_managers_resource_id
    ON project_managers (resource_id);

-- 3. Enable RLS
ALTER TABLE project_managers ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
-- All authenticated users can read
CREATE POLICY "project_managers_select"
    ON project_managers FOR SELECT
    TO authenticated
    USING (true);

-- Only admins can insert
CREATE POLICY "project_managers_insert"
    ON project_managers FOR INSERT
    TO authenticated
    WITH CHECK (is_admin());

-- Only admins can delete
CREATE POLICY "project_managers_delete"
    ON project_managers FOR DELETE
    TO authenticated
    USING (is_admin());
