# Task 048: Monday Morning Neocurrency Report

## Status: Pending

## Problem

Every Monday morning, the same manual process is performed:

1. Open Revenue page
2. Click Export → Customer Revenue Report
3. Leave all Include Columns selected (Tasks, Rate, Project Revenue, Company Revenue)
4. Filter to Neocurrency only
5. Download CSV
6. Email the CSV to Stanimir Dimitrov (Neocurrency project manager)

This should be automated. It also establishes the email infrastructure needed for future AI-driven employee notifications (Task 049).

---

## Solution

A Supabase Edge Function that produces the same report data the frontend generates, called by an n8n workflow every Monday at 7:00 AM Bulgaria time (Europe/Sofia), which formats the CSV and emails it to Stanimir.

### Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌────────────┐
│ Cron Trigger │────▶│ Supabase Edge    │────▶│ Build CSV   │────▶│ Send Email │
│ Mon 7:00 AM  │     │ Function         │     │ (Code node) │     │ w/ attach  │
│ Europe/Sofia │     │ (report JSON)    │     │             │     │            │
└──────────────┘     └──────────────────┘     └─────────────┘     └────────────┘
```

### Why an Edge Function

The frontend CSV export (`RevenuePage.tsx` lines 440–637) combines data from three sources — `useSummaryBilling`, `useTaskBreakdown`, and `useBillings` — then applies rounding, milestone overrides, and fixed-billing adjustments. Rather than duplicating all of this in n8n Code nodes, a single Edge Function encapsulates the business logic and returns structured JSON. The n8n workflow stays simple: fetch, format, send.

---

## Step 1: Supabase Edge Function

**New file:** `supabase/functions/customer-revenue-report/index.ts`

### Request

```
POST /functions/v1/customer-revenue-report
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json

{
  "companyName": "Neocurrency",
  "month": "2026-02-01"
}
```

### Response

```json
{
  "monthLabel": "February 2026",
  "companyName": "Neocurrency",
  "company": {
    "companyName": "Neocurrency",
    "companyHours": "142.50",
    "companyRevenue": "$14,250.00",
    "projects": [
      {
        "projectName": "Admin Portal",
        "rate": "100.00",
        "projectHours": "42.50",
        "projectRevenue": "$4,250.00",
        "tasks": [
          { "taskName": "Feature development", "hours": "22.25" },
          { "taskName": "Code review", "hours": "12.75" },
          { "taskName": "Bug fixes", "hours": "7.50" }
        ]
      },
      {
        "projectName": "Client Platform",
        "rate": "100.00",
        "projectHours": "100.00",
        "projectRevenue": "$10,000.00",
        "tasks": [
          { "taskName": "Setup meetings", "hours": "55.00" },
          { "taskName": "Documentation", "hours": "45.00" }
        ]
      }
    ]
  },
  "grandTotalHours": "142.50",
  "grandTotalRevenue": "$14,250.00"
}
```

### Internal Logic

The edge function must replicate the monthly-mode export path from `RevenuePage.tsx` (lines 543–628). This involves three data sources and several calculation steps.

#### 1. Identify the company

```sql
SELECT id, client_id, client_name, display_name
FROM companies
WHERE client_name = :companyName;
```

#### 2. Get project-level billing summary

Query `v_canonical_project_monthly_summary` (same view as `useSummaryBilling`):

```sql
SELECT
  pms.project_id,
  pms.project_name,
  pms.company_id,
  pms.billed_hours,
  pms.billed_revenue,
  pms.rounding_used,
  pms.rate,
  p.project_id AS external_project_id
FROM v_canonical_project_monthly_summary pms
JOIN projects p ON p.id = pms.project_id
WHERE pms.summary_month = :month
  AND pms.company_id = :companyId;
```

Key fields: `project_id`, `project_name`, `billed_hours`, `billed_revenue`, `rate`, `rounding_used`, `external_project_id`

#### 3. Get task-level breakdown

Query `timesheet_daily_rollups` with project group resolution (same logic as `useTaskBreakdown`):

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
WHERE tdr.work_date >= :monthStart
  AND tdr.work_date < :monthEnd
  AND tdr.total_minutes > 0
GROUP BY canonical_project_id, p.project_id,
         COALESCE(tdr.task_name, 'No Task')
ORDER BY canonical_project_id, actual_minutes DESC;
```

