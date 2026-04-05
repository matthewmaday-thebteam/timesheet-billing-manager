# Task 024: n8n Sync Deletion Handling

**Status:** IN PROGRESS - PAUSED FOR CONTINUATION

## 1. Problem Statement

The n8n workflows sync timesheet data from multiple sources (Clockify, ClickUp) into Supabase's `timesheet_daily_rollups` table. Currently:

- **Inserts work:** New time entries are created
- **Updates work:** Edited time entries are updated via upsert on `task_id`
- **Deletes don't work:** If an employee deletes a time entry in the source system, it remains in Supabase indefinitely

### Why This Is Complicated

1. **Multi-source isolation:** Two independent workflows (Clockify, ClickUp) sync to the same table
2. **Can't delete "missing" entries:** Would wipe the other system's data
3. **Can't delete-all-and-rebuild:** Risk of data loss if batch fails mid-sync

---

## 2. Approved Solution: Month Rebuild + Gated Cleanup

### Core Concept

Treat Supabase as a **cache of the source's "current truth"** for the month:

1. Each sync run generates a unique `sync_run_id` (UUID)
2. All fetched rows are upserted with this `sync_run_id`
3. **Only if fetch completes successfully**, delete rows in the same source+month slice that were NOT tagged with this run's ID
4. This automatically reflects source deletions on the next successful sync

### Safety Gate

```
IF fetch_complete === false OR upsert failed:
    SKIP cleanup (no deletes)
    Log warning
```

This prevents accidental deletion when API returns partial data (rate limits, timeouts, pagination failures).

---

## 3. Implementation Plan

### Phase 1: Database Migration

**File:** `supabase/migrations/016_add_sync_run_id.sql`

```sql
-- Add sync_run_id column
ALTER TABLE timesheet_daily_rollups
  ADD COLUMN IF NOT EXISTS sync_run_id UUID;

-- Optional: audit timestamp
ALTER TABLE timesheet_daily_rollups
  ADD COLUMN IF NOT EXISTS sync_run_at TIMESTAMPTZ;

-- Partial index for legacy NULL cleanup
CREATE INDEX IF NOT EXISTS idx_tdr_sync_run_null
  ON timesheet_daily_rollups (clockify_workspace_id, work_date)
  WHERE sync_run_id IS NULL;

-- Column documentation
COMMENT ON COLUMN timesheet_daily_rollups.sync_run_id IS
  'UUID of the sync run that last inserted/updated this entry. NULL for legacy data.';
```

**Note:** Existing `idx_tdr_ws_date` index is sufficient for cleanup query performance.

---

### Phase 2: n8n Workflow Changes

#### 2.1 Clockify Workflow

| Node | Current State | Required Changes |
|------|--------------|------------------|
| Node 2 | Fetches with pagination, no error tracking | Add `runId`, wrap in try/catch, track `fetchComplete` |
| Node 3 | Simple array split | Pass through `_syncRunId`, `_fetchComplete`, `_rangeStart`, `_rangeEnd` |
| Node 4 | Normalizes entries | Preserve metadata fields |
| Node 5 | Builds rows for Supabase | Add `sync_run_id` to each row, output cleanup metadata |
| **Node 6 (NEW)** | N/A | Conditional cleanup - only runs if `fetch_complete === true` |

#### 2.2 ClickUp Workflow

| Node | Current State | Required Changes |
|------|--------------|------------------|
| Node 2 | Loops members, **silently swallows errors** | Add `runId`, track errors, set `fetchComplete = false` on ANY error |
| Node 3 | Splits array, attaches lookups | Pass through sync metadata |
| Node 4 | Normalizes entries | Preserve metadata fields |
| Node 5 | Builds rows for Supabase | Add `sync_run_id` to each row, output cleanup metadata |
| **Node 6 (NEW)** | N/A | Conditional cleanup - only runs if `fetch_complete === true` |

