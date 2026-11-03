// =============================================================================
// eom_report_failed — make a per-company report failure visible
// =============================================================================
// Ported from 91eb8b0 (branch sync-alerting-and-attribution-guard), with its
// accounting bug fixed: supabase-js returns `{ error }` rather than throwing,
// and the original never inspected it, so a failed sync_alerts write was
// counted as created/resolved. Here every write is checked and a failed one is
// counted in alert_write_failures (with the entity and message).
//
// Background: NeoCurrency's July 2026 report failed the round-trip drift guard
// on 2026-09-01 and nobody learned of it for over two weeks — the failure lived
// only in the response body. The guard is correct and untouched; only its
// silence is fixed.
//
// Rules:
//   - entity_id is `<company uuid>:<YYYY-MM>`. sync_alerts is UNIQUE
//     (alert_type, entity_id) WHERE resolved_at IS NULL, so a bare company id
//     would let a good August run resolve a still-broken July.
//   - 'failed'    -> raise_billing_alert (insert or refresh is the RPC's job)
//   - 'generated' -> resolve the open alert for the SAME company-month
//   - 'skipped'   -> neither raises nor resolves (incl. locked months)
//   - Alerting never breaks a report run; failures are returned, not thrown.
// =============================================================================

import type { BillingAlert, RaiseBillingAlertFn } from '../../_shared/billingAlerts.ts';
import { monthKey } from './monthLock.ts';

export const EOM_REPORT_FAILED_ALERT = 'eom_report_failed';

/** Structured detail for a rounding-integrity failure, carried into the alert. */
export interface RoundingIntegrityFailure {
  reason: 'rounding_integrity';
  projectExternalId: string;
  canonicalProjectId: string;
  summaryRoundedMinutes: number;
  taskRowSumMinutes: number;
  driftMinutes: number;
}

/** The fields of a CompanyReportResult the alert pass reads. */
export interface EomAlertInput {
  companyId: string;
  companyName: string;
  year: number;
  month: number;
  status: 'generated' | 'skipped' | 'failed';
  error?: string;
  failure?: RoundingIntegrityFailure;
}

type DbError = { message: string } | null;

/** Lookup + resolve of open eom_report_failed rows; index.ts adapts supabase. */
export interface OpenAlertStore {
  findOpenId(alertType: string, entityId: string): Promise<{ id: string | null; error: DbError }>;
  resolve(id: string, nowISO: string): Promise<{ error: DbError }>;
}

export interface EomAlertSummary {
  action: 'eom_alerts_complete';
  alerts_raised: number;
  alerts_resolved: number;
  alert_write_failures: number;
  write_failures: Array<{ entity_id: string; error: string }>;
}

export function eomAlertEntityId(r: Pick<EomAlertInput, 'companyId' | 'year' | 'month'>): string {
  return `${r.companyId}:${monthKey(r.year, r.month)}`;
}

export function buildEomFailureAlert(r: EomAlertInput): BillingAlert {
  const key = monthKey(r.year, r.month);
  return {
    type: EOM_REPORT_FAILED_ALERT,
    entityId: eomAlertEntityId(r),
    title:
      `End-of-month report for ${r.companyName} (${key}) FAILED to generate: ` +
      `${r.error || 'unknown error'}`,
    metadata: {
      company_id: r.companyId,
      company_name: r.companyName,
      report_year: r.year,
      report_month: r.month,
      report_month_key: key,
      failure_reason: r.failure?.reason ?? 'other',
      error_message: r.error ?? null,
      project_external_id: r.failure?.projectExternalId ?? null,
      canonical_project_id: r.failure?.canonicalProjectId ?? null,
      summary_rounded_minutes: r.failure?.summaryRoundedMinutes ?? null,
      task_row_sum_minutes: r.failure?.taskRowSumMinutes ?? null,
      drift_minutes: r.failure?.driftMinutes ?? null,
    },
    severity: 'error',
  };
}

export async function syncEomFailureAlerts(
  results: EomAlertInput[],
  deps: { raise: RaiseBillingAlertFn; store: OpenAlertStore; nowISO: string },
): Promise<EomAlertSummary> {
  const summary: EomAlertSummary = {
    action: 'eom_alerts_complete',
    alerts_raised: 0,
    alerts_resolved: 0,
    alert_write_failures: 0,
    write_failures: [],
  };

  const recordFailure = (entityId: string, error: string) => {
    summary.alert_write_failures++;
    summary.write_failures.push({ entity_id: entityId, error });
    console.error(`[generate-eom-report] eom_report_failed alert write failed for ${entityId}: ${error}`);
  };

  for (const r of results) {
    if (r.status === 'skipped') continue;
    const entityId = eomAlertEntityId(r);

    // One try per company: a throwing store/mock must not take down the rest.
    try {
      if (r.status === 'failed') {
        const alert = buildEomFailureAlert(r);
        console.error(`[generate-eom-report] ERROR: ${alert.title}`);
        const outcome = await deps.raise(alert);
        if (outcome.ok) summary.alerts_raised++;
        else recordFailure(entityId, outcome.error);
        continue;
      }

      // 'generated' — resolve this company-month's open alert, if any.
      const found = await deps.store.findOpenId(EOM_REPORT_FAILED_ALERT, entityId);
      if (found.error) {
        recordFailure(entityId, `open-alert lookup: ${found.error.message}`);
        continue;
      }
      if (!found.id) continue;

      const { error } = await deps.store.resolve(found.id, deps.nowISO);
      if (error) recordFailure(entityId, `resolve: ${error.message}`);
      else summary.alerts_resolved++;
    } catch (err) {
      recordFailure(entityId, err instanceof Error ? err.message : String(err));
    }
  }

  return summary;
}
