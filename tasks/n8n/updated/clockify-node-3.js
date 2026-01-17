// =============================================================================
// Clockify Node 3: Split time entries array + pass through sync metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Pass _syncMeta through to each entry
// =============================================================================

const data = items[0]?.json || {};
const te = data.timeentries ?? [];
const syncMeta = data._syncMeta || {};

return te.map(t => ({
  json: {
    ...t,
    _syncMeta: syncMeta
  }
}));
