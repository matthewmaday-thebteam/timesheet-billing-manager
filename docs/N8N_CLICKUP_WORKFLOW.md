# n8n ClickUp Time Tracking Workflow

This document contains the n8n Code nodes for syncing ClickUp time entries to Supabase, mirroring the existing Clockify workflow.

## Prerequisites

- ClickUp API Token (get from ClickUp Settings → Apps → API Token)
- ClickUp Team ID (use the setup node below to find it)

---

## One-Time Setup: Get Your ClickUp Team ID

Run this once to find your Team (Workspace) ID:

```javascript
// One-time: Get your ClickUp Team (Workspace) ID
const CLICKUP_API_TOKEN = 'pk_YOUR_TOKEN';

const res = await this.helpers.httpRequest({
  method: 'GET',
  url: 'https://api.clickup.com/api/v2/team',
  headers: {
    'Authorization': CLICKUP_API_TOKEN,
  },
  json: true,
});

// Returns all teams/workspaces you have access to
return res.teams.map(team => ({
  json: {
    team_id: team.id,
    team_name: team.name,
  }
}));
```

---

## Node 1: Set Scope

Sets the date range for the current month using Unix timestamps (milliseconds) as required by ClickUp's API.

```javascript
// Node 1: Full current month window for ClickUp (Unix ms timestamps)

const now = new Date();

const rangeStart = new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  1,
  0, 0, 0
));

const rangeEnd = new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth() + 1,
  1,
  0, 0, 0
));

return [{
  json: {
    // ClickUp uses Unix timestamps in milliseconds
    rangeStart: rangeStart.getTime(),
    rangeEnd: rangeEnd.getTime(),
    // Keep ISO for reference/debugging
    rangeStartISO: rangeStart.toISOString(),
    rangeEndISO: rangeEnd.toISOString(),
  }
}];
```

---

## Node 2: Get ClickUp Time Entries

Fetches all time entries from ClickUp for the specified date range. **Important:** ClickUp's API only returns time entries for the API token owner by default, so we must query each team member individually.

```javascript
// Node 2: Pull ClickUp time entries (with team member inclusion)

const CLICKUP_API_TOKEN = 'pk_YOUR_CLICKUP_API_TOKEN';
const TEAM_ID = 'YOUR_TEAM_ID';

const input = items[0].json;
const startDate = Math.floor(Number(input.rangeStart));
const endDate = Math.floor(Number(input.rangeEnd));

// First, get all team members
const teamRes = await this.helpers.httpRequest({
  method: 'GET',
  url: 'https://api.clickup.com/api/v2/team',
  headers: { 'Authorization': CLICKUP_API_TOKEN },
  json: true,
});

// Find our team and get member IDs
var memberIds = [];
for (var i = 0; i < teamRes.teams.length; i++) {
  if (teamRes.teams[i].id === TEAM_ID) {
    var members = teamRes.teams[i].members || [];
    for (var j = 0; j < members.length; j++) {
      memberIds.push(members[j].user.id);
    }
  }
}

// Fetch time entries for ALL team members
var allTimeEntries = [];

for (var k = 0; k < memberIds.length; k++) {
  var userId = memberIds[k];

  try {
    var res = await this.helpers.httpRequest({
      method: 'GET',
      url: 'https://api.clickup.com/api/v2/team/' + TEAM_ID + '/time_entries?start_date=' + startDate + '&end_date=' + endDate + '&assignee=' + userId,
      headers: { 'Authorization': CLICKUP_API_TOKEN },
      json: true,
    });

    var entries = res.data || [];
    for (var m = 0; m < entries.length; m++) {
      allTimeEntries.push(entries[m]);
    }
  } catch (err) {
    // Skip errors for individual users
  }
}

return [{
  json: {
    timeentries: allTimeEntries,
    _meta: {
      totalTimeEntries: allTimeEntries.length,
      teamMembersChecked: memberIds.length,
      rangeStart: input.rangeStartISO,
      rangeEnd: input.rangeEndISO,
    }
  }
}];
```

---

## Node 3: Extract Timesheet Data

Extracts the time entries array into individual items.

```javascript
// Node 3: Extract time entries array
var data = items[0].json;
var te = data.timeentries;
if (!te) te = [];
var result = [];
for (var i = 0; i < te.length; i++) {
  result.push({ json: te[i] });
}
return result;
```

> **Note:** n8n Code nodes don't support optional chaining (`?.`), so we use explicit checks.

---

## Node 4: Prep the Data

Normalizes ClickUp time entries into a consistent format.

