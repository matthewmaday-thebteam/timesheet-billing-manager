# Task 039: Customer Revenue Report Modal

## Status: PLANNED

## Problem
1. The "Customer Revenue Report" export has no modal — it exports immediately with all companies and all columns, no configuration options.
2. Task descriptions are missing from the report. `useSummaryBilling` sets `tasks: []` because `project_monthly_summary` doesn't store task-level breakdowns. The raw data exists in `timesheet_daily_rollups.task_name` but is aggregated away during `recalculate_project_month()`.

## Requirements
A modal for the Customer Revenue Report export with:

### Column Toggles (top row of checkboxes)
Optional columns that can be excluded from the generated CSV:
- **Task** — show/hide task-level rows entirely (task name + task hours)
- **Rate ($/hr)** — show/hide the rate column
- **Project Revenue** — show/hide the project-level revenue column
- **Company Revenue** — show/hide the company-level revenue column

When unchecked, the column is omitted from the CSV header AND all data rows.

### Company Filter (below column toggles)
- Select All / deselect all toggle (with indeterminate state)
- Checkbox per company with company name and revenue amount
- Alphabetically sorted
- All selected by default when modal opens
- Same pattern as existing "Export Revenue CSV" modal

### Fix Missing Task Descriptions
Task data must be hydrated from `timesheet_daily_rollups` since `project_monthly_summary` doesn't store it.

## Stack
- React (custom Modal component at `src/components/Modal.tsx`)
- Existing patterns from the "Export Revenue CSV" modal in `RevenuePage.tsx` (lines 410-475)
- Data: `useSummaryBilling` for project-level, new query for task-level

## Plan

### Step 1: Create a hook to fetch task-level breakdown
**New file:** `src/hooks/useTaskBreakdown.ts`

Query `timesheet_daily_rollups` grouped by project + task_name for the selected month. Must resolve member projects to their primary (same as billing pipeline).

```sql
SELECT
  COALESCE(pg.primary_project_id, p.id) AS canonical_project_id,
  p.project_id AS external_project_id,
  COALESCE(tdr.task_name, 'No Task') AS task_name,
  SUM(tdr.total_minutes)::INTEGER AS actual_minutes
FROM timesheet_daily_rollups tdr
JOIN projects p ON p.project_id = tdr.project_id
LEFT JOIN project_group_members pgm ON pgm.member_project_id = p.id
LEFT JOIN project_groups pg ON pg.id = pgm.group_id
WHERE DATE_TRUNC('month', tdr.work_date)::DATE = $1
  AND tdr.total_minutes > 0
GROUP BY canonical_project_id, p.project_id, COALESCE(tdr.task_name, 'No Task')
ORDER BY canonical_project_id, actual_minutes DESC
```

Return type: `Map<string, TaskBreakdownRow[]>` keyed by external_project_id of the canonical project.

Each `TaskBreakdownRow`: `{ taskName: string; actualMinutes: number; roundedMinutes: number; actualHours: number; roundedHours: number; baseRevenue: number }`

Rounding must be applied per-task using the project's rounding increment (from `useSummaryBilling`'s `rounding_used` field). Revenue = roundedHours * rate.

**Alternative (simpler):** Create a Supabase RPC function that does the grouping + rounding server-side, returning task rows ready to use. This avoids needing the rounding logic in the frontend hook.

### Step 2: Hydrate tasks into billing result
In `RevenuePage.tsx`, after `useSummaryBilling` returns `billingResult` and the task breakdown is loaded, merge task data into each project's `tasks` array. This fixes both:
- The Customer Revenue Report export (task rows)
- The RevenueTable UI (task expansion rows, which are also empty today)

```typescript
const hydratedBillingResult = useMemo(() => {
  if (!taskBreakdown || !billingResult) return billingResult;
  return {
    ...billingResult,
    companies: billingResult.companies.map(company => ({
      ...company,
      projects: company.projects.map(project => ({
        ...project,
        tasks: taskBreakdown.get(project.projectId) || [],
      })),
    })),
  };
}, [billingResult, taskBreakdown]);
```

### Step 3: Build the Customer Revenue Report modal
Replace the direct `handleExportCustomerRevenue` call with a modal.

**State additions to RevenuePage:**
```typescript
const [showCustomerReportModal, setShowCustomerReportModal] = useState(false);
const [customerReportCompanyIds, setCustomerReportCompanyIds] = useState<Set<string>>(new Set());
const [customerReportColumns, setCustomerReportColumns] = useState({
  tasks: true,
  rate: true,
  projectRevenue: true,
  companyRevenue: true,
});
```

**Modal layout:**
```
┌─────────────────────────────────────────┐
│ Customer Revenue Report          [X]    │
├─────────────────────────────────────────┤
│ February 2026                           │
│                                         │
│ Columns                                 │
│ ☑ Task    ☑ Rate    ☑ Proj Rev  ☑ Co Rev│
│                                         │
│ Companies                               │
│ ─────────────────────────────────────── │
│ ☑ Select All                            │
│ ☑ All Community Events        $250.00   │
│ ☑ Ample                     $2,962.50   │
│ ☑ FoodCycle Science         $14,235.00  │
│ ...                                     │
├─────────────────────────────────────────┤
│                     [Cancel]  [Export]   │
└─────────────────────────────────────────┘
```

### Step 4: Update CSV generation for column toggles
Modify `handleExportCustomerRevenue` (or extract to a utility function) to accept column visibility options. When a column is toggled off:
- Remove it from the header row
- Remove it from every data row
- If `tasks` is unchecked, skip task-level rows entirely (only show company + project rows)

### Step 5: Wire up the export button
Change the `exportOptions` entry for "Customer Revenue Report" from calling `handleExportCustomerRevenue` directly to opening the modal instead.

## Files to Modify
1. **`src/hooks/useTaskBreakdown.ts`** — NEW: fetch task-level data from timesheet_daily_rollups
2. **`src/components/pages/RevenuePage.tsx`** — Add modal, hydrate tasks, wire up export
3. **`src/utils/generateRevenueCSV.ts`** — Possibly extract Customer Revenue CSV logic here (or keep inline)

## Files NOT Modified
- `src/components/Modal.tsx` — reuse as-is
- `src/hooks/useSummaryBilling.ts` — unchanged (task hydration happens in RevenuePage)
- Database migrations — no schema changes needed (raw data already has task_name)

## Verification
- [ ] Modal opens when clicking "Customer Revenue Report"
- [ ] Column checkboxes toggle columns in exported CSV
- [ ] Unchecking "Task" removes all task-level rows from CSV
- [ ] Company filter works (select/deselect individual + select all)
- [ ] Task names appear in CSV (no longer empty)
- [ ] Task names appear in RevenueTable expandable rows
- [ ] Exported CSV totals match Revenue page header total
- [ ] `npx tsc --noEmit` passes
- [ ] Deploy via `npx vercel --prod`
