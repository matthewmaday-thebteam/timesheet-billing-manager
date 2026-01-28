-- Add BambooHR employee ID to resources table for linking
ALTER TABLE resources
ADD COLUMN IF NOT EXISTS bamboo_employee_id TEXT;

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_resources_bamboo_employee
ON resources(bamboo_employee_id)
WHERE bamboo_employee_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN resources.bamboo_employee_id IS 'BambooHR employee ID for linking time-off data';
