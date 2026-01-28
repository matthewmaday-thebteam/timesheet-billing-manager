-- Employee Time-Off Table
-- Stores scheduled time-off synced from BambooHR

CREATE TABLE IF NOT EXISTS employee_time_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- BambooHR identifiers
  bamboo_request_id TEXT NOT NULL UNIQUE,
  bamboo_employee_id TEXT NOT NULL,

  -- Link to our resources table (nullable until matched)
  resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,

  -- Employee info from BambooHR
  employee_name TEXT NOT NULL,
  employee_email TEXT,

  -- Time-off details
  time_off_type TEXT NOT NULL,        -- e.g., "Vacation", "Sick Leave", "PTO"
  status TEXT NOT NULL,               -- e.g., "approved", "pending", "denied"
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,

  -- Duration
  total_days DECIMAL(5,2) NOT NULL,   -- Supports half days

  -- Notes
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_time_off_dates ON employee_time_off(start_date, end_date);
CREATE INDEX idx_time_off_resource ON employee_time_off(resource_id);
CREATE INDEX idx_time_off_bamboo_employee ON employee_time_off(bamboo_employee_id);
CREATE INDEX idx_time_off_status ON employee_time_off(status);

-- Enable RLS
ALTER TABLE employee_time_off ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can read all time-off records
CREATE POLICY "Allow authenticated read access"
  ON employee_time_off
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: service role can manage all records (for n8n sync)
CREATE POLICY "Allow service role full access"
  ON employee_time_off
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comment
COMMENT ON TABLE employee_time_off IS 'Employee time-off records synced from BambooHR';

-- Function to auto-link time-off records to resources
CREATE OR REPLACE FUNCTION link_time_off_to_resources()
RETURNS TRIGGER AS $$
BEGIN
  -- Try to find matching resource by bamboo_employee_id
  SELECT id INTO NEW.resource_id
  FROM resources
  WHERE bamboo_employee_id = NEW.bamboo_employee_id
  LIMIT 1;

  -- If no match by bamboo_id, try matching by email
  IF NEW.resource_id IS NULL AND NEW.employee_email IS NOT NULL THEN
    SELECT id INTO NEW.resource_id
    FROM resources
    WHERE LOWER(email) = LOWER(NEW.employee_email)
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-link on insert/update
CREATE TRIGGER trigger_link_time_off
  BEFORE INSERT OR UPDATE ON employee_time_off
  FOR EACH ROW
  EXECUTE FUNCTION link_time_off_to_resources();

-- Backfill existing records (run once after migration)
UPDATE employee_time_off eto
SET resource_id = r.id
FROM resources r
WHERE eto.resource_id IS NULL
  AND (r.bamboo_employee_id = eto.bamboo_employee_id
       OR LOWER(r.email) = LOWER(eto.employee_email));
