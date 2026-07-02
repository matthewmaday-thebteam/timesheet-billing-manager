// =============================================================================
// rowHash — the cross-file, cross-export deduplication key for a transaction.
// =============================================================================
// Canonical string (fields joined by '|'):
//   account | txn_datetime | original_amount | reference | description_original
// where txn_datetime is the ISO-8601 datetime to SECONDS, or the value_date
// when the row has no time component.
//
// FIELD LIST + RATIONALE (why exactly these five):
//   - account            : the same transaction never appears on two accounts;
//                          also keeps an identical-looking EUR-account row
//                          distinct from a BGN-account row.
//   - txn_datetime       : the bank stamps posting time to the second — the
//                          strongest natural uniqueness signal. Two genuinely
//                          distinct same-day purchases differ here (or by ref).
//   - original_amount    : the ACCOUNT-currency amount, fixed to 2 dp.
//   - reference          : bank document/reference number. NOT unique on its
//                          own (fee rows share a reference), so it is one signal
//                          among five, never the sole key.
//   - description_original : final tie-breaker for otherwise-identical rows.
//
// Each text component is whitespace-normalized (runs → single space, trimmed)
// and the amount is fixed to 2 dp, so the SAME transaction arriving via two
// different exports (HTML vs xlsx, differing surrounding whitespace) always
// hashes identically (false-negative defense). All five fields together mean
// two genuinely distinct look-alike rows (e.g. two equal coffee purchases
// differing only by reference or time-to-seconds) hash differently
// (false-positive defense).
//
// SHA-256, hex. Uses WebCrypto (crypto.subtle) — browser, Deno, Node 20+.
// =============================================================================

export interface RowHashInput {
  account: string;
  /** ISO-8601 datetime to seconds, or null/'' when the row has no time. */
  txnDatetime: string | null;
  /** Value date 'YYYY-MM-DD' — used when there is no txn datetime. */
  valueDate: string;
  originalAmount: number;
  reference: string | null;
  descriptionOriginal: string | null;
}

function normComponent(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Build the exact canonical string that gets hashed (exposed for testing). */
export function buildRowHashCanonical(input: RowHashInput): string {
  const dtRaw = input.txnDatetime && input.txnDatetime.length > 0 ? input.txnDatetime : input.valueDate;
  return [
    normComponent(input.account),
    normComponent(dtRaw),
    (input.originalAmount ?? 0).toFixed(2),
    normComponent(input.reference),
    normComponent(input.descriptionOriginal),
  ].join('|');
}

export async function rowHash(input: RowHashInput): Promise<string> {
  const canonical = buildRowHashCanonical(input);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
