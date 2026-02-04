// =============================================================================
// ClickUp Node 5: Build Supabase rows + include sync_run_id + output metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Add sync_run_id and sync_run_at to each row
//   - Output _meta object for conditional cleanup in Node 6
//   - Store ACTUAL minutes (rounding is now applied per-project at calculation time)
// =============================================================================

var CLICKUP_TEAM_ID = "90151498763";

// Get sync metadata from first item
var syncMeta = items[0]?.json?._syncMeta || {};
var syncRunId = syncMeta.sync_run_id || null;
var syncRunAt = syncMeta.sync_run_at || new Date().toISOString();

var rows = [];

for (var i = 0; i < items.length; i++) {
  var e = items[i].json;

  if (!e.work_date) continue;
  if (!e.entry_id) continue;  // Must have unique entry_id

  var seconds = Number(e.duration_seconds || 0);
  if (!isFinite(seconds) || seconds <= 0) continue;

  // Store actual minutes (round up to whole minutes only)
  var actualMinutes = Math.ceil(seconds / 60);
  if (actualMinutes <= 0) continue;

  rows.push({
    clockify_workspace_id: CLICKUP_TEAM_ID,
    work_date: e.work_date,

    // Project = Folder in ClickUp hierarchy, fallback to Space for folderless lists
    project_id: e.folder_id ? String(e.folder_id) : (e.space_id ? String(e.space_id) : null),
    project_name: e.project_name || "No Project",
    user_id: e.user_id,
    user_name: e.user_name || "Unknown",
    task_id: String(e.entry_id),  // USE entry_id - unique per time entry
    task_name: e.task_name || "No Task",

    // Client/Company = Space in ClickUp hierarchy
    client_id: e.space_id ? String(e.space_id) : null,
    client_name: e.space_name || null,

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
  source: 'clickup',
  workspace_id: CLICKUP_TEAM_ID,
  range_start: syncMeta.range_start || null,
  range_end: syncMeta.range_end || null,
  total_entries_fetched: syncMeta.total_entries || 0,
  rows_to_upsert: rows.length,
  members_total: syncMeta.members_total || 0,
  members_fetched: syncMeta.members_fetched || 0,
  members_failed: syncMeta.members_failed || 0,
  error_count: syncMeta.error_count || 0,
  errors: syncMeta.errors || [],
};

// Output rows for Supabase upsert
return [{
  json: {
    rows: rows,
  }
}];