#### 4. Get milestone overrides (fixed billings)

Query the billings system for projects with milestone-based billing that override the hourly calculation:

```sql
-- Get milestone billing overrides per project for this month
SELECT
  bt.external_project_id,
  SUM(bt.amount_cents) AS total_cents
FROM billing_transactions bt
JOIN billings b ON b.id = bt.billing_id
WHERE bt.month = :month
  AND b.company_client_id = :companyClientId
  AND bt.external_project_id IS NOT NULL
GROUP BY bt.external_project_id;
```

Also get company-level fixed billings (not tied to a specific project):

```sql
-- Get company-level fixed billings
SELECT SUM(bt.amount_cents) AS total_cents
FROM billing_transactions bt
JOIN billings b ON b.id = bt.billing_id
WHERE bt.month = :month
  AND b.company_client_id = :companyClientId
  AND bt.external_project_id IS NULL;
```

#### 5. Apply rounding per task

```typescript
function applyRounding(minutes: number, increment: number): number {
  if (increment === 0) return minutes;
  return Math.ceil(minutes / increment) * increment;
}

// Per task:
const roundedMinutes = applyRounding(actualMinutes, project.rounding_used);
const roundedHours = Math.round((roundedMinutes / 60) * 100) / 100;
```

#### 6. Compute project revenue

For each project, check if a milestone override exists:

```typescript
// If milestone override exists for this project, use it
const projectRevenue = milestoneOverride
  ? milestoneOverride.totalCents / 100
  : project.billedRevenue;  // from v_canonical_project_monthly_summary
```

#### 7. Compute company revenue

```typescript
// Company total = sum of project billedRevenue + company-level fixed billings + milestone adjustments
const milestoneAdj = projects.reduce((sum, p) => {
  const milestone = milestoneByExternalProjectId.get(p.externalProjectId);
  if (milestone) return sum + (milestone.totalCents / 100) - p.billedRevenue;
  return sum;
}, 0);

const companyTotalRevenue = company.billedRevenue + (companyBillingCents / 100) + milestoneAdj;
```

#### 8. Format currency

```typescript
function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
```

#### 9. Sort and return

- Projects: alphabetically by name
- Tasks within each project: by rounded hours descending
- Return structured JSON (n8n handles CSV formatting and email)

### Edge Function Template

Follow the pattern in `supabase/functions/admin-users/index.ts`:
- Deno `serve()` entrypoint
- CORS headers for preflight
- Service role key auth (n8n passes `Authorization: Bearer <service_role_key>`)
- Service role Supabase client for RLS bypass
- Error handling with appropriate HTTP status codes

**Authentication note:** Unlike `admin-users` which validates a user JWT and checks admin role, this function is called by n8n (server-to-server) so it should validate that the provided bearer token matches the service role key directly, rather than going through user auth.

---

## Step 2: n8n Workflow

### Node 1: Schedule Trigger

- **Type:** Schedule Trigger
- **Rule:** Every Monday at 7:00 AM
- **Timezone:** Europe/Sofia (EET UTC+2 / EEST UTC+3)

### Node 2: Compute Current Month

- **Type:** Code
- **Purpose:** Calculate which month to report on.

```javascript
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const monthStart = `${year}-${month}-01`;

const monthNames = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
const monthLabel = `${monthNames[now.getMonth()]} ${year}`;

return [{
  json: {
    month: monthStart,
    monthLabel: monthLabel,
  }
}];
```

### Node 3: Call Edge Function

- **Type:** HTTP Request
- **Method:** POST
- **URL:** `https://yptbnsegcfpizwhipeep.supabase.co/functions/v1/customer-revenue-report`
- **Headers:**
  - `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  - `Content-Type: application/json`
- **Body:**
  ```json
  {
    "companyName": "Neocurrency",
    "month": "{{ $json.month }}"
  }
  ```

### Node 4: Build CSV

- **Type:** Code
- **Purpose:** Format the JSON response into the exact CSV the manual export produces (all columns).

```javascript
const data = $input.first().json;
const company = data.company;
const monthLabel = data.monthLabel;

