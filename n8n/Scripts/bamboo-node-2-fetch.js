// =============================================================================
// BambooHR Node 2: Fetch employee directory + time-off requests
// =============================================================================
// PURPOSE:
//   Two API calls to BambooHR:
//     1. Employee directory (all employees)
//     2. Time-off requests for the date range (all statuses)
//
// AUTH:
//   Basic Auth — API key as username, "x" as password
//
// OUTPUT:
//   { employees, timeOffRequests, _syncMeta }
// =============================================================================

const BAMBOO_API_KEY = 'e48d83dbba09fc9d8e26de7e3adac02114e46a3d';
const BAMBOO_COMPANY = 'thebteam';
const BASE_URL = `https://api.bamboohr.com/api/gateway.php/${BAMBOO_COMPANY}/v1`;

// Basic Auth header: API key as username, "x" as password
const authHeader = 'Basic ' + Buffer.from(`${BAMBOO_API_KEY}:x`).toString('base64');

// Generate unique run ID for this sync
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const SYNC_RUN_ID = generateUUID();
const SYNC_RUN_AT = new Date().toISOString();

// Get date range from Node 1
const rangeStartDate = $json.rangeStartDate;
const rangeEndDate = $json.rangeEndDate;

let employees = [];
let timeOffRequests = [];
let fetchComplete = true;
let errors = [];

// 1. Fetch employee directory
try {
  const dirResponse = await this.helpers.httpRequest({
    method: 'GET',
    url: `${BASE_URL}/employees/directory`,
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
    },
    json: true,
  });

  employees = dirResponse?.employees || [];
} catch (err) {
  fetchComplete = false;
  errors.push({
    type: 'employee_directory_error',
    message: err.message || 'Failed to fetch employee directory',
  });
}

// 2. Fetch time-off requests for date range
try {
  const timeOffResponse = await this.helpers.httpRequest({
    method: 'GET',
    url: `${BASE_URL}/time_off/requests?start=${rangeStartDate}&end=${rangeEndDate}`,
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json',
    },
    json: true,
  });

  // BambooHR returns an array directly for time-off requests
  timeOffRequests = Array.isArray(timeOffResponse) ? timeOffResponse : [];
} catch (err) {
  fetchComplete = false;
  errors.push({
    type: 'time_off_error',
    message: err.message || 'Failed to fetch time-off requests',
  });
}

return [{
  json: {
    employees,
    timeOffRequests,
    _syncMeta: {
      sync_run_id: SYNC_RUN_ID,
      sync_run_at: SYNC_RUN_AT,
      fetch_complete: fetchComplete,
      source: 'bamboohr',
      company: BAMBOO_COMPANY,
      range_start: rangeStartDate,
      range_end: rangeEndDate,
      total_employees: employees.length,
      total_time_off_requests: timeOffRequests.length,
      error_count: errors.length,
      errors,
    },
  }
}];