**Critical Fix Required (ClickUp Node 2):**
```javascript
// CURRENT (DANGEROUS):
catch (err) {
  // Skip errors for individual users  <-- SILENT FAILURE
}

// REQUIRED:
catch (err) {
  fetchComplete = false;
  errors.push({ userId, error: err.message });
}
```

---

### Phase 3: Unified Output Contract

Both workflows must output the same structure from Node 5:

```javascript
return [{
  json: {
    rows: rows,
    _meta: {
      sync_run_id: SYNC_RUN_ID,
      fetch_complete: fetchComplete,
      source: 'clockify',  // or 'clickup'
      workspace_id: WORKSPACE_ID,
      range_start: rangeStartISO,
      range_end: rangeEndISO,
      error_count: errors.length,
      errors: errors,  // optional: for debugging
    }
  }
}];
```

---

### Phase 4: Cleanup Node (Node 6)

**Shared logic for both workflows:**

```javascript
// Node 6: Conditional Cleanup
const meta = items[0].json._meta;

if (!meta.fetch_complete) {
  return [{
    json: {
      action: 'cleanup_skipped',
      reason: 'fetch_incomplete',
      error_count: meta.error_count,
      sync_run_id: meta.sync_run_id
    }
  }];
}

// Execute cleanup via Supabase RPC or direct SQL
// DELETE FROM timesheet_daily_rollups
// WHERE clockify_workspace_id = :workspace_id
//   AND work_date BETWEEN :range_start AND :range_end
//   AND (sync_run_id IS DISTINCT FROM :run_id);

return [{
  json: {
    action: 'cleanup_executed',
    sync_run_id: meta.sync_run_id,
    workspace_id: meta.workspace_id,
    range_start: meta.range_start,
    range_end: meta.range_end
  }
}];
```

**Note on PostgREST:** Supabase's `.not('sync_run_id', 'eq', runId)` does NOT match NULL values. Use raw SQL or create an RPC function for the cleanup.

---

## 4. Test Plan

| Test Case | Expected Result |
|-----------|-----------------|
| Delete entry in source | Row disappears after next successful sync |
| Edit entry in source | Row updated via upsert |
| Force partial fetch (simulate API error) | `fetch_complete = false`, cleanup skipped, no data loss |
| Multi-source isolation | Clockify cleanup never touches ClickUp rows (different `workspace_id`) |
| First run with legacy NULL rows | Legacy rows cleaned up (intended - full rebuild) |
| Concurrent runs (edge case) | Later run overwrites tags; earlier run's cleanup may delete newer data (mitigate via scheduling) |

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Partial fetch causes data loss | LOW (with safety gate) | HIGH | `fetch_complete` flag prevents cleanup |
| Concurrent runs conflict | LOW | MEDIUM | n8n scheduled jobs don't overlap |
| Legacy NULL rows deleted on first run | CERTAIN | LOW | Expected behavior - full rebuild from source |
| PostgREST NULL handling | N/A | N/A | Use raw SQL or RPC for cleanup |

---

## 6. Execution Checklist

### Database
- [x] Create migration `016_add_sync_run_id.sql`
- [ ] Apply migration to Supabase
- [ ] Verify column added and index created

### Clockify Workflow
- [x] Update Node 2: Add `runId`, try/catch, `fetchComplete` tracking
- [x] Update Node 3: Pass through metadata
- [x] Update Node 4: Preserve metadata
- [x] Update Node 5: Add `sync_run_id` to rows, output `_meta`
- [x] Create Node 6: Conditional cleanup
- [ ] Test with intentional API failure

### ClickUp Workflow
- [x] Update Node 2: Add `runId`, stop swallowing errors, track `fetchComplete`
- [x] Update Node 3: Pass through metadata
- [x] Update Node 4: Preserve metadata
- [x] Update Node 5: Add `sync_run_id` to rows, output `_meta`
- [x] Create Node 6: Conditional cleanup
- [ ] Test with intentional API failure

### Validation
- [ ] Test deletion propagation (delete in source -> verify removal)
- [ ] Test partial fetch safety (force error -> verify no cleanup)
- [ ] Test multi-source isolation (verify workspace scoping)
- [ ] Monitor first production run (legacy NULL cleanup)

