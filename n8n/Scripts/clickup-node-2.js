// =============================================================================
// ClickUp Node 2: Fetch time entries + sync metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Generate sync_run_id UUID at start
//   - CRITICAL: Stop swallowing errors - track them and set fetchComplete = false
//   - Track all errors for debugging
//   - Pass through range dates for cleanup scoping
// =============================================================================

const CLICKUP_API_TOKEN = 'pk_230417947_6WHF3H6YTQBUPNXIDNYZRRLT8JQVQDCO';
const TEAM_ID = '90151498763';

// Generate unique run ID for this sync (n8n-compatible UUID generator)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const SYNC_RUN_ID = generateUUID();
const SYNC_RUN_AT = new Date().toISOString();

const input = items[0].json;
const startDate = Math.floor(Number(input.rangeStart));
const endDate = Math.floor(Number(input.rangeEnd));
const rangeStartISO = input.rangeStartISO || new Date(startDate).toISOString();
const rangeEndISO = input.rangeEndISO || new Date(endDate).toISOString();

// Track fetch completeness
let fetchComplete = true;
let errors = [];

// First, get all team members
let teamRes;
try {
  teamRes = await this.helpers.httpRequest({
    method: 'GET',
    url: 'https://api.clickup.com/api/v2/team',
    headers: { 'Authorization': CLICKUP_API_TOKEN },
    json: true,
  });
} catch (err) {
  // Team fetch failed - cannot continue
  fetchComplete = false;
  errors.push({
    type: 'team_fetch_error',
    message: err.message || 'Failed to fetch team data',
  });

  return [{
    json: {
      timeentries: [],
      spaceLookup: {},
      folderLookup: {},
      _syncMeta: {
        sync_run_id: SYNC_RUN_ID,
        sync_run_at: SYNC_RUN_AT,
        fetch_complete: false,
        source: 'clickup',
        workspace_id: TEAM_ID,
        range_start: rangeStartISO,
        range_end: rangeEndISO,
        error_count: errors.length,
        errors: errors,
      },
      _meta: {
        totalTimeEntries: 0,
        teamMembersChecked: 0,
        spacesLoaded: 0,
        foldersLoaded: 0,
        rangeStart: rangeStartISO,
        rangeEnd: rangeEndISO,
      }
    }
  }];
}

// Build lookup maps for spaces and folders
var spaceLookup = {};
var folderLookup = {};

try {
  // Fetch all spaces
  var spacesRes = await this.helpers.httpRequest({
    method: 'GET',
    url: 'https://api.clickup.com/api/v2/team/' + TEAM_ID + '/space?archived=false',
    headers: { 'Authorization': CLICKUP_API_TOKEN },
    json: true,
  });

  var spaces = spacesRes.spaces || [];
  for (var s = 0; s < spaces.length; s++) {
    var space = spaces[s];
    spaceLookup[space.id] = space.name;

    // Fetch folders within each space
    try {
      var foldersRes = await this.helpers.httpRequest({
        method: 'GET',
        url: 'https://api.clickup.com/api/v2/space/' + space.id + '/folder?archived=false',
        headers: { 'Authorization': CLICKUP_API_TOKEN },
        json: true,
      });

      var folders = foldersRes.folders || [];
      for (var f = 0; f < folders.length; f++) {
        folderLookup[folders[f].id] = folders[f].name;
      }
    } catch (folderErr) {
      // Folder fetch failure is non-critical - log but continue
      errors.push({
        type: 'folder_fetch_warning',
        space_id: space.id,
        space_name: space.name,
        message: folderErr.message || 'Failed to fetch folders for space',
      });
      // Note: We don't set fetchComplete = false for folder lookups
      // because they're enhancement data, not core time entries
    }
  }
} catch (err) {
  // Space fetch failure is non-critical - log but continue
  errors.push({
    type: 'space_fetch_warning',
    message: err.message || 'Failed to fetch spaces',
  });
}

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
var membersFetched = 0;
var membersFailed = 0;

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
    membersFetched++;

  } catch (err) {
    // CRITICAL CHANGE: Do NOT silently skip - track the error
    membersFailed++;
    fetchComplete = false; // Mark as incomplete if ANY member fetch fails
    errors.push({
      type: 'member_fetch_error',
      user_id: userId,
      message: err.message || 'Failed to fetch time entries for user',
    });
  }
}

return [{
  json: {
    timeentries: allTimeEntries,
    spaceLookup: spaceLookup,
    folderLookup: folderLookup,
    _syncMeta: {
      sync_run_id: SYNC_RUN_ID,
      sync_run_at: SYNC_RUN_AT,
      fetch_complete: fetchComplete,
      source: 'clickup',
      workspace_id: TEAM_ID,
      range_start: rangeStartISO,
      range_end: rangeEndISO,
      total_entries: allTimeEntries.length,
      members_total: memberIds.length,
      members_fetched: membersFetched,
      members_failed: membersFailed,
      error_count: errors.length,
      errors: errors,
    },
    _meta: {
      totalTimeEntries: allTimeEntries.length,
      teamMembersChecked: memberIds.length,
      teamMembersFetched: membersFetched,
      teamMembersFailed: membersFailed,
      spacesLoaded: Object.keys(spaceLookup).length,
      foldersLoaded: Object.keys(folderLookup).length,
      rangeStart: rangeStartISO,
      rangeEnd: rangeEndISO,
    }
  }
}];
