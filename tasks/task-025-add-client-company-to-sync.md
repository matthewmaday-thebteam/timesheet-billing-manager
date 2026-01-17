# Task 025: Add Client/Company Data to Timesheet Sync

**Status:** READY FOR EXECUTION

## 1. Problem Statement

The current data model supports **Project => Employee => Task** correlation but is missing the **Company** level. This prevents billing analysis by client/company.

The Clockify API already returns `clientId` and `clientName` in time entries, but this data is currently being dropped during the n8n sync process.

**Goal:** Enable the full hierarchy: **Company => Project => Employee => Task**

## 2. Current State Analysis

### What Clockify Returns
The detailed report API returns these fields per time entry:
- `clientId` - Unique identifier for the client
- `clientName` - Human-readable client name

### Where Data Gets Dropped
| n8n Node | Status |
|----------|--------|
| Node 2 (Fetch) | Clockify API returns client data |
| Node 3 (Expand) | Data passed through |
| Node 4 (Normalize) | **Extracts** `client_id` and `client_name` |
| Node 5 (Build Rows) | **DROPS** client fields - not included in Supabase rows |

### Supabase Schema Gap
`timesheet_daily_rollups` table is missing:
- `client_id TEXT`
- `client_name TEXT`

## 3. Prerequisites (Clockify Setup)

For client data to be available, the Clockify workspace must have:
1. Clients created (Settings > Clients)
2. Projects assigned to clients

**Action Required:** Verify Clockify has clients configured and projects are linked to clients.

## 4. Implementation Plan

### Phase 1: Database Migration
- [ ] Create migration `017_add_client_columns.sql`
- [ ] Add `client_id TEXT` column
- [ ] Add `client_name TEXT` column
- [ ] Add index on `client_id` for query performance
- [ ] Run migration on Supabase

### Phase 2: n8n Workflow Update
- [ ] Update Node 5 (`clockify-node-5.js`) to include `client_id` and `client_name` in rows
- [ ] Test sync with updated workflow
- [ ] Verify client data appears in Supabase

### Phase 3: Optional - Companies Table
Consider creating a `companies` lookup table:
- [ ] Evaluate if a separate `companies` table is needed
- [ ] If yes, create migration for `companies` table
- [ ] Add trigger to auto-populate from `client_id`/`client_name`

## 5. Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/017_add_client_columns.sql` | **CREATE** - Add client columns |
| `tasks/n8n/updated/clockify-node-5.js` | **MODIFY** - Include client fields in row output |

## 6. Migration SQL (Draft)

```sql
-- 017_add_client_columns.sql
-- Add client/company columns to support Company => Project hierarchy

BEGIN;

-- Add client columns
ALTER TABLE timesheet_daily_rollups
ADD COLUMN IF NOT EXISTS client_id TEXT,
ADD COLUMN IF NOT EXISTS client_name TEXT;

-- Index for client-based queries
CREATE INDEX IF NOT EXISTS idx_tdr_client_id
ON timesheet_daily_rollups (client_id)
WHERE client_id IS NOT NULL;

-- Optional: Index for client name searches
CREATE INDEX IF NOT EXISTS idx_tdr_client_name
ON timesheet_daily_rollups (client_name)
WHERE client_name IS NOT NULL;

COMMIT;
```

## 7. n8n Node 5 Changes (Draft)

Add to the `rows.push()` object:
```javascript
// Client/Company association
client_id: e.client_id ?? null,
client_name: e.client_name || null,
```

## 8. Verification Steps

- [ ] Run Clockify sync after changes
- [ ] Query Supabase to confirm `client_id` and `client_name` are populated
- [ ] Verify data for projects that have clients assigned
- [ ] Confirm null values for projects without clients (expected)

## 9. Rollback Plan

```sql
-- Rollback if needed
ALTER TABLE timesheet_daily_rollups
DROP COLUMN IF EXISTS client_id,
DROP COLUMN IF EXISTS client_name;

DROP INDEX IF EXISTS idx_tdr_client_id;
DROP INDEX IF EXISTS idx_tdr_client_name;
```

---

## AWAITING APPROVAL

Please confirm:
1. Should I proceed with the database migration?
2. Should I update the n8n Node 5 code?
3. Do you want a separate `companies` lookup table, or is denormalized `client_id`/`client_name` sufficient?

---

## Implementation Notes

**Planning Date:** 2026-01-17

### Files Created/Modified

| File | Action |
|------|--------|
| `supabase/migrations/017_add_client_columns.sql` | CREATED - adds client_id and client_name columns |
| `tasks/n8n/updated/clockify-node-5.js` | MODIFIED - added client_id, client_name to rows.push() |
| `tasks/n8n/updated/clickup-node-5.js` | MODIFIED - added client_id, client_name (from space) to rows.push() |

### Next Steps (Manual)
1. Run migration `017_add_client_columns.sql` in Supabase SQL Editor
2. Copy updated node code to n8n workflows
3. Test Clockify sync
4. Test ClickUp sync
5. Verify with query:
```sql
SELECT DISTINCT client_id, client_name, clockify_workspace_id
FROM timesheet_daily_rollups
WHERE client_id IS NOT NULL
ORDER BY client_name;
```

