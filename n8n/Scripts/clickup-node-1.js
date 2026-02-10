// =============================================================================
// ClickUp Node 1: Date range scoping
// =============================================================================
// PURPOSE:
//   Compute the sync window: full prior month + current month.
//
// RANGE:
//   Start = 1st of previous month (00:00:00.000Z)
//   End   = last millisecond of current month (23:59:59.999Z)
//
// OUTPUT FORMAT:
//   rangeStart / rangeEnd       = Unix timestamps in milliseconds (ClickUp API format)
//   rangeStartISO / rangeEndISO = ISO 8601 strings (for sync metadata)
// =============================================================================

const now = new Date();

// 1st of the previous month at 00:00:00.000Z
const rangeStart = new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth() - 1,
  1,
  0, 0, 0, 0
));

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

return [{
  json: {
    rangeStart: rangeStart.getTime(),
    rangeEnd: rangeEnd.getTime(),
    rangeStartISO: rangeStart.toISOString(),
    rangeEndISO: rangeEnd.toISOString(),
  }
}];
