-- Migration 056: Allow authenticated users to drain recalculation queue
-- When billing limits, rates, rounding, or active status change from the UI,
-- the triggers enqueue recalculation but nothing drains the queue until the
-- next n8n sync. This wrapper lets the frontend drain it immediately.

CREATE OR REPLACE FUNCTION drain_recalculation_queue_authenticated(p_max_depth INTEGER DEFAULT 12)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN drain_recalculation_queue(p_max_depth);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION drain_recalculation_queue_authenticated(INTEGER) IS
  'SECURITY DEFINER wrapper so authenticated users can drain the recalculation queue after config changes.';

GRANT EXECUTE ON FUNCTION drain_recalculation_queue_authenticated(INTEGER) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '056 drain_recalculation_queue_authenticated created';
END $$;
