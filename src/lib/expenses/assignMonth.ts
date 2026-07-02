// =============================================================================
// assignMonth — buckets a transaction into 'YYYY-MM' by its VALUE DATE (Вальор).
// =============================================================================
// The value date is authoritative for month bucketing, NOT the booking date.
// Accepts a 'YYYY-MM-DD' date or a full ISO datetime; returns the leading
// 'YYYY-MM'. Purely string-based to avoid any timezone drift.
// =============================================================================

export function assignMonth(valueDateISO: string): string {
  return valueDateISO.slice(0, 7);
}
