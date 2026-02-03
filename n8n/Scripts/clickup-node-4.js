// =============================================================================
// ClickUp Node 4: Normalize time entries + preserve sync metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Pass _syncMeta through to output
// =============================================================================

function toUTCDateStringFromStart(startMs) {
  if (!startMs) return null;
  var dt = new Date(Number(startMs));
  if (Number.isNaN(dt.getTime())) return null;
  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  var d = String(dt.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// Get syncMeta from first item
var syncMeta = items[0]?.json?._syncMeta || {};

var out = [];

for (var i = 0; i < items.length; i++) {
  var e = items[i].json;

  // Skip if no entry ID
  var entry_id = e.id || null;
  if (!entry_id) continue;

  // Duration is in milliseconds as a string
  var durationMs = parseInt(e.duration || '0', 10);
  var duration_seconds = Math.floor(durationMs / 1000);

  // Start/end are Unix timestamps in milliseconds (as strings)
  var startMs = e.start ? parseInt(e.start, 10) : null;
  var endMs = e.end ? parseInt(e.end, 10) : null;

  // Get nested objects safely
  var task = e.task || {};
  var user = e.user || {};
  var taskLocation = e.task_location || {};
  var tags = e.tags || [];
  var spaceLookup = e._spaceLookup || {};
  var folderLookup = e._folderLookup || {};

  // Look up names from lookups
  var spaceId = taskLocation.space_id || null;
  var folderId = taskLocation.folder_id || null;
  var spaceName = spaceLookup[spaceId] || null;
  var folderName = folderLookup[folderId] || null;

  // ClickUp hierarchy: Space = Company, Folder = Project
  // Use folder name as project_name, fallback to space name for folderless lists
  var projectName = folderName || spaceName || "No Project";

  out.push({
    json: {
      entry_id: entry_id,
      task_id: task.id || null,
      task_name: task.name || e.description || "(no task)",
      user_id: user.id || null,
      user_name: user.username || null,
      user_email: user.email || null,
      space_id: spaceId,
      folder_id: folderId,
      list_id: taskLocation.list_id || null,
      space_name: spaceName,
      folder_name: folderName,
      project_name: projectName,
      description: (e.description || "").trim() || "(no description)",
      billable: e.billable || false,
      tags: tags.map(function(t) { return t.name || t; }).join(', '),
      start: startMs ? new Date(startMs).toISOString() : null,
      end: endMs ? new Date(endMs).toISOString() : null,
      duration_seconds: duration_seconds,
      work_date: toUTCDateStringFromStart(startMs),
      source: 'clickup',

      // Pass through sync metadata
      _syncMeta: syncMeta,
    }
  });
}

return out;
