export interface ReleaseNote {
  version: string     // e.g., '1.0.0.99'
  date: string        // 'YYYY-MM-DD'
  title: string       // Short headline
  highlights: string[] // Bullet points of changes
}

/** Base build number: first release note = 1.0.0.97 */
const BASE_BUILD = 97;

export const releaseNotes: ReleaseNote[] = [
  {
    version: '',  // computed below
    date: '2026-06-04',
    title: 'QuickBooks Invoice Fix & Always-On SLA/Milestone Revenue',
    highlights: [
      'Fixed: QuickBooks invoices now send for customers with very large task lists. When a project\'s task breakdown exceeded QuickBooks’ 4,000-character description limit, the invoice was rejected (first hit by Neocurrency at 4,968 characters). The breakdown is now safely summarized with a "…(+N more tasks, X.X hrs)" line so the invoice always sends. Billed amounts, quantities, and rates are unchanged.',
      'Fixed: fixed-rate / minimum-hours (SLA) projects now show their committed monthly revenue on reports and invoices even in months with zero logged hours. Previously a zero-activity month produced no revenue row, so the monthly amount silently disappeared (surfaced on a $9,600/mo SLA).',
      'Added: automatic month-start materialization of SLA/floor revenue so a future zero-activity month can never silently drop the committed amount again.',
      'Fixed: recovered a recorded milestone payment that was missing from a current-month total — a $7,500 June milestone that had not been applied to the monthly summary.',
      'Internal: began foundational work to resolve revenue at read time so contractual revenue (floor, fixed, and milestone) is always represented consistently across every screen and report. This groundwork is not yet active in the UI — no user-facing display changed in this release.',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-05-06',
    title: 'Revenue Report Task Row Math Fix',
    highlights: [
      'Fixed: on the Revenue page, Detailed Revenue CSV, Customer Revenue Report, and End-of-Month CSV exports, the task rows now sum exactly to the project total. The project total used per-entry rounding while the task rows were using a legacy task-aggregate method, which caused the breakdown to under-state hours whenever a task had multiple time entries.',
      'No client invoice amounts were affected — already-sent invoices remain correct. The fix changes how task hours display beneath the project total, not the billable totals themselves.',
      'Future QBO invoices: task-line descriptions now sum cleanly to the line amount header.',
      'Backfilled all 56 stored End-of-Month CSVs for January through April 2026 so historical exports are consistent with the new behavior.',
      'Repaired two stale project_monthly_summary rows surfaced by the new integrity check: Paideia SLA February 2026 (under-recorded by 15 minutes / $12.50) and a phantom True Productions April 2026 row that had 7 hours stored but no underlying time entries.',
      'Added internal integrity assertion to all three billing edge functions — task-row rounded minutes must equal the project total or the function fails loudly. Future drift will surface immediately instead of silently shipping inconsistent numbers.',
      'Added explicit pagination on task_monthly_totals reads in edge functions (defense in depth against PostgREST row caps).',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-04-09',
    title: 'Rate Table Guardrails & Audit Trail',
    highlights: [
      'Fixed critical bug: projects without explicit rates were showing $0/hr instead of the $45 default due to a regression in migrations 096-098.',
      'Restored 4-state rate source tracking (explicit/inherited/backfill/default) that was collapsed to 2-state, breaking the ability to distinguish inherited rates.',
      'Added audit trigger on project_monthly_rates table — was the only billing table missing audit coverage. All rate INSERT/UPDATE/DELETE now logged.',
      'Rate table now shows Inherited/Backfill/Default badges next to rates so users can see which values are explicitly set vs auto-populated.',
      'New $0 rate warning: saving a $0 rate requires explicit checkbox acknowledgment and warns about inheritance to future months.',
      'New confirmation dialog: all rate changes now show a field-by-field old → new comparison before saving.',
      'Employees page now sorted by profit generated (highest first) instead of hours worked.',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-04-06',
    title: 'Per-Entry Rounding & Billing Data Hierarchy',
    highlights: [
      'Critical fix: billing engine was rounding per-task-aggregate instead of per-entry, systematically underbilling clients. New configurable rounding mode (task vs entry) per project per month via Rate page.',
      'Built 3-layer data hierarchy: Layer 1 (raw entries with rounding), Layer 2 (employee+task+day), Layer 3 (task+day, employee daily, task monthly with actual/entry-rounded/task-rounded columns).',
      'Dashboard, Burn, Employees, and Projects pages now use Layer 2/3 rounded hours — no carryover contamination in work-performed views.',
      'Employees page: revenue = rounded hours x project rate, profit = revenue - (rounded hours x employee hourly rate). Renamed "Total Revenue" to "Earned Revenue".',
      'Employee hourly rate auto-calculated on save for FT/PT (monthly cost / expected hours). Contractors enter manually.',
      'Revenue page: added C/O (Carryover) column, renamed Rounding to INC, added date range to report headers, filtered out 0-hour tasks and 0-revenue projects.',
      'Billing engine reads from task_monthly_totals with rounding mode switch. April 2026 set to per-entry rounding for all projects.',
      'Canonical company resolution trigger on project_monthly_summary prevents duplicate company rows across sync sources.',
      'Rate page: fixed project filter that was excluding 31 of 54 projects, restored existed_in_month indicator, added rounding mode toggle.',
      'Diagnostics page: export buttons for Layer 1, Layer 2 Employees, Layer 3 Tasks, Layer 3 Employee Daily Totals, Task Monthly Totals, and Legacy Billing Summary.',
      'Sync scope temporarily limited to first of current month to protect pre-April Layer data (revert in May).',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-04-04',
    title: 'ClickUp Sync Migration & Revenue Trend Fix',
    highlights: [
      'Migrated ClickUp sync from n8n to Supabase Edge Function: multi-step API fetch (team → spaces → folders → per-member time entries), single-pass transform, batch upsert, hourly cron at :30',
      'ClickUp sync includes all Clockify guardrails: fetchComplete tracking, conditional cleanup, 4 reconciliation alert types (sync_incomplete, zero_entries, high_deletion_count, hours_mismatch), and sync_runs diagnostics',
      'Diagnostics page now shows ClickUp sync runs alongside BambooHR and Clockify',
      'Dropped legacy clickup_time_entries table (deny-all RLS, unused since migration to timesheet_daily_rollups)',
      'Removed old sync-bamboohr Edge Function directory (superseded by sync-bamboohr-timeoff)',
      'All 3 n8n workflows now replaced by Supabase Edge Functions — n8n decommission ready',
      'Investor Dashboard: replaced custom MonthPicker with standard RangeSelector molecule used by all other pages',
      '12-Month Revenue Trend chart: optimistic/pessimistic bands now use +/- 15% of projected Total Revenue YTD (workday-based formula with vacation deductions), shared across Dashboard and Investor page',
      'Revenue trend bands fan from last actual cumulative revenue to year-end projected values instead of evenly proportioning',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-04-04',
    title: 'Clockify Sync Migration & Sync Diagnostics',
    highlights: [
      'Migrated Clockify sync from n8n to Supabase Edge Function: paginated fetch, single-pass transform, batch upsert, stale entry cleanup, and billing recalculation — all in one function running hourly via pg_cron',
      'Clockify hours reconciliation: compares per-user minutes from Clockify API against Manifest after every sync, with mismatch alerts on the dashboard',
      'New Diagnostics page: shows last 60 sync runs across all integrations (Clockify, BambooHR) with entry counts, source/manifest hours, deleted count, and error details',
      'Hours comparison uses actual DB values vs source data — mismatches are highlighted in warning on the Diagnostics table',
      'Sync alerts banner renamed from "BambooHR Sync Alerts" to generic "Sync Alerts" covering all integrations',
      'All sync functions now persist run results to sync_runs table for full audit trail',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-04-04',
    title: 'BambooHR Sync Migration & Reconciliation Alerts',
    highlights: [
      'Migrated BambooHR sync from n8n to Supabase Edge Functions: employee directory syncs daily, time-off syncs every 2 hours via pg_cron',
      'New reconciliation alerts: detects time-off day mismatches between BambooHR and Manifest, and flags unmatched resources on the dashboard',
      'Alerts are group-aware (respects physical person groups) and employment-type-aware (excludes contractors, vendors, and extended leave)',
      'Dashboard alert banners with dismiss functionality and red nav badge showing active alert count',
      'Alerts auto-resolve when discrepancies are fixed on the next sync cycle',
      'New "Extended Leave" employment type for employees on long-term leave: excluded from utilization, expected hours, and BambooHR linking',
      'Employee Editor now allows saving Extended Leave resources with 0 expected hours',
      'Added Profit column to Employee Performance table across all 4 tiers (employee, company, project, task) with CSV export',
      'Paginated data fetching across timesheet queries and revenue report Edge Functions to guarantee complete results',
      'Fixed date range queries to use interval overlap logic, resolving false mismatches for cross-year time-off records',
      'Removed legacy test accounts (John Smith, Kalin Test, Jane Doe) from BambooHR employees',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-04-03',
    title: 'Investor Dashboard Projection Fixes',
    highlights: [
      'Fixed Avg Daily Revenue: now averages actual per-day revenue values instead of dividing monthly total by workdays — excludes today (partial day)',
      'Fixed Projected Monthly Revenue: MTD + (avg daily × remaining workdays) instead of inflated RPC calculation',
      'Fixed Projected YTD: YTD + (avg daily × remaining year workdays) − scheduled vacation deductions for full-time (8 hrs) and part-time (5 hrs) employees',
      'Fixed Projected Quarterly Revenue: same formula scoped to the current quarter instead of multiplying one month\'s projection by 3',
      'Added rest-of-year time off fetch to power vacation-adjusted projections',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-04-02',
    title: 'QuickBooks Invoice Generation & EOM Report Scheduling',
    highlights: [
      'New "Send to QB" on EOM Reports: create QuickBooks invoices directly from monthly billing data with one click',
      'Invoices include per-project task breakdown with hours, Net 10 payment terms, wire transfer details, and customer email',
      'Product/Service mapping: hourly projects use "Time and Materials", milestones use "Fixed Bid Development"',
      'Duplicate prevention: each company-month can only have one invoice, with clear Sent/Error/Retry status indicators',
      '"Send All to QB" batch action with sequential sending and real-time progress ("Sending 3 of 7...")',
      'EOM report generation moved from the 5th to the 1st of each month with automated pg_cron scheduling',
      'QBO customer dropdown now shows all customers (was limited to first 100) and spans full modal width',
      'Zero-revenue companies (e.g. internal, unassigned) are now hidden from EOM Reports',
      'QuickBooks integration upgraded to production credentials with automatic fallback',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-03-31',
    title: 'Investor Dashboard: Month Selector & Daily Revenue Chart',
    highlights: [
      'Added month selector to scope all Investor Dashboard data to any month, not just the current one',
      'Past months show final totals — "Projected" values and "MTD" labels are hidden for completed months',
      'New Daily Revenue bar chart shows per-day revenue breakdown for the selected month',
      'Chart displays overlapping Billed (solid) and Earned (semi-transparent) bars to visualize billing cap impact',
      'Extended BarChartAtom with yAxisFormatter and fillColor props for currency display',
    ],
  },
  {
    version: '',  // computed below
    date: '2026-03-30',
    title: 'Weekly Status Reports & Automated Email Delivery',
    highlights: [
      'New Weekly Status view on the Reports page — browse weekly revenue reports by Year > Month > Week > Company',
      'Automated Monday email delivery: weekly CSV reports sent to project managers via SendGrid for projects with "Send Weekly Report" enabled',
      'Manual resend and on-demand download for any company-week from the Weekly Status view',
      'Reports now match the exact 9-column format from the Revenue export (includes Rate, Project Revenue, Company Revenue)',
      'Replaced n8n-based report automation with built-in edge function and pg_cron scheduling',
      'Renamed "EOM Reports" to "Reports" with End of Month and Weekly Status toggle',
    ],
  },
  {
    version: '',
    date: '2026-03-05',
    title: 'Security Hardening & Employee Fixes',
    highlights: [
      'Added "Send Weekly Reports" toggle to Edit Project modal',
      'Added filtering by Manager, Company, and Report status on Project Management page',
      'Fixed employee names not displaying when auto-created from timesheet data',
      'Fixed billing summaries not updating when company groups change',
      'Hardened database security: admin-only writes on financial tables, RLS on core tables, JWT verification on Edge Functions',
    ],
  },
  {
    version: '',
    date: '2026-03-04',
    title: 'BambooHR Time-Off Sync Fix',
    highlights: [
      'Fixed cancelled vacation days still appearing in Manifest',
      'Fixed approved vacation days not syncing from BambooHR',
      'Added automatic cleanup of stale time-off records',
    ],
  },
];

// Compute version numbers: newest = BASE_BUILD + count - 1, oldest = BASE_BUILD
releaseNotes.forEach((note, i) => {
  note.version = `1.0.0.${BASE_BUILD + releaseNotes.length - 1 - i}`;
});

/** Current app version (from the latest release note) */
export const MANIFEST_VERSION = releaseNotes[0].version;
