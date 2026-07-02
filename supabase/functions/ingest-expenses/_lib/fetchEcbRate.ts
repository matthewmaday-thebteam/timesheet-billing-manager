// =============================================================================
// fetchEcbRate — ingest-time EUR→USD rate lookup (EDGE ONLY; never the client).
// =============================================================================
// Documented convention (mined from the reference reports' Notes sheets):
//   - Prefer the ECB monthly EXR series  M.USD.EUR.SP00.A  for a completed month.
//   - For the CURRENT, not-yet-published month, use the average of available ECB
//     daily rows  D.USD.EUR.SP00.A  for the dates present so far.
//   - Value is USD per 1 EUR; rounded to 6dp to match the historical books.
// Source recorded as 'ecb_monthly' or 'ecb_daily_avg'. Any failure (network,
// non-200, empty series, future month) returns null → the row ingests with USD
// pending (graceful degradation; NEVER blocks ingest). The pure planning/parsing
// helpers are exported for unit testing without a network.
// =============================================================================

import type { FxRateSource } from './types.ts';

const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data/EXR';
const FETCH_TIMEOUT_MS = 8_000;

export interface FxLookupPlan {
  url: string;
  source: Extract<FxRateSource, 'ecb_monthly' | 'ecb_daily_avg'>;
}

/**
 * Decide the ECB lookup for `month` ('YYYY-MM') relative to `todayISO`.
 *   - future month  → null (no data exists yet)
 *   - current month → partial-month DAILY average (dates 01..today)
 *   - past month    → published MONTHLY average
 */
export function planFxLookup(month: string, todayISO: string): FxLookupPlan | null {
  const currentMonth = todayISO.slice(0, 7);
  if (month > currentMonth) return null;
  if (month === currentMonth) {
    const start = `${month}-01`;
    const end = todayISO.slice(0, 10);
    return {
      url: `${ECB_BASE}/D.USD.EUR.SP00.A?startPeriod=${start}&endPeriod=${end}&format=csvdata`,
      source: 'ecb_daily_avg',
    };
  }
  return {
    url: `${ECB_BASE}/M.USD.EUR.SP00.A?startPeriod=${month}&endPeriod=${month}&format=csvdata`,
    source: 'ecb_monthly',
  };
}

/** Extract the OBS_VALUE column from an ECB SDMX `csvdata` response. */
export function parseEcbObsValues(csv: string): number[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const valueIdx = header.indexOf('OBS_VALUE');
  if (valueIdx < 0) return [];
  const values: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const value = Number(lines[i].split(',')[valueIdx]);
    if (Number.isFinite(value) && value > 0) values.push(value);
  }
  return values;
}

/** Average a set of rates, rounded to 6dp (the documented convention). */
export function averageRate6(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(avg * 1e6) / 1e6;
}

/** Fetch + parse + average. Returns null on any failure (row stays pending). */
export async function fetchEcbRate(
  month: string,
  todayISO: string,
): Promise<{ eurUsd: number; source: FxRateSource } | null> {
  const plan = planFxLookup(month, todayISO);
  if (!plan) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(plan.url, {
      headers: { Accept: 'text/csv' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const eurUsd = averageRate6(parseEcbObsValues(await res.text()));
    if (eurUsd == null || !(eurUsd > 0)) return null;
    return { eurUsd, source: plan.source };
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
