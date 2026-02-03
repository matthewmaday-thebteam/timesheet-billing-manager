// =============================================================================
// ClickUp Node 1: Date range scoping
// =============================================================================
// PURPOSE:
//   Compute the sync window: full prior month + current month.
//
// RANGE:
//   Start = 1st of previous month (00:00:00.000Z)
//   End   = last day of current month (23:59:59.999Z)
//
// OUTPUT FORMAT:
//   rangeStart / rangeEnd     = Unix timestamps in milliseconds (ClickUp API format)
//   rangeStartISO / rangeEndISO = ISO 8601 strings (for sync metadata)
// =============================================================================

const now = new Date();

// 1st of the previous month at midnight UTC
const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

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
