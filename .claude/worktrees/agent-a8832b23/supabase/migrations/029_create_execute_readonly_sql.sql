-- Migration: Create execute_readonly_sql function for AI chat
-- This function allows the AI to execute read-only SQL queries

-- Create a function that executes read-only SQL and returns JSON
CREATE OR REPLACE FUNCTION execute_readonly_sql(sql_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '30s'
AS $$
DECLARE
  result JSONB;
  normalized_query TEXT;
BEGIN
  -- Normalize the query for checking
  normalized_query := UPPER(TRIM(sql_query));

  -- Ensure query starts with SELECT
  IF NOT (normalized_query LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block dangerous keywords (even in subqueries or comments)
  IF normalized_query ~ '(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL)' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  -- Block function creation or execution that could be dangerous
  IF normalized_query ~ '(INTO\s+|COPY\s+|pg_read_file|pg_write_file|lo_import|lo_export)' THEN
    RAISE EXCEPTION 'Query contains forbidden operations';
  END IF;

  -- Execute the query and return as JSON array
  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || sql_query || ') t'
  INTO result;

  RETURN result;
END;
$$;

-- Grant execute to authenticated users (the Edge Function uses service role, but this is for safety)
GRANT EXECUTE ON FUNCTION execute_readonly_sql(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION execute_readonly_sql(TEXT) TO service_role;

-- Add comment
COMMENT ON FUNCTION execute_readonly_sql(TEXT) IS 'Executes read-only SQL queries for the AI chat feature. Only SELECT queries allowed.';
