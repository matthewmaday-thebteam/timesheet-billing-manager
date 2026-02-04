// =============================================================================
// Clockify Node 5: Build Supabase rows + include sync_run_id + output metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Add sync_run_id and sync_run_at to each row
//   - Output _meta object for conditional cleanup in Node 6
//   - Store ACTUAL minutes (rounding is now applied per-project at calculation time)
// =============================================================================

const CLOCKIFY_WORKSPACE_ID = "683ee2051325f11af65497bd";

// Get sync metadata from first item
const syncMeta = items[0]?.json?._syncMeta || {};
const syncRunId = syncMeta.sync_run_id || null;
const syncRunAt = syncMeta.sync_run_at || new Date().toISOString();

const rows = [];

for (const item of items) {
  const e = item.json;

  if (!e.task_id) continue;
  if (!e.work_date) continue;

  const seconds = Number(e.duration_seconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) continue;

  // Store actual minutes (round up to whole minutes only)
  const actualMinutes = Math.ceil(seconds / 60);
  if (!Number.isFinite(actualMinutes) || actualMinutes <= 0) continue;

  rows.push({
    clockify_workspace_id: CLOCKIFY_WORKSPACE_ID,
    task_id: e.task_id,

    work_date: e.work_date,

    project_id: e.project_id ?? null,
    project_name: e.project_name || "No Project",

    user_id: e.user_id ?? null,
    user_name: e.user_name || "Unknown",

    task_name: e.task_name || "(no description)",

    // Client/Company fields
    client_id: e.client_id ?? null,
    client_name: e.client_name || null,

    total_minutes: actualMinutes,
    synced_at: syncRunAt,

    // NEW: sync run tracking for deletion detection
    sync_run_id: syncRunId,
    sync_run_at: syncRunAt,
  });
}

// Store metadata in workflow static data for Node 6 to retrieve
// (Supabase upsert node doesn't pass through _meta, so we use static data)
const staticData = $getWorkflowStaticData('global');
staticData.lastSyncMeta = {
  sync_run_id: syncRunId,
  sync_run_at: syncRunAt,
  fetch_complete: syncMeta.fetch_complete ?? false,
  source: 'clockify',
  workspace_id: CLOCKIFY_WORKSPACE_ID,
  range_start: syncMeta.range_start || null,
  range_end: syncMeta.range_end || null,
  total_entries_fetched: syncMeta.total_entries || 0,
  rows_to_upsert: rows.length,
  error_count: syncMeta.error_count || 0,
  errors: syncMeta.errors || [],
};

// Output rows for Supabase upsert
return [{
  json: {
    rows: rows,
  }
}];
