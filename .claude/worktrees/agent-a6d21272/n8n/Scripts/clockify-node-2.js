// =============================================================================
// Clockify Node 2: Fetch detailed report with pagination + sync metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Generate sync_run_id UUID at start
//   - Wrap API calls in try/catch
//   - Track fetchComplete flag (false if ANY error or safety limit hit)
//   - Pass through range dates for cleanup scoping
// =============================================================================

const CLOCKIFY_API_KEY = 'NGE4NDkxZTAtYzQ1Ni00ZGQ2LWI2NGMtZDQ4M2Y2YjQzYzI0';
const WORKSPACE_ID = '683ee2051325f11af65497bd';

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

const url = `https://reports.api.clockify.me/v1/workspaces/${WORKSPACE_ID}/reports/detailed`;

const pageSize = 1000;
let page = 1;
let allTimeEntries = [];
let firstResponseMeta = null;

// Track fetch completeness
let fetchComplete = true;
let errors = [];
let hitSafetyLimit = false;

// Get date range from input (Node 1)
const rangeStart = $json.rangeStart;
const rangeEnd = $json.rangeEnd;
const rangeStartISO = $json.rangeStartISO || rangeStart;
const rangeEndISO = $json.rangeEndISO || rangeEnd;

try {
  while (true) {
    const body = {
      dateRangeStart: rangeStart,
      dateRangeEnd: rangeEnd,
      exportType: "JSON",
      detailedFilter: {
        page,
        pageSize
      }
    };

    let res;
    try {
      res = await this.helpers.httpRequest({
        method: 'POST',
        url,
        headers: {
          'X-Api-Key': CLOCKIFY_API_KEY,
          'Content-Type': 'application/json',
        },
        body,
        json: true,
      });
    } catch (apiErr) {
      // API call failed - mark as incomplete
      fetchComplete = false;
      errors.push({
        type: 'api_error',
        page: page,
        message: apiErr.message || 'Unknown API error',
      });
      break; // Stop pagination on error
    }

    if (!firstResponseMeta) firstResponseMeta = res;

    const batch = res?.timeentries || [];
    allTimeEntries = allTimeEntries.concat(batch);

    // Stop when the page returned fewer than pageSize entries (natural end)
    if (batch.length < pageSize) break;

    page += 1;

    // Safety break (prevents infinite loops if API acts weird)
    if (page > 50) {
      hitSafetyLimit = true;
      fetchComplete = false;
      errors.push({
        type: 'safety_limit',
        page: page,
        message: 'Hit 50 page safety limit - possible infinite loop or unusually large dataset',
      });
      break;
    }
  }
} catch (outerErr) {
  // Unexpected error in the loop
  fetchComplete = false;
  errors.push({
    type: 'unexpected_error',
    message: outerErr.message || 'Unexpected error during fetch',
  });
}

// Return combined response with sync metadata
return [{
  json: {
    ...firstResponseMeta,
    timeentries: allTimeEntries,
    _syncMeta: {
      sync_run_id: SYNC_RUN_ID,
      sync_run_at: SYNC_RUN_AT,
      fetch_complete: fetchComplete,
      source: 'clockify',
      workspace_id: WORKSPACE_ID,
      range_start: rangeStartISO,
      range_end: rangeEndISO,
      pages_fetched: page,
      page_size: pageSize,
      total_entries: allTimeEntries.length,
      hit_safety_limit: hitSafetyLimit,
      error_count: errors.length,
      errors: errors,
    },
    _pagination: {
      pagesFetched: page,
      pageSize,
      totalTimeEntries: allTimeEntries.length
    }
  }
}];