const BOM = '\uFEFF';
const header = ['Company', 'Project', 'Task', 'Hours', 'Rate ($/hr)',
                'Project Hours', 'Project Revenue', 'Company Hours', 'Company Revenue'];

const csvRows = [];

// Title row
csvRows.push([`Customer Revenue Report - ${monthLabel}`]);

// Header row
csvRows.push(header);

// Helper
const emptyRow = () => header.map(() => '');

// Company summary row
const companyRow = emptyRow();
companyRow[0] = company.companyName;
companyRow[7] = company.companyHours;      // Company Hours
companyRow[8] = company.companyRevenue;     // Company Revenue
csvRows.push(companyRow);

// Projects (already sorted alphabetically by edge function)
for (const project of company.projects) {
  // Project summary row
  const projectRow = emptyRow();
  projectRow[0] = company.companyName;
  projectRow[1] = project.projectName;
  projectRow[4] = project.rate;              // Rate ($/hr)
  projectRow[5] = project.projectHours;      // Project Hours
  projectRow[6] = project.projectRevenue;    // Project Revenue
  csvRows.push(projectRow);

  // Task rows (already sorted by hours desc by edge function)
  for (const task of project.tasks) {
    const taskRow = emptyRow();
    taskRow[0] = company.companyName;
    taskRow[1] = project.projectName;
    taskRow[2] = task.taskName;              // Task
    taskRow[3] = task.hours;                 // Hours
    taskRow[4] = project.rate;               // Rate ($/hr)
    csvRows.push(taskRow);
  }
}

// Empty separator
csvRows.push(emptyRow());

// Total row
const totalRow = emptyRow();
totalRow[0] = 'TOTAL';
totalRow[7] = data.grandTotalHours;          // Company Hours
totalRow[8] = data.grandTotalRevenue;        // Company Revenue
csvRows.push(totalRow);

// Convert to quoted CSV
const csvContent = BOM + csvRows
  .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  .join('\n');

const filename = `customer-revenue-neocurrency-${data.month || ''}.csv`;

return [{
  json: {
    csvContent,
    filename,
    monthLabel,
  }
}];
```

### Node 5: Send Email

- **Type:** Send Email (SMTP) or Gmail/Outlook node
- **To:** `sdimitrov@yourbteam.com`
- **Subject:** `Neocurrency Revenue Report - {{ $json.monthLabel }}`
- **Body:**
  ```
  Hi Stanimir,

  Attached is the Neocurrency customer revenue report for {{ $json.monthLabel }}.

  This is an automated report generated every Monday morning.

  Best,
  The B Team
  ```
- **Attachments:** CSV content from Node 4, saved as `{{ $json.filename }}`

### Email Configuration

n8n supports multiple email methods. Use whichever matches the current business email setup:
- **SMTP credentials** (generic, works with any provider)
- **Gmail node** (OAuth2, if using Google Workspace)
- **Microsoft Outlook node** (OAuth2, if using Microsoft 365)

---

## Step 3: Deploy Edge Function

```bash
cd supabase
supabase functions deploy customer-revenue-report
```

Set any required secrets:
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>
```

---

## CSV Output Format

Full Customer Revenue Report for Neocurrency with all columns:

```csv
"Customer Revenue Report - February 2026"
"Company","Project","Task","Hours","Rate ($/hr)","Project Hours","Project Revenue","Company Hours","Company Revenue"
"Neocurrency","","","","","","","142.50","$14,250.00"
"Neocurrency","Admin Portal","","","100.00","42.50","$4,250.00","",""
"Neocurrency","Admin Portal","Feature development","22.25","100.00","","","",""
"Neocurrency","Admin Portal","Code review","12.75","100.00","","","",""
"Neocurrency","Admin Portal","Bug fixes","7.50","100.00","","","",""
"Neocurrency","Client Platform","","","100.00","100.00","$10,000.00","",""
"Neocurrency","Client Platform","Setup meetings","55.00","100.00","","","",""
"Neocurrency","Client Platform","Documentation","45.00","100.00","","","",""
"","","","","","","","",""
"TOTAL","","","","","","","142.50","$14,250.00"
```

