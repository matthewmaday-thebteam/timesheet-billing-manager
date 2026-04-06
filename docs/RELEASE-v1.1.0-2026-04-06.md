# Release Notes — v1.1.0 (April 5-6, 2026)

## Per-Entry Rounding & Billing Hierarchy

### Critical Bug Fix: Rounding Calculation

**Problem:** The billing engine rounded hours at the task-aggregate level — summing all entries for a task across all employees and days, then rounding once. The correct behavior is rounding each individual time entry before summing. This systematically underbilled clients.

**Example:** NeoCurrency weekly report showed 325.5 hours (per-task rounding) vs 334.5 hours (per-entry rounding) — a 9-hour / $477 difference for one client for one week.

**Fix:** Built a configurable rounding mode per project per month:
- `task` mode (legacy): rounds after aggregating by task — matches all historical invoices
- `entry` mode (new): rounds each individual time entry — correct going forward
- All projects default to `task`. April 2026 set to `entry` for all projects.

### Three-Layer Data Hierarchy

Built a hierarchy of truth for timesheet data:

| Layer | Table | Granularity |
|-------|-------|-------------|
| 1 | `timesheet_daily_rollups` | Per entry — `total_minutes`, `rounded_minutes`, `rounding_increment` |
| 2 | `employee_totals` | Per employee + project + task + day |
| 3 | `task_totals` | Per project + task + day |
| 3 | `employee_daily_totals` | Per employee + day |
| 3 | `task_monthly_totals` | Per project + task + month (3 rounding columns) |

All layers are populated automatically post-sync via `populate_rounded_minutes()`, `populate_layer2_totals()`, and `populate_task_monthly_totals()`.

### Page Migrations

| Page | Data Source | What Changed |
|------|-------------|-------------|
| **Dashboard** | Layer 2/3 | Total Hours, Utilization, Resources, Under Target, Pie Chart, Top 5, Daily Chart use rounded hours from Layer 2/3. Status + Revenue charts stay on billing engine. |
| **Burn** | Layer 3 | Daily grid and chart use `employee_daily_totals`. Rounded hours displayed. |
| **Employees** | Layer 2 | All hours from Layer 2. Revenue = rounded_hours × rate. Profit = revenue - (rounded_hours × employee_hourly_rate). No carryover contamination. |
| **Projects** | Layer 2 | All 5 tiers use Layer 2. Pure work performed — no billing adjustments. |
| **Revenue** | Billing engine | Now reads from `task_monthly_totals` with rounding mode switch. April+ uses per-entry rounding. |

### Billing Engine Changes

- `recalculate_project_month()` reads pre-computed values from `task_monthly_totals` instead of computing rounding inline
- Rounding mode setting on `project_monthly_rounding` table (accessible via Rate page toggle)
- Canonical project resolution for member projects when querying `task_monthly_totals`
- Canonical company_id trigger on `project_monthly_summary` prevents duplicate company rows
- Calculation version bumped to `v2.1-tmt-canonical`

### Revenue Page Improvements

- Added C/O (Carryover) column between Rounded and Adjusted
- Renamed Rounding column to INC
- Added date range to report headers
- Filtered out 0-hour tasks and 0-revenue projects
- "Other" segment in Hours by Resource pie chart now uses light grey

### Employee Management

- Hourly rate auto-calculated on save for FT/PT employees: `monthly_cost / expected_hours`
- Contractors/vendors enter hourly rate manually (unchanged)
- Backfilled 13 existing employees
- "Total Revenue" renamed to "Earned Revenue" in Employee Performance

### Diagnostics

Export buttons for data validation:
- Export Layer 1 (raw entries with rounding)
- Export Legacy Billing Summary
- Export Layer 2 - Employees
- Export Layer 3 - Tasks
- Export Layer 3 - Employee Daily Totals
- Export Task Monthly Totals

### Rate Page Fixes

- Fixed `get_all_project_rates_for_month()` WHERE clause — was excluding 31 of 54 projects (all "unassociated" standalone projects)
- Restored `existed_in_month` return column
- Restored correct column names (`source` not `rate_source`)
- Added rounding mode toggle (Task / Per Entry)

### Sync Changes

- Both sync functions call `populate_rounded_minutes()`, `populate_layer2_totals()`, and `populate_task_monthly_totals()` post-sync
- **Temporary:** Sync scope limited to first of current month (protects pre-April Layer data). Revert in May 2026.

### Migrations (086-099)

| # | Migration | Purpose |
|---|-----------|---------|
| 086 | `add_rounded_minutes` | Add `rounded_minutes` column to Layer 1 |
| 087 | `create_layer2_tables` | Create `employee_totals`, `task_totals` |
| 088 | `add_rounding_increment` | Add `rounding_increment` column to Layer 1 |
| 089 | `fix_canonical_project_rounding` | Fix canonical project resolution in `populate_rounded_minutes()` |
| 090 | `rebuild_layer2_create_layer3` | Rebuild Layer 2 (daily+task), create Layer 3 |
| 091 | `add_employee_daily_totals` | Add `employee_daily_totals` table |
| 092 | `backfill_hourly_rate` | Backfill employee hourly rates |
| 093 | `task_monthly_totals_and_rounding_mode` | Create `task_monthly_totals`, add `rounding_mode` setting |
| 094 | `billing_engine_use_task_monthly_totals` | Billing engine reads from `task_monthly_totals` |
| 095 | `fix_canonical_in_billing_engine` | Canonical project resolution in billing engine query |
| 096 | `fix_vpc_is_primary` | Fix `vpc.is_primary` → `vpc.role = 'primary'` |
| 097 | `fix_rates_page_project_filter` | Restore all projects on Rate page |
| 098 | `fix_rates_function_return_type` | Restore `existed_in_month` and correct column names |
| 099 | `fix_canonical_company_in_billing` | Canonical company_id trigger on `project_monthly_summary` |

### Known Issues

1. Edge function reports (weekly, customer, EOM) still use per-task-aggregate rounding — need to respect `rounding_mode` setting
2. Third Party Pet March hours: 264.50 (pre-change) vs 280.00 (current) — under investigation
3. Paideia February milestone not applying correctly — related to rate function fix
4. Sync scope revert needed in May 2026
