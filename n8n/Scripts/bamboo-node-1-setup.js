// =============================================================================
// BambooHR Node 1: Date range — full calendar year
// =============================================================================
// PURPOSE:
//   Compute the sync window for the entire current calendar year.
//   BambooHR API uses YYYY-MM-DD format for date parameters.
//
// RANGE:
//   Start = January 1st of the current year
//   End   = December 31st of the current year
//
// OUTPUT FORMAT:
//   rangeStartDate / rangeEndDate = YYYY-MM-DD strings (BambooHR API format)
// =============================================================================

const now = new Date();
const year = now.getUTCFullYear();

const rangeStartDate = `${year}-01-01`;
const rangeEndDate = `${year}-12-31`;

return [{
  json: {
    rangeStartDate,
    rangeEndDate,
  }
}];
