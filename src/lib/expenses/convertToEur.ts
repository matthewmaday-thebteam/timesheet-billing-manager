// =============================================================================
// convertToEur — locked business rules. NEVER re-converts foreign OPERATION
// amounts; EUR always derives from the bank-booked ACCOUNT-currency amount.
// =============================================================================
//   EUR account → eur = original_amount, rate 1.0,        source 'identity'
//   BGN account → eur = round2(original / 1.95583), rate 1.95583, source 'peg'
// rate_date is null for both (no ECB / daily rates — dormant contingency only).
// round2 rounds half AWAY FROM ZERO to 2 decimal places.
// =============================================================================

import { BGN_EUR_PEG, type AccountCurrency, type EurConversion } from './types.ts';

/** Round to 2dp, half away from zero (so -0.005 -> -0.01, 0.005 -> 0.01). */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
}

export function convertToEur(accountCurrency: AccountCurrency, originalAmount: number): EurConversion {
  if (accountCurrency === 'BGN') {
    return {
      eurAmount: round2(originalAmount / BGN_EUR_PEG),
      conversionRate: BGN_EUR_PEG,
      rateSource: 'peg',
      rateDate: null,
    };
  }
  // EUR account — identity, no conversion.
  return {
    eurAmount: round2(originalAmount),
    conversionRate: 1,
    rateSource: 'identity',
    rateDate: null,
  };
}
