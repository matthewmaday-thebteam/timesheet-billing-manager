-- Add monthly_cost column to resources table
-- This stores the manually-entered monthly cost for each employee

ALTER TABLE resources
ADD COLUMN monthly_cost DECIMAL(10, 2) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN resources.monthly_cost IS 'Manually entered monthly cost to the company for this employee';
