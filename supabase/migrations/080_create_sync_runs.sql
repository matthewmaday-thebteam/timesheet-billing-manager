-- Migration 080: Create sync_runs table for diagnostics
-- Persists every sync run result for display on the Diagnostics page.

CREATE TABLE sync_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type       TEXT NOT NULL,
  sync_run_id     UUID,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  success         BOOLEAN NOT NULL,
  source_total    INTEGER NOT NULL DEFAULT 0,
  manifest_total  INTEGER NOT NULL DEFAULT 0,
  deleted_count   INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  summary         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sync_runs"
  ON sync_runs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_sync_runs_completed_at ON sync_runs (completed_at DESC);
