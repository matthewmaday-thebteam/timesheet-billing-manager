export interface ReleaseNote {
  date: string        // 'YYYY-MM-DD'
  title: string       // Short headline
  highlights: string[] // Bullet points of changes
}

export const releaseNotes: ReleaseNote[] = [
  {
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
    date: '2026-03-04',
    title: 'BambooHR Time-Off Sync Fix',
    highlights: [
      'Fixed cancelled vacation days still appearing in Manifest',
      'Fixed approved vacation days not syncing from BambooHR',
      'Added automatic cleanup of stale time-off records',
    ],
  },
]
