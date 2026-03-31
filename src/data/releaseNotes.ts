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
