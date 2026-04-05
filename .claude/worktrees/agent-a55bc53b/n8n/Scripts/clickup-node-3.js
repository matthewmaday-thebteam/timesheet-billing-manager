// =============================================================================
// ClickUp Node 3: Split time entries array + pass through sync metadata
// =============================================================================
// CHANGES FROM ORIGINAL:
//   - Pass _syncMeta through to each entry (in addition to lookups)
// =============================================================================

var data = items[0].json;
var te = data.timeentries || [];
var spaceLookup = data.spaceLookup || {};
var folderLookup = data.folderLookup || {};
var syncMeta = data._syncMeta || {};

var result = [];
for (var i = 0; i < te.length; i++) {
  var entry = te[i];
  entry._spaceLookup = spaceLookup;
  entry._folderLookup = folderLookup;
  entry._syncMeta = syncMeta;
  result.push({ json: entry });
}

return result;
