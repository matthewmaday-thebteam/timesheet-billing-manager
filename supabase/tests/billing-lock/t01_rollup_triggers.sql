-- t01: timesheet_daily_rollups INSERT / UPDATE / DELETE queue the right
-- canonical project-months (migration 136).
\ir lib/assert.sql
\ir fixtures/scenario.sql

-- INSERT, standalone
SELECT t.upsert('n1', 'extP1', '2027-04-02', 30);
SELECT t.eq(t.pending(), ARRAY['extP1:2027-04:sync'], 'insert standalone queues its month');
SELECT t.clear_queue();

-- INSERT, member -> primary
SELECT t.upsert('n2', 'extPM', '2027-04-03', 30);
SELECT t.eq(t.pending(), ARRAY['extPG:2027-04:sync'], 'insert on member queues the primary');
SELECT t.clear_queue();

-- UPSERT with identical values: only synced_at / sync_run_id rewritten
SELECT t.upsert('tP1a', 'extP1', '2027-01-10', 60);
SELECT t.eq(t.pending(), '{}'::TEXT[], 'upsert rewriting only synced_at/sync_run_id queues nothing');
UPDATE timesheet_daily_rollups SET synced_at = NOW() + INTERVAL '1 hour', sync_run_id = gen_random_uuid(), sync_run_at = NOW();
SELECT t.eq(t.pending(), '{}'::TEXT[], 'bulk synced_at/sync_run_id/sync_run_at update queues nothing');

-- UPSERT changing total_minutes
SELECT t.upsert('tP1a', 'extP1', '2027-01-10', 75);
SELECT t.eq(t.pending(), ARRAY['extP1:2027-01:sync_update'], 'upsert changing total_minutes queues sync_update');
SELECT t.clear_queue();

-- rounded_minutes / task_name / client_id changes count as changes
UPDATE timesheet_daily_rollups SET rounded_minutes = 90 WHERE task_id = 'tP1a';
SELECT t.eq(t.pending(), ARRAY['extP1:2027-01:sync_update'], 'rounded_minutes change queues');
SELECT t.clear_queue();
UPDATE timesheet_daily_rollups SET task_name = 'Renamed' WHERE task_id = 'tP1a';
SELECT t.eq(t.pending(), ARRAY['extP1:2027-01:sync_update'], 'task_name change queues');
SELECT t.clear_queue();

-- Project move queues both projects
SELECT t.upsert('tP2a', 'extP1', '2027-01-12', 30);
SELECT t.eq(t.pending_pm(), ARRAY['extP1:2027-01', 'extP2:2027-01'], 'project move queues old and new project');
SELECT t.clear_queue();

-- Move into a group member resolves both sides canonically
SELECT t.upsert('tP2a', 'extPM', '2027-01-12', 30);
SELECT t.eq(t.pending_pm(), ARRAY['extP1:2027-01', 'extPG:2027-01'], 'move to member queues old project and the primary');
SELECT t.clear_queue();

-- Month-boundary work_date change queues both months
SELECT t.upsert('tP1b', 'extP1', '2027-03-01', 120);
SELECT t.eq(t.pending_pm(), ARRAY['extP1:2027-02', 'extP1:2027-03'], 'work_date across month boundary queues both months');
SELECT t.clear_queue();

-- 60 -> 0 queues; 0 -> 0 does not
SELECT t.upsert('tPXa', 'extPX', '2027-03-03', 0);
SELECT t.eq(t.pending(), ARRAY['extPX:2027-03:sync_update'], '60 -> 0 queues');
SELECT t.clear_queue();
UPDATE timesheet_daily_rollups SET task_name = 'Zero renamed' WHERE task_id = 'tPXa';
SELECT t.eq(t.pending(), '{}'::TEXT[], '0 -> 0 (other column changed) queues nothing');
-- 0 -> 30 queues the new side
SELECT t.upsert('tPXa', 'extPX', '2027-03-03', 30);
SELECT t.eq(t.pending(), ARRAY['extPX:2027-03:sync_update'], '0 -> 30 queues');
SELECT t.clear_queue();

-- DELETE (cleanup_stale_timesheet_entries path)
SELECT cleanup_stale_timesheet_entries('ws', '2027-03-01', '2027-03-31',
    (SELECT sync_run_id FROM timesheet_daily_rollups WHERE task_id = 'tP1c'));
SELECT t.eq(t.pending_pm(), ARRAY['extP1:2027-03', 'extPX:2027-03'],
    'delete via cleanup_stale_timesheet_entries queues the deleted rows'' months');
SELECT t.eq((SELECT ARRAY_AGG(DISTINCT reason) FROM recalculation_queue WHERE processed_at IS NULL), ARRAY['sync_delete'], 'delete reason is sync_delete');
SELECT t.clear_queue();

-- Deleting a zero-minute row queues nothing
SELECT t.upsert('z0', 'extP2', '2027-04-05', 0);
SELECT t.clear_queue();
DELETE FROM timesheet_daily_rollups WHERE task_id = 'z0';
SELECT t.eq(t.pending(), '{}'::TEXT[], 'deleting a 0-minute row queues nothing');

-- Unresolvable external project id raises an alert instead of being dropped
SELECT t.eq(enqueue_rollup_project_months(ARRAY['ext-does-not-exist', 'extP1'], ARRAY['2027-05-01', '2027-05-02']::DATE[], 'sync'),
            1, 'resolvable pair still queued');
SELECT t.eq(t.alerts('rollup_project_unresolved'), 1, 'unresolvable project id raises rollup_project_unresolved');
SELECT t.ok((SELECT metadata->'months' = '["2027-05"]'::JSONB FROM sync_alerts WHERE alert_type = 'rollup_project_unresolved'),
            'alert lists the affected months');
