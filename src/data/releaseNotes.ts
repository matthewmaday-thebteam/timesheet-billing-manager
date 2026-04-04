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