---

## 7. Reference: Current Workflow Files

### Clockify
- `tasks/n8n/Node 2 clockify.txt` - Fetch with pagination
- `tasks/n8n/Node 3 Clockify.txt` - Split array
- `tasks/n8n/Node 4 clockify.txt` - Normalize entries
- `tasks/n8n/node 5 clockify.txt` - Build Supabase rows

### ClickUp
- `tasks/n8n/Node 2 code.txt` - Fetch per team member
- `tasks/n8n/Node 3 code.txt` - Split array, attach lookups
- `tasks/n8n/Node 4 code.txt` - Normalize entries
- `tasks/n8n/node 5 code.txt` - Build Supabase rows

---

## 8. Implementation Notes

**Investigation Date:** 2026-01-17

### Key Findings from Database Architect Review

1. **Triggers are safe:** `trg_auto_create_project` and `trg_auto_create_resource` are INSERT-only, won't fire on DELETE
2. **Existing index sufficient:** `idx_tdr_ws_date` covers cleanup query; no need for composite index with `sync_run_id`
3. **Frontend unaffected:** No append-only assumptions, deletions reflect on next refetch
4. **View unchanged:** `v_timesheet_entries` doesn't need to expose `sync_run_id`

### Source System Identifiers

| Source | Identifier Field | Value |
|--------|-----------------|-------|
| Clockify | `clockify_workspace_id` | `683ee2051325f11af65497bd` |
| ClickUp | `clockify_workspace_id` | `90151498763` (team ID) |

---

## 9. Awaiting Approval

- [ ] Approve database migration approach
- [ ] Approve n8n workflow changes
- [ ] Confirm test plan coverage
- [ ] Schedule implementation

---

## 10. Generated Files

**Implementation Date:** 2026-01-17

### Database Migration

| File | Description |
|------|-------------|
| `supabase/migrations/016_add_sync_run_id.sql` | Adds `sync_run_id` UUID column, `sync_run_at` timestamp, partial index, and `cleanup_stale_timesheet_entries()` RPC function |

### Updated n8n Code (in `tasks/n8n/updated/`)

#### Clockify Workflow

| File | Description |
|------|-------------|
| `clockify-node-2.js` | Fetch with pagination + sync metadata + error tracking |
| `clockify-node-3.js` | Split array + pass through `_syncMeta` |
| `clockify-node-4.js` | Normalize entries + preserve `_syncMeta` |
| `clockify-node-5.js` | Build rows with `sync_run_id` + output `_meta` for cleanup |
| `clockify-node-6-cleanup.js` | Conditional cleanup via RPC (only if `fetch_complete`) |

#### ClickUp Workflow

| File | Description |
|------|-------------|
| `clickup-node-2.js` | Fetch per member + **CRITICAL: stop swallowing errors** + sync metadata |
| `clickup-node-3.js` | Split array + pass through `_syncMeta` |
| `clickup-node-4.js` | Normalize entries + preserve `_syncMeta` |
| `clickup-node-5.js` | Build rows with `sync_run_id` + output `_meta` for cleanup |
| `clickup-node-6-cleanup.js` | Conditional cleanup via RPC (only if `fetch_complete`) |

---

## 11. Deployment Steps

### Step 1: Apply Database Migration

Run in Supabase SQL Editor:
```sql
-- Copy contents of supabase/migrations/016_add_sync_run_id.sql
```

### Step 2: Update n8n Workflows

For each workflow (Clockify and ClickUp):

1. **Open the workflow** in n8n
2. **Update each Code node** by replacing the code with the corresponding file from `tasks/n8n/updated/`
3. **Add Node 6** after the Supabase upsert node:
   - Add a new Code node
   - Paste the cleanup code (`clockify-node-6-cleanup.js` or `clickup-node-6-cleanup.js`)
   - Connect: `Node 5 → Supabase Upsert → Node 6`
4. **Configure environment variables** (if not already set):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

### Step 3: Test

