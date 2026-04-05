-- Create bulgarian_holidays table for managing public holidays
-- These holidays are used to exclude non-working days from billing and timesheet calculations

CREATE TABLE IF NOT EXISTS bulgarian_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_name TEXT NOT NULL,
  holiday_date DATE NOT NULL,
  is_system_generated BOOLEAN DEFAULT false,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on date to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulgarian_holidays_date
ON bulgarian_holidays(holiday_date);

-- Create index on year for efficient lookups
CREATE INDEX IF NOT EXISTS idx_bulgarian_holidays_year
ON bulgarian_holidays(year);

-- Enable RLS
ALTER TABLE bulgarian_holidays ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
CREATE POLICY "Allow public read access to holidays"
ON bulgarian_holidays FOR SELECT
TO public
USING (true);

-- Create policy for authenticated insert/update/delete
CREATE POLICY "Allow authenticated users to manage holidays"
ON bulgarian_holidays FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON bulgarian_holidays TO anon;
GRANT ALL ON bulgarian_holidays TO authenticated;

-- Function to sync holidays for a given year
CREATE OR REPLACE FUNCTION sync_bulgarian_holidays(target_year INTEGER)
RETURNS INTEGER AS $$
DECLARE
  holidays_added INTEGER := 0;
  easter_date DATE;
  a INTEGER;
  b INTEGER;
  c INTEGER;
  d INTEGER;
  e INTEGER;
  month INTEGER;
  day INTEGER;
BEGIN
  -- Calculate Orthodox Easter using Meeus Julian algorithm
  a := target_year % 4;
  b := target_year % 7;
  c := target_year % 19;
  d := (19 * c + 15) % 30;
  e := (2 * a + 4 * b - d + 34) % 7;
  month := (d + e + 114) / 31;
  day := ((d + e + 114) % 31) + 1;

  -- Convert Julian to Gregorian (add 13 days for 20th/21st century)
  easter_date := make_date(target_year, month, day) + INTERVAL '13 days';

  -- Insert fixed holidays (upsert - skip if exists)
  INSERT INTO bulgarian_holidays (holiday_name, holiday_date, is_system_generated, year)
  VALUES
    ('New Year''s Day', make_date(target_year, 1, 1), true, target_year),
    ('Liberation Day', make_date(target_year, 3, 3), true, target_year),
    ('Labour Day', make_date(target_year, 5, 1), true, target_year),
    ('St. George''s Day', make_date(target_year, 5, 6), true, target_year),
    ('Education and Culture Day', make_date(target_year, 5, 24), true, target_year),
    ('Unification Day', make_date(target_year, 9, 6), true, target_year),
    ('Independence Day', make_date(target_year, 9, 22), true, target_year),
    ('Christmas Eve', make_date(target_year, 12, 24), true, target_year),
    ('Christmas Day', make_date(target_year, 12, 25), true, target_year),
    ('Christmas Day (Second)', make_date(target_year, 12, 26), true, target_year),
    -- Easter-based holidays
    ('Good Friday', easter_date - INTERVAL '2 days', true, target_year),
    ('Holy Saturday', easter_date - INTERVAL '1 day', true, target_year),
    ('Easter Sunday', easter_date, true, target_year),
    ('Easter Monday', easter_date + INTERVAL '1 day', true, target_year)
  ON CONFLICT (holiday_date) DO NOTHING;

  GET DIAGNOSTICS holidays_added = ROW_COUNT;

  RETURN holidays_added;
END;
$$ LANGUAGE plpgsql;

-- Sync 2025 and 2026 holidays on table creation
SELECT sync_bulgarian_holidays(2025);
SELECT sync_bulgarian_holidays(2026);