**Row types:**
- Row 1: Title
- Row 2: Header
- Row 3: Company summary (company name + Company Hours + Company Revenue)
- Rows 4+: Project summary (company, project, rate, project hours, project revenue)
- Rows 5+: Task detail (company, project, task name, task hours, rate)
- Separator: empty row after last project
- Final row: TOTAL with grand total hours and revenue

**Sorting:** Projects alphabetically, tasks by rounded hours descending within project.

**Hours:** Rounded per project's `rounding_used` (0/5/15/30 minute increments), displayed to 2 decimal places.

**Revenue:** Project revenue uses milestone override when present, otherwise `billedRevenue` from summary table. Company revenue includes hourly billings + fixed company billings + milestone adjustments.

**Encoding:** UTF-8 with BOM (`\uFEFF`) for Excel compatibility.

---

## Files to Create

| File | Description |
|------|-------------|
| `supabase/functions/customer-revenue-report/index.ts` | Edge function: queries billing data, applies rounding/milestones, returns structured JSON |

## Files NOT Modified

- `src/components/pages/RevenuePage.tsx` — manual export unchanged
- `src/hooks/useTaskBreakdown.ts` — edge function queries the same tables directly
- `src/hooks/useSummaryBilling.ts` — unchanged
- No database migrations needed (all views and tables already exist)

---

## Configuration Required

| Item | Where | Value |
|------|-------|-------|
| Schedule | n8n Cron Trigger | Monday 7:00 AM Europe/Sofia |
| Supabase URL | n8n HTTP Request | `https://yptbnsegcfpizwhipeep.supabase.co` |
| Supabase Service Role Key | n8n credentials | (existing key) |
| Recipient Email | n8n Email node | `sdimitrov@yourbteam.com` |
| Recipient Name | n8n Email body | Stanimir Dimitrov |
| Sender Email | n8n SMTP/Gmail config | (business email) |
| Company Name | n8n HTTP Request body | `Neocurrency` |

---

## Verification

- [ ] Edge function deployed and responds to POST with correct JSON
- [ ] CSV output matches manual export — same columns, same values, same sort order
- [ ] Rounding matches: compare a few task hours against manual export
- [ ] Project revenue uses milestone overrides where applicable
- [ ] Company revenue includes fixed billings and milestone adjustments
- [ ] Email arrives Monday morning at 7 AM Bulgaria time
- [ ] Email sent to `sdimitrov@yourbteam.com` with correct subject and attachment
- [ ] CSV opens correctly in Excel (BOM encoding, no garbled characters)
- [ ] Filename follows pattern: `customer-revenue-neocurrency-YYYY-MM.csv`

### Spot-Check Procedure

1. Manually export the Customer Revenue Report from Revenue page (all columns, Neocurrency only)
2. Trigger the n8n workflow manually
3. Compare the two CSVs — values should be identical

---

## Future: Foundation for AI Agent

This workflow establishes the infrastructure for the AI-driven under-hours conversation feature (Task 049):

| Component | This task | AI agent (Task 049) |
|---|---|---|
| n8n scheduled trigger | Monday weekly | Daily morning |
| Supabase edge function | Revenue report | Under-hours detection |
| Email sending from n8n | CSV attachment to PM | Outreach message to employee |
| **Inbound email parsing** | Not needed | n8n Email Trigger node |
| **Anthropic API call** | Not needed | Classification Code node |
| **Routing logic** | Not needed | Branch node (sick/no work/forgot) |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Revenue mismatch vs. manual export (rounding, milestones, fixed billings) | MEDIUM | HIGH | Edge function replicates exact frontend logic; spot-check procedure catches discrepancies |
| n8n server timezone misconfiguration | LOW | LOW | Explicitly set Europe/Sofia; Monday timing isn't minute-critical |
| Edge function cold start delay | LOW | LOW | Report isn't time-sensitive; 1-2s cold start is fine |
| Empty data (sync gap) | LOW | MEDIUM | Workflow checks for empty response and skips email |
| Milestone/billing tables not populated for current month | LOW | MEDIUM | Edge function falls back to hourly calculation when no milestone override exists (same as frontend) |
