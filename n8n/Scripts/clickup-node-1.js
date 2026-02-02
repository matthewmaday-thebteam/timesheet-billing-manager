// =============================================================================
// ClickUp Node 1: Date range scoping
// =============================================================================
// PURPOSE:
//   Compute the sync window: last 2 weeks of the prior month + current month.
//   This accounts for employees entering timesheets up to ~2 weeks late.
//
// RANGE:
//   Start = 1st of current month minus 14 days
//   End   = last day of current month (23:59:59.999Z)
//
// OUTPUT FORMAT:
//   rangeStart / rangeEnd     = Unix timestamps in milliseconds (ClickUp API format)
//   rangeStartISO / rangeEndISO = ISO 8601 strings (for sync metadata)
// =============================================================================

const now = new Date();

// 1st of the current month at midnight UTC
const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// 14 days before the 1st
const rangeStart = new Date(firstOfMonth.getTime() - 14 * 24 * 60 * 60 * 1000);

// Last day of current month (month+1 day 0 = last day of current month)
const rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

return [{
  json: {
    rangeStart: rangeStart.getTime(),
    rangeEnd: rangeEnd.getTime(),
    rangeStartISO: rangeStart.toISOString(),
    rangeEndISO: rangeEnd.toISOString(),
  }
}];
