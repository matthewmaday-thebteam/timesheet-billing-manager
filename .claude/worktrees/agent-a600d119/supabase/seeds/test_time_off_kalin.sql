-- Test time-off records for Kalin
-- Run this in Supabase SQL Editor to create fake time-off data

-- First, find Kalin's resource_id
-- (Uncomment and run this first to get the ID)
-- SELECT id, first_name, last_name, email FROM resources WHERE first_name ILIKE '%kalin%';

-- Insert two time-off records for January 23rd and 26th, 2026
-- Replace the resource_id with Kalin's actual ID after running the query above

INSERT INTO employee_time_off (
  bamboo_request_id,
  bamboo_employee_id,
  resource_id,
  employee_name,
  employee_email,
  time_off_type,
  status,
  start_date,
  end_date,
  total_days,
  notes,
  synced_at
)
SELECT
  'test-kalin-001',
  'test-employee-kalin',
  r.id,
  r.first_name || ' ' || r.last_name,
  r.email,
  'Vacation',
  'approved',
  '2026-01-23',
  '2026-01-23',
  1.0,
  'Test time-off record',
  NOW()
FROM resources r
WHERE r.first_name ILIKE '%kalin%'
LIMIT 1
ON CONFLICT (bamboo_request_id) DO UPDATE SET
  synced_at = NOW();

INSERT INTO employee_time_off (
  bamboo_request_id,
  bamboo_employee_id,
  resource_id,
  employee_name,
  employee_email,
  time_off_type,
  status,
  start_date,
  end_date,
  total_days,
  notes,
  synced_at
)
SELECT
  'test-kalin-002',
  'test-employee-kalin',
  r.id,
  r.first_name || ' ' || r.last_name,
  r.email,
  'Vacation',
  'approved',
  '2026-01-26',
  '2026-01-26',
  1.0,
  'Test time-off record',
  NOW()
FROM resources r
WHERE r.first_name ILIKE '%kalin%'
LIMIT 1
ON CONFLICT (bamboo_request_id) DO UPDATE SET
  synced_at = NOW();

-- Verify the inserts
SELECT * FROM employee_time_off WHERE bamboo_request_id LIKE 'test-kalin%';
