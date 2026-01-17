// =============================================================================
// Clockify Node 4: Normalize entries + preserve sync metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Pass _syncMeta through to output
// =============================================================================

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k] ?? null;
  return out;
}

function toUTCDateStringFromStart(e) {
  const start = e?.timeInterval?.start || null;
  if (!start) return null;
  const dt = new Date(start);
  if (Number.isNaN(dt.getTime())) return null;

  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Support two shapes:
// A) items[0].json.timeentries is an array (Clockify report payload)
// B) items is already a list of time entry items
let timeentries = [];
let syncMeta = {};

if (items.length === 1 && Array.isArray(items[0]?.json?.timeentries)) {
  timeentries = items[0].json.timeentries;
  syncMeta = items[0].json._syncMeta || {};
} else {
  timeentries = items.map(i => i.json);
  // Get syncMeta from first item
  syncMeta = items[0]?.json?._syncMeta || {};
}

const out = [];

for (const e of timeentries) {
  const task_id = e?._id || e?.id || null;
  if (!task_id) continue; // must have unique identifier

  const start = e?.timeInterval?.start ?? null;
  const end = e?.timeInterval?.end ?? null;
  const duration_seconds = typeof e?.timeInterval?.duration === "number" ? e.timeInterval.duration : 0;

  out.push({
    json: {
      task_id,

      // Associations (raw IDs)
      project_id: e?.projectId ?? null,
      user_id: e?.userId ?? null,
      client_id: e?.clientId ?? null,

      // Human names (for convenience)
      project_name: e?.projectName ?? null,
      user_name: e?.userName ?? null,
      client_name: e?.clientName ?? null,

      // Entry fields
      task_name: (e?.description ?? "").trim() || "(no description)",
      billable: e?.billable ?? null,
      type: e?.type ?? null,
      is_locked: e?.isLocked ?? null,

      // Timing
      start,
      end,
      duration_seconds,
      work_date: toUTCDateStringFromStart(e),

      // Optional: raw timezone info
      time_zone: e?.timeInterval?.timeZone ?? null,

      // Pass through sync metadata
      _syncMeta: syncMeta,
    }
  });
}

return out;
