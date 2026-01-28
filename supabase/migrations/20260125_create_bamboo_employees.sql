-- BambooHR Employees Table
-- Stores employee directory synced from BambooHR for linking to resources

CREATE TABLE IF NOT EXISTS bamboo_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bamboo_id TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bamboo_employees_bamboo_id ON bamboo_employees(bamboo_id);

ALTER TABLE bamboo_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read access"
  ON bamboo_employees FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow service role full access"
  ON bamboo_employees FOR ALL TO service_role USING (true) WITH CHECK (true);
