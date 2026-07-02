// =============================================================================
// normalizeDescription — MUST match Agent A's mining script exactly.
// =============================================================================
// Contract (in order):
//   1. Unicode NFC normalize
//   2. Uppercase
//   3. Replace every digit run (with optional [.,] separators) with '#'
//   4. Collapse all whitespace to single spaces
//   5. Trim
// The produced string is the key used for expense_translation_dict lookups.
// =============================================================================

const DIGIT_RUN = /\d+(?:[.,]\d+)*/g;
const WHITESPACE = /\s+/g;

export function normalizeDescription(input: string): string {
  return (input ?? '')
    .normalize('NFC')
    .toUpperCase()
    .replace(DIGIT_RUN, '#')
    .replace(WHITESPACE, ' ')
    .trim();
}