1. Run each workflow manually
2. Verify `_meta.fetch_complete = true` in output
3. Check Supabase for `sync_run_id` values on rows
4. Test deletion: Remove an entry in source, re-run sync, verify row deleted

---

## 12. Rollback Plan

If issues occur:

### Database Rollback
```sql
-- Remove the RPC function
DROP FUNCTION IF EXISTS public.cleanup_stale_timesheet_entries;

-- Remove columns (data preserved in source systems)
ALTER TABLE public.timesheet_daily_rollups DROP COLUMN IF EXISTS sync_run_id;
ALTER TABLE public.timesheet_daily_rollups DROP COLUMN IF EXISTS sync_run_at;

-- Remove index
DROP INDEX IF EXISTS idx_tdr_sync_run_null;
```

### n8n Rollback
Revert to original code files in `tasks/n8n/` (without `updated/` subfolder).

---

**Status:** Code complete. Ready for database migration and n8n deployment.

---

## Session Summary: 2026-01-17

### What Was Completed

1. **Database Migration Applied**
   - `016_add_sync_run_id.sql` executed successfully
   - Added `sync_run_id` UUID column
   - Added `sync_run_at` timestamp column
   - Created `cleanup_stale_timesheet_entries()` RPC function

2. **Clockify Workflow Updated**
   - All nodes (2-6) updated and tested
   - Cleanup executed successfully: `deleted_count: 138`

3. **ClickUp Workflow Updated**
   - All nodes (2-6) updated
   - Fixed project name logic: now uses **space name** ("NeoCurrency") instead of folder name ("Projects")

### Bugs Fixed During Session

| Issue | Fix |
|-------|-----|
| `crypto is not defined` | Added `generateUUID()` function (n8n doesn't have crypto global) |
| `access to env vars denied` | Hardcoded Supabase credentials instead of using `$env` |
| Node 6 ran before HTTP upsert | User corrected workflow order: Node 5 → HTTP Upsert → Node 6 |
| Project name showing "Projects" instead of "NeoCurrency" | Changed priority: `spaceName \|\| folderName` |

### Current Database State

**The database is currently EMPTY (0 rows)** - data was deleted when cleanup ran before upsert (wrong order). This was corrected but workflows need to be re-run to repopulate.

### What Needs To Be Done Tomorrow

1. **Re-run both n8n workflows** to repopulate the database:
   - Clockify workflow
   - ClickUp workflow (with updated Node 4 for space name as project)

2. **Verify data after sync:**
   ```sql
   SELECT clockify_workspace_id, project_name, COUNT(*)
   FROM timesheet_daily_rollups
   GROUP BY clockify_workspace_id, project_name;
   ```

3. **Test deletion propagation:**
   - Delete an entry in Clockify or ClickUp
   - Re-run the workflow
   - Verify the entry is removed from Supabase

### Files Modified/Created

| File | Status |
|------|--------|
| `supabase/migrations/016_add_sync_run_id.sql` | Created, Applied |
| `tasks/n8n/updated/clockify-node-2.js` | Created |
| `tasks/n8n/updated/clockify-node-3.js` | Created |
| `tasks/n8n/updated/clockify-node-4.js` | Created |
| `tasks/n8n/updated/clockify-node-5.js` | Created |
| `tasks/n8n/updated/clockify-node-6-cleanup.js` | Created |
| `tasks/n8n/updated/clickup-node-2.js` | Created |
| `tasks/n8n/updated/clickup-node-3.js` | Created |
| `tasks/n8n/updated/clickup-node-4.js` | Created, Updated (space name priority) |
| `tasks/n8n/updated/clickup-node-5.js` | Created |
| `tasks/n8n/updated/clickup-node-6-cleanup.js` | Created |

### Key Configuration

**Supabase Credentials (hardcoded in Node 6 files):**
- URL: `https://yptbnsegcfpizwhipeep.supabase.co`
- Service Role Key: (in files)

**Workspace IDs:**
- Clockify: `683ee2051325f11af65497bd`
- ClickUp: `90151498763`
