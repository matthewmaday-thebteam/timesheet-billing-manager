-- =============================================
-- Migration: Create Projects Table for Rate Management
-- =============================================

-- Create the projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  rate NUMERIC(10, 2) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on project_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_id ON projects(project_id);

-- Create index for lookups by project_name
CREATE INDEX IF NOT EXISTS idx_projects_project_name ON projects(project_name);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_projects_updated_at();

-- =============================================
-- Auto-Provisioning: Create projects from timesheet entries
-- =============================================

-- Function to upsert a project from timesheet data
CREATE OR REPLACE FUNCTION upsert_project_from_timesheet(
  p_project_id TEXT,
  p_project_name TEXT
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Try to insert, on conflict do nothing (project already exists)
  INSERT INTO projects (project_id, project_name)
  VALUES (p_project_id, p_project_name)
  ON CONFLICT (project_id) DO UPDATE
    SET project_name = EXCLUDED.project_name
    WHERE projects.project_name != EXCLUDED.project_name
  RETURNING id INTO v_id;

  -- If no insert happened, get the existing id
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM projects WHERE project_id = p_project_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to auto-create projects from timesheet_daily_rollups
CREATE OR REPLACE FUNCTION auto_create_project_from_rollup()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process if project_id is not null
  IF NEW.project_id IS NOT NULL AND NEW.project_name IS NOT NULL THEN
    PERFORM upsert_project_from_timesheet(NEW.project_id, NEW.project_name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on timesheet_daily_rollups
DROP TRIGGER IF EXISTS trg_auto_create_project ON timesheet_daily_rollups;
CREATE TRIGGER trg_auto_create_project
  AFTER INSERT ON timesheet_daily_rollups
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_project_from_rollup();

-- =============================================
-- Backfill: Populate projects from existing timesheet data
-- =============================================

INSERT INTO projects (project_id, project_name)
SELECT DISTINCT project_id, project_name
FROM timesheet_daily_rollups
WHERE project_id IS NOT NULL AND project_name IS NOT NULL
ON CONFLICT (project_id) DO NOTHING;

-- =============================================
-- RLS Policies
-- =============================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read projects
DROP POLICY IF EXISTS "Allow authenticated read access to projects" ON projects;
CREATE POLICY "Allow authenticated read access to projects"
  ON projects FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to update projects (for rate editing)
DROP POLICY IF EXISTS "Allow authenticated update access to projects" ON projects;
CREATE POLICY "Allow authenticated update access to projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow service role full access
DROP POLICY IF EXISTS "Allow service role full access to projects" ON projects;
CREATE POLICY "Allow service role full access to projects"
  ON projects FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT, UPDATE ON projects TO authenticated;
GRANT ALL ON projects TO service_role;
