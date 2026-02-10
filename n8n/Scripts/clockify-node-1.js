// =============================================================================
// Clockify Node 1: Date range scoping
// =============================================================================
// PURPOSE:
//   Compute the sync window: last 2 weeks of the prior month + current month.
//   This accounts for employees entering timesheets up to ~2 weeks late.
//
// RANGE:
//   Start = 1st of current month minus 14 days (00:00:00.000Z)
//   End   = last millisecond of current month (23:59:59.999Z)
//
// OUTPUT FORMAT:
//   rangeStart / rangeEnd         = ISO 8601 strings (Clockify API format)
//   rangeStartISO / rangeEndISO   = same (for sync metadata)
// =============================================================================

const now = new Date();

// 1st of the current month at 00:00:00.000Z
const firstOfMonth = new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  1,
  0, 0, 0, 0
));

// 14 days before the 1st (still UTC-based)
const rangeStart = new Date(firstOfMonth.getTime() - 14 * 24 * 60 * 60 * 1000);

// Last millisecond of the current month:
// 1st of next month at 00:00:00.000Z minus 1 ms
const rangeEnd = new Date(
  Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1,
    0, 0, 0, 0
  ) - 1
);

const rangeStartISO = rangeStart.toISOString();
const rangeEndISO = rangeEnd.toISOString();

return [{
  json: {
    rangeStart: rangeStartISO,
    rangeEnd: rangeEndISO,
    rangeStartISO: rangeStartISO,
    rangeEndISO: rangeEndISO,
  }
}];
