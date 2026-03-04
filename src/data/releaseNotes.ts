export interface ReleaseNote {
  date: string        // 'YYYY-MM-DD'
  title: string       // Short headline
  highlights: string[] // Bullet points of changes
}

export const releaseNotes: ReleaseNote[] = [
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