```javascript
// Node 4: Normalize ClickUp time entries -> one item per time entry

function toUTCDateStringFromStart(startMs) {
  if (!startMs) return null;
  var dt = new Date(Number(startMs));
  if (Number.isNaN(dt.getTime())) return null;

  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  var d = String(dt.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// Get time entries from input
var timeentries = [];

var firstItem = items[0] && items[0].json ? items[0].json : null;

if (items.length === 1 && firstItem && Array.isArray(firstItem.timeentries)) {
  timeentries = firstItem.timeentries;
} else {
  timeentries = items.map(function(i) { return i.json; });
}

var out = [];

for (var i = 0; i < timeentries.length; i++) {
  var e = timeentries[i];

  var entry_id = (e && e.id) ? e.id : null;
  if (!entry_id) continue;

  // ClickUp returns duration in milliseconds as a string
  var durationMs = parseInt((e && e.duration) ? e.duration : '0', 10);
  var duration_seconds = Math.floor(durationMs / 1000);

  // ClickUp start/end are Unix timestamps in milliseconds (as strings)
  var startMs = (e && e.start) ? parseInt(e.start, 10) : null;
  var endMs = (e && e.end) ? parseInt(e.end, 10) : null;

  // Get nested objects safely
  var task = e && e.task ? e.task : {};
  var user = e && e.user ? e.user : {};
  var taskLocation = e && e.task_location ? e.task_location : {};
  var tags = e && e.tags ? e.tags : [];

  out.push({
    json: {
      entry_id: entry_id,

      // Task info
      task_id: task.id || null,
      task_name: task.name || (e && e.description) || "(no task)",

      // User info
      user_id: user.id || null,
      user_name: user.username || null,
      user_email: user.email || null,

      // Location hierarchy
      space_id: taskLocation.space_id || null,
      folder_id: taskLocation.folder_id || null,
      list_id: taskLocation.list_id || null,
      list_name: taskLocation.list_name || null,
      folder_name: taskLocation.folder_name || null,
      space_name: taskLocation.space_name || null,

      // Entry fields
      description: ((e && e.description) ? e.description : "").trim() || "(no description)",
      billable: (e && e.billable) ? e.billable : false,

      // Tags
      tags: tags.map(function(t) { return t.name; }).join(', '),

      // Timing
      start: startMs ? new Date(startMs).toISOString() : null,
      end: endMs ? new Date(endMs).toISOString() : null,
      duration_seconds: duration_seconds,
      work_date: toUTCDateStringFromStart(startMs),

      // Source
      source: (e && e.source) ? e.source : 'clickup',
    }
  });
}

return out;
```

> **Note:** This version avoids optional chaining (`?.`) and nullish coalescing (`??`) for n8n compatibility.

---

## Node 5: Flatten for Supabase

Transforms the data into rows ready for Supabase insertion.

```javascript
// Node 5: Build Supabase rows for ClickUp time entries

var CLICKUP_TEAM_ID = "YOUR_TEAM_ID";
var syncedAt = new Date().toISOString();

function roundUpMinutesTo15FromSeconds(seconds) {
  var minutes = seconds / 60;
  return Math.ceil(minutes / 15) * 15;
}

var rows = [];

for (var i = 0; i < items.length; i++) {
  var e = items[i].json;

  if (!e.entry_id) continue;
  if (!e.work_date) continue;

  var seconds = Number(e.duration_seconds || 0);
  if (!isFinite(seconds) || seconds <= 0) continue;

  var minutesRoundedUp = roundUpMinutesTo15FromSeconds(seconds);
  if (!isFinite(minutesRoundedUp) || minutesRoundedUp <= 0) continue;

  rows.push({
    clickup_team_id: CLICKUP_TEAM_ID,
    entry_id: e.entry_id,
    task_id: e.task_id || null,

    work_date: e.work_date,

    // ClickUp uses space/folder/list hierarchy instead of project
    space_id: e.space_id || null,
    space_name: e.space_name || null,
    folder_id: e.folder_id || null,
    folder_name: e.folder_name || null,
    list_id: e.list_id || null,
    list_name: e.list_name || null,

    user_id: e.user_id || null,
    user_name: e.user_name || "Unknown",

    task_name: e.task_name || "(no task)",
    description: e.description || "(no description)",

    billable: e.billable || false,

    total_minutes: minutesRoundedUp,
    synced_at: syncedAt,
  });
}

return [{ json: { rows: rows } }];
```

---

## Node 6: HTTP Request to Supabase

Use an HTTP Request node with the following configuration:

- **Method:** POST
- **URL:** `https://YOUR_PROJECT.supabase.co/rest/v1/clickup_time_entries`
- **Headers:**
  - `apikey`: Your Supabase anon key
  - `Authorization`: `Bearer YOUR_SUPABASE_ANON_KEY`
  - `Content-Type`: `application/json`
  - `Prefer`: `resolution=merge-duplicates` (for upsert behavior)
- **Body:** `{{ $json.rows }}`

---

## Supabase Table Schema

Create a table for ClickUp time entries:

```sql
CREATE TABLE clickup_time_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clickup_team_id TEXT NOT NULL,
  entry_id TEXT NOT NULL UNIQUE,
  task_id TEXT,

  work_date DATE NOT NULL,

  space_id TEXT,
  space_name TEXT,
  folder_id TEXT,
  folder_name TEXT,
  list_id TEXT,
  list_name TEXT,

  user_id TEXT,
  user_name TEXT,

  task_name TEXT,
  description TEXT,

  billable BOOLEAN DEFAULT false,

  total_minutes INTEGER NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for common queries
CREATE INDEX idx_clickup_time_entries_work_date ON clickup_time_entries(work_date);
CREATE INDEX idx_clickup_time_entries_user_id ON clickup_time_entries(user_id);
CREATE INDEX idx_clickup_time_entries_task_id ON clickup_time_entries(task_id);

-- Enable RLS
ALTER TABLE clickup_time_entries ENABLE ROW LEVEL SECURITY;
```

---

## Key Differences from Clockify

| Aspect | Clockify | ClickUp |
|--------|----------|---------|
| Timestamps | ISO strings | Unix ms |
| Hierarchy | Workspace → Project | Team → Space → Folder → List |
| Duration | Seconds (number) | Milliseconds (string) |
| Pagination | Page-based | None (date filtering) |
| Task reference | Description field | Nested task object |

---

## Configuration Checklist

- [ ] Replace `pk_YOUR_CLICKUP_API_TOKEN` with your actual API token
- [ ] Replace `YOUR_TEAM_ID` with your ClickUp Team ID
- [ ] Update Supabase URL and keys in the HTTP Request node
- [ ] Create the `clickup_time_entries` table in Supabase
- [ ] Test with a small date range first
