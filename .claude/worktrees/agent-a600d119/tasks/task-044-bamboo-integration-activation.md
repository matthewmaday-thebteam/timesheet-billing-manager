# Task 044: BambooHR Integration — Full Year Sync + Employee Visibility

## Status: Complete

## Stack
- n8n Code nodes (JavaScript)
- React (TypeScript)
- Tailwind CSS
- Supabase REST API
- BambooHR REST API

## Scope
Activate the BambooHR integration (schema from task-029) now that the API key is available. Create n8n Code node scripts for daily sync of employees + time-off requests, and add a UI panel to show BambooHR employees on the Employee Management page.

## Files Created
| File | Purpose |
|------|---------|
| `n8n/Scripts/bamboo-node-1-setup.js` | Date range — full calendar year (Jan 1 → Dec 31) |
| `n8n/Scripts/bamboo-node-2-fetch.js` | Fetch employee directory + time-off requests from BambooHR API |
| `n8n/Scripts/bamboo-node-3-upsert-employees.js` | Transform + upsert to `bamboo_employees` via Supabase REST |
| `n8n/Scripts/bamboo-node-4-upsert-timeoff.js` | Transform + upsert to `employee_time_off` via Supabase REST |
| `src/components/BambooEmployeePanel.tsx` | Panel showing BambooHR employees with brand color highlighting |

## Files Modified
| File | Change |
|------|--------|
| `src/components/pages/EmployeeManagementPage.tsx` | Import + render `BambooEmployeePanel` between Stats and ResourceTable |

## Steps
1. **bamboo-node-1-setup.js** — Outputs `rangeStartDate` / `rangeEndDate` for the full current calendar year (YYYY-MM-DD format)
2. **bamboo-node-2-fetch.js** — Two API calls with Basic Auth (API key as username, "x" as password):
   - Employee directory: `GET /employees/directory`
   - Time-off requests: `GET /time_off/requests?start={start}&end={end}`
   - Generates `sync_run_id` UUID and `_syncMeta` object
3. **bamboo-node-3-upsert-employees.js** — Transforms employee data, upserts to `bamboo_employees` via Supabase REST with `Prefer: resolution=merge-duplicates`, passes through full payload
4. **bamboo-node-4-upsert-timeoff.js** — Builds employee email lookup, transforms time-off data, upserts in batches of 500 to `employee_time_off`. Auto-linking trigger fires on insert/update
5. **BambooEmployeePanel.tsx** — Uses `useBambooEmployees()` hook. Shows linked/unlinked counts, employee name chips. Unlinked = brand color, linked = gray
6. **EmployeeManagementPage.tsx** — Added `<BambooEmployeePanel />` between Stats grid and Error/ResourceTable section

## n8n Workflow Wiring
```
[Schedule Trigger: Daily] → [Code: node-1] → [Code: node-2] → [Code: node-3] → [Code: node-4]
```

## Verification
- [ ] n8n node 1 outputs `{ rangeStartDate: "2026-01-01", rangeEndDate: "2026-12-31" }`
- [ ] n8n node 2 fetches employees + time-off from BambooHR
- [ ] `SELECT count(*) FROM bamboo_employees` shows expected employee count after sync
- [ ] `SELECT count(*) FROM employee_time_off` shows time-off records for the year
- [ ] Auto-linking trigger fires: `SELECT * FROM employee_time_off WHERE resource_id IS NOT NULL`
- [ ] BambooEmployeePanel renders on EmployeeManagementPage
- [ ] Unlinked employees show in brand color (`text-bteam-brand`)
- [ ] Linked employees show in standard gray
- [ ] Header shows linked/unlinked counts
- [ ] Existing EmployeeEditorModal BambooHR dropdown still works
- [ ] HolidaysPage EmployeeTimeOffList shows synced time-off
- [ ] `npx tsc --noEmit` passes
