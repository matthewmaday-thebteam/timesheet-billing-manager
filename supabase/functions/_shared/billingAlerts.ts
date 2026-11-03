// =============================================================================
// Shared Module: billing alerts (raise_billing_alert RPC)
// =============================================================================
// One place that knows how to call the `raise_billing_alert` RPC and how to
// turn a failed `drain_recalculation_queue` call into a `recalc_drain_failed`
// alert. Used by generate-eom-report and both timesheet syncs.
//
// Dependency-free on purpose (no esm.sh import): the client is typed
// structurally so these helpers run under Deno AND the Node test runner
// (scripts/sync-alert-tests/billing-lock.test.ts) with a mocked client.
//
// supabase-js reports RPC failures as `{ error }` instead of throwing, so every
// helper here inspects `error` and returns a typed outcome. Nothing is
// swallowed: a failed alert write comes back as `{ ok: false, error }` for the
// caller to put in its response / sync_runs summary.
// =============================================================================

/** The subset of a supabase-js RPC response these helpers rely on. */
export interface RpcResponse<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

/** Structural stand-in for SupabaseClient — only `.rpc()` is needed. */
export interface RpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResponse<any>>;
}

export type BillingAlertSeverity = 'warning' | 'error';

export interface BillingAlert {
  type: string;
  entityId: string;
  title: string;
  metadata: Record<string, unknown>;
  severity: BillingAlertSeverity;
}

export type AlertWriteOutcome = { ok: true } | { ok: false; error: string };

/** Injectable alert sink: production uses `makeRaiseBillingAlert`, tests a mock. */
export type RaiseBillingAlertFn = (alert: BillingAlert) => Promise<AlertWriteOutcome>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Binds `raise_billing_alert(p_type, p_entity_id, p_title, p_metadata, p_severity)`. */
export function makeRaiseBillingAlert(client: RpcClient): RaiseBillingAlertFn {
  return async (alert) => {
    try {
      const { error } = await client.rpc('raise_billing_alert', {
        p_type: alert.type,
        p_entity_id: alert.entityId,
        p_title: alert.title,
        p_metadata: alert.metadata,
        p_severity: alert.severity,
      });
      if (error) return { ok: false, error: `raise_billing_alert(${alert.type}): ${error.message}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `raise_billing_alert(${alert.type}) threw: ${errorMessage(err)}` };
    }
  };
}

// =============================================================================
// recalc_drain_failed — drain_recalculation_queue returned an error
// =============================================================================

export const RECALC_DRAIN_FAILED_ALERT = 'recalc_drain_failed';

export interface DrainFailureContext {
  /** sync_runs.sync_type, e.g. 'clockify_timesheets'. Used as entity_id. */
  syncType: string;
  syncRunId: string;
  errorMessage: string;
}

/** Shape merged into the sync's `recalculation` step result. */
export interface DrainFailureAlertResult {
  alert_type: typeof RECALC_DRAIN_FAILED_ALERT;
  alert_raised: boolean;
  alert_error: string | null;
}

export function buildDrainFailureAlert(ctx: DrainFailureContext): BillingAlert {
  return {
    type: RECALC_DRAIN_FAILED_ALERT,
    entityId: ctx.syncType,
    title:
      `Recalculation queue drain FAILED after ${ctx.syncType} sync — ` +
      `project_monthly_summary may be stale until the next successful drain: ${ctx.errorMessage}`,
    metadata: {
      sync_type: ctx.syncType,
      sync_run_id: ctx.syncRunId,
      error_message: ctx.errorMessage,
    },
    severity: 'error',
  };
}

/** Raises `recalc_drain_failed` and reports whether the alert write landed. */
export async function raiseDrainFailureAlert(
  raise: RaiseBillingAlertFn,
  ctx: DrainFailureContext,
): Promise<DrainFailureAlertResult> {
  const outcome = await raise(buildDrainFailureAlert(ctx));
  return {
    alert_type: RECALC_DRAIN_FAILED_ALERT,
    alert_raised: outcome.ok,
    alert_error: outcome.ok ? null : outcome.error,
  };
}
