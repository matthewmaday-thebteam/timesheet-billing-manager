// =============================================================================
// Tests for the invoiced-month lock / stale-summary fix (edge-function side)
// =============================================================================
// Run from the repo root:
//   deno test --no-check scripts/sync-alert-tests/billing-lock.test.ts
//   node --test scripts/sync-alert-tests/billing-lock.test.ts
//
// Covers the pure decision logic extracted from generate-eom-report and the
// timesheet syncs. Every RPC / sync_alerts call is a mock returning the
// supabase-js `{ data, error }` shape — supabase-js does NOT throw on a failed
// write, which is exactly the bug these tests pin down.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDrainFailureAlert,
  makeRaiseBillingAlert,
  raiseDrainFailureAlert,
} from '../../supabase/functions/_shared/billingAlerts.ts';
import type { BillingAlert, RaiseBillingAlertFn, RpcClient, RpcResponse } from '../../supabase/functions/_shared/billingAlerts.ts';
import {
  checkMonthLock,
  lockedRegenerateRefusal,
  makeIsCompanyMonthLocked,
  monthKey,
  monthStartDate,
} from '../../supabase/functions/generate-eom-report/_lib/monthLock.ts';
import {
  EOM_RECONCILE_FAILED_ALERT,
  makeReconcileBillingMonths,
  partitionByLock,
  planBackfill,
  reconcileRangeFor,
  runBackfillReconcile,
} from '../../supabase/functions/generate-eom-report/_lib/backfillPlan.ts';
import type { AvailabilityRow } from '../../supabase/functions/generate-eom-report/_lib/backfillPlan.ts';
import {
  EOM_REPORT_FAILED_ALERT,
  eomAlertEntityId,
  syncEomFailureAlerts,
} from '../../supabase/functions/generate-eom-report/_lib/eomAlerts.ts';
import type { EomAlertInput, OpenAlertStore } from '../../supabase/functions/generate-eom-report/_lib/eomAlerts.ts';

// -----------------------------------------------------------------------------
// Fixtures / mocks
// -----------------------------------------------------------------------------

const ACME = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

function row(companyId: string, year: number, month: number, hasReport: boolean): AvailabilityRow {
  return { company_id: companyId, company_name: `co-${companyId.slice(0, 4)}`, report_year: year, report_month: month, has_report: hasReport };
}

type RpcCall = { fn: string; args?: Record<string, unknown> };

/** RpcClient whose responses come from `respond`; records every call. */
function mockRpc(respond: (call: RpcCall) => RpcResponse | Promise<RpcResponse>): RpcClient & { calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc(fn, args) {
      const call = { fn, args };
      calls.push(call);
      return Promise.resolve(respond(call));
    },
  };
}

/** Alert sink that records alerts and returns `outcome` (default ok). */
function recordingRaise(outcome: (a: BillingAlert) => { ok: true } | { ok: false; error: string } = () => ({ ok: true })) {
  const raised: BillingAlert[] = [];
  const raise: RaiseBillingAlertFn = (alert) => {
    raised.push(alert);
    return Promise.resolve(outcome(alert));
  };
  return { raise, raised };
}

const OK = { data: null, error: null };
const pastAlways = () => true;

// =============================================================================
// Backfill planning: has_report = false only, never a locked month
// =============================================================================

test('backfill plans only past company-months with has_report = false', () => {
  const plan = planBackfill(
    [row(ACME, 2026, 9, true), row(ACME, 2026, 10, false), row(BETA, 2026, 10, true), row(BETA, 2026, 11, false)],
    (y, m) => !(y === 2026 && m === 11),
  );
  assert.deepEqual(plan.candidates.map((r) => `${r.company_id}:${monthKey(r.report_year, r.report_month)}`), [
    `${ACME}:2026-10`,
  ]);
  assert.equal(plan.alreadyReported, 2);
  assert.equal(plan.notYetPast, 1);
});

test('backfill with every report present plans nothing (no regeneration of existing reports)', () => {
  const plan = planBackfill([row(ACME, 2026, 8, true), row(ACME, 2026, 9, true)], pastAlways);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.alreadyReported, 2);
});

test('a non-boolean has_report throws instead of being read as "missing"', () => {
  const bad = { ...row(ACME, 2026, 9, false), has_report: null } as unknown as AvailabilityRow;
  assert.throws(() => planBackfill([bad], pastAlways), /non-boolean has_report/);
});

test('partitionByLock drops locked months and routes a failed lock check to lockErrors', async () => {
  const rpc = mockRpc(({ args }) => {
    if (args?.p_company_id === ACME && args?.p_month === '2026-09-01') return { data: true, error: null };
    if (args?.p_company_id === BETA) return { data: null, error: { message: 'permission denied' } };
    return { data: false, error: null };
  });
  const partition = await partitionByLock(
    [row(ACME, 2026, 9, false), row(ACME, 2026, 10, false), row(BETA, 2026, 10, false)],
    makeIsCompanyMonthLocked(rpc),
  );
  assert.deepEqual(partition.toGenerate.map((r) => r.report_month), [10]);
  assert.equal(partition.toGenerate[0].company_id, ACME);
  assert.deepEqual(partition.locked.map((r) => `${r.company_id}:${r.report_month}`), [`${ACME}:9`]);
  assert.equal(partition.lockErrors.length, 1);
  assert.match(partition.lockErrors[0].message, /is_company_month_locked\(2222.*2026-10-01\): permission denied/);
  assert.deepEqual(rpc.calls[0], { fn: 'is_company_month_locked', args: { p_company_id: ACME, p_month: '2026-09-01' } });
});

test('a lock check returning a non-boolean is an error, never "open"', async () => {
  const isLocked = makeIsCompanyMonthLocked(mockRpc(() => ({ data: null, error: null })));
  const state = await checkMonthLock(isLocked, { companyId: ACME, year: 2026, month: 9 });
  assert.equal(state.kind, 'error');
  assert.match((state as { message: string }).message, /expected boolean/);
});

// =============================================================================
// Explicit regenerate of a locked month -> 409
// =============================================================================

test('locked-month regenerate is refused with a clear 409', async () => {
  const isLocked = makeIsCompanyMonthLocked(mockRpc(() => ({ data: true, error: null })));
  assert.deepEqual(await checkMonthLock(isLocked, { companyId: ACME, year: 2026, month: 9 }), { kind: 'locked' });

  const refusal = lockedRegenerateRefusal('Acme Corp', 2026, 9);
  assert.equal(refusal.status, 409);
  assert.equal(refusal.body.reason, 'month_locked');
  assert.match(refusal.body.error, /2026-09 report for Acme Corp cannot be regenerated/);
  assert.match(refusal.body.error, /invoiced/);
  assert.match(refusal.body.error, /lock override/);
});

test('an open month is allowed to regenerate', async () => {
  const isLocked = makeIsCompanyMonthLocked(mockRpc(() => ({ data: false, error: null })));
  assert.deepEqual(await checkMonthLock(isLocked, { companyId: ACME, year: 2026, month: 10 }), { kind: 'open' });
});

// =============================================================================
// reconcile_billing_months before backfill: failure -> alert + continue
// =============================================================================

test('reconcile range spans the planned months as inclusive first-of-month dates', () => {
  assert.equal(reconcileRangeFor([]), null);
  assert.deepEqual(reconcileRangeFor([row(ACME, 2026, 10, false), row(BETA, 2025, 12, false), row(BETA, 2026, 2, false)]), {
    from: '2025-12-01',
    to: '2026-10-01',
  });
  assert.equal(monthStartDate(2026, 3), '2026-03-01');
});

test('reconcile runs with p_dry_run = false and an ok status raises nothing', async () => {
  const rpc = mockRpc(() => ({ data: { status: 'ok', recalculated: 3, locked_alerts: 0, persisting: 0 }, error: null }));
  const { raise, raised } = recordingRaise();
  const result = await runBackfillReconcile({ from: '2026-10-01', to: '2026-10-01' }, makeReconcileBillingMonths(rpc), raise);
  assert.equal(result.action, 'reconcile_ok');
  assert.deepEqual(rpc.calls, [{ fn: 'reconcile_billing_months', args: { p_from: '2026-10-01', p_to: '2026-10-01', p_dry_run: false } }]);
  assert.equal(raised.length, 0);
});

test('reconcile status "failed" raises eom_reconcile_failed and returns (does not throw)', async () => {
  const rpc = mockRpc(() => ({ data: { status: 'failed', recalculated: 0, locked_alerts: 2, persisting: 1 }, error: null }));
  const { raise, raised } = recordingRaise();
  const result = await runBackfillReconcile({ from: '2026-09-01', to: '2026-10-01' }, makeReconcileBillingMonths(rpc), raise);
  assert.equal(result.action, 'reconcile_failed');
  assert.equal(raised.length, 1);
  assert.equal(raised[0].type, EOM_RECONCILE_FAILED_ALERT);
  assert.equal(raised[0].entityId, '2026-09..2026-10');
  assert.equal(raised[0].severity, 'error');
  assert.match(raised[0].title, /status "failed"/);
  if (result.action === 'reconcile_failed') {
    assert.equal(result.alert_raised, true);
    assert.deepEqual(result.summary, { status: 'failed', recalculated: 0, locked_alerts: 2, persisting: 1 });
  }
});

test('reconcile RPC {error}, a throw, or a bad payload each alert and continue', async () => {
  const cases: Array<[string, () => RpcResponse | Promise<RpcResponse>, RegExp]> = [
    ['rpc error', () => ({ data: null, error: { message: 'function does not exist' } }), /RPC error: function does not exist/],
    ['throw', () => Promise.reject(new Error('fetch failed')), /threw: fetch failed/],
    ['null payload', () => ({ data: null, error: null }), /unexpected payload/],
    ['missing status', () => ({ data: { recalculated: 1 }, error: null }), /status undefined/],
  ];
  for (const [label, respond, pattern] of cases) {
    const { raise, raised } = recordingRaise();
    const result = await runBackfillReconcile({ from: '2026-10-01', to: '2026-10-01' }, makeReconcileBillingMonths(mockRpc(respond)), raise);
    assert.equal(result.action, 'reconcile_failed', label);
    assert.equal(raised.length, 1, label);
    if (result.action === 'reconcile_failed') assert.match(result.error, pattern, label);
  }
});

test('a failed eom_reconcile_failed alert write is reported, not swallowed', async () => {
  const reconcile = makeReconcileBillingMonths(mockRpc(() => ({ data: { status: 'failed' }, error: null })));
  const raise = makeRaiseBillingAlert(mockRpc(() => ({ data: null, error: { message: 'sync_alerts insert denied' } })));
  const result = await runBackfillReconcile({ from: '2026-10-01', to: '2026-10-01' }, reconcile, raise);
  assert.equal(result.action, 'reconcile_failed');
  if (result.action === 'reconcile_failed') {
    assert.equal(result.alert_raised, false);
    assert.match(result.alert_error ?? '', /raise_billing_alert\(eom_reconcile_failed\): sync_alerts insert denied/);
  }
});

test('no months to generate -> reconcile is skipped without an RPC call', async () => {
  const rpc = mockRpc(() => OK);
  const { raise, raised } = recordingRaise();
  const result = await runBackfillReconcile(null, makeReconcileBillingMonths(rpc), raise);
  assert.deepEqual(result, { action: 'reconcile_skipped', reason: 'no_months_to_generate' });
  assert.equal(rpc.calls.length, 0);
  assert.equal(raised.length, 0);
});

// =============================================================================
// eom_report_failed alert accounting (fixes 91eb8b0's unchecked {error})
// =============================================================================

function result(companyId: string, month: number, status: EomAlertInput['status'], extra: Partial<EomAlertInput> = {}): EomAlertInput {
  return { companyId, companyName: `co-${companyId.slice(0, 4)}`, year: 2026, month, status, ...extra };
}

function mockStore(opts: {
  openIds?: Record<string, string>;
  lookupError?: string;
  resolveError?: string;
}): OpenAlertStore & { resolved: string[] } {
  const resolved: string[] = [];
  return {
    resolved,
    findOpenId(alertType, entityId) {
      assert.equal(alertType, EOM_REPORT_FAILED_ALERT);
      if (opts.lookupError) return Promise.resolve({ id: null, error: { message: opts.lookupError } });
      return Promise.resolve({ id: opts.openIds?.[entityId] ?? null, error: null });
    },
    resolve(id) {
      if (opts.resolveError) return Promise.resolve({ error: { message: opts.resolveError } });
      resolved.push(id);
      return Promise.resolve({ error: null });
    },
  };
}

const NOW = '2026-11-01T06:00:00.000Z';

test('entity_id is <company uuid>:<YYYY-MM>', () => {
  assert.equal(eomAlertEntityId({ companyId: ACME, year: 2026, month: 7 }), `${ACME}:2026-07`);
});

test('a failed result raises eom_report_failed with rounding-integrity metadata', async () => {
  const { raise, raised } = recordingRaise();
  const summary = await syncEomFailureAlerts(
    [result(ACME, 7, 'failed', {
      error: 'Task-row rounded minutes (60) do not equal ...',
      failure: { reason: 'rounding_integrity', projectExternalId: 'P1', canonicalProjectId: 'c-1', summaryRoundedMinutes: 75, taskRowSumMinutes: 60, driftMinutes: 15 },
    })],
    { raise, store: mockStore({}), nowISO: NOW },
  );
  assert.equal(summary.alerts_raised, 1);
  assert.equal(summary.alert_write_failures, 0);
  assert.equal(raised[0].type, EOM_REPORT_FAILED_ALERT);
  assert.equal(raised[0].entityId, `${ACME}:2026-07`);
  assert.equal(raised[0].severity, 'error');
  assert.equal(raised[0].metadata.failure_reason, 'rounding_integrity');
  assert.equal(raised[0].metadata.drift_minutes, 15);
  assert.equal(raised[0].metadata.company_id, ACME);
});

test('a raise_billing_alert {error} is counted as a write failure, not as raised', async () => {
  const raise = makeRaiseBillingAlert(mockRpc(() => ({ data: null, error: { message: 'duplicate key' } })));
  const summary = await syncEomFailureAlerts([result(ACME, 7, 'failed', { error: 'boom' })], { raise, store: mockStore({}), nowISO: NOW });
  assert.equal(summary.alerts_raised, 0);
  assert.equal(summary.alert_write_failures, 1);
  assert.equal(summary.write_failures[0].entity_id, `${ACME}:2026-07`);
  assert.match(summary.write_failures[0].error, /duplicate key/);
});

test('success resolves the open alert for the SAME company-month only', async () => {
  const { raise } = recordingRaise();
  const store = mockStore({ openIds: { [`${ACME}:2026-08`]: 'alert-aug', [`${ACME}:2026-07`]: 'alert-jul' } });
  const summary = await syncEomFailureAlerts([result(ACME, 8, 'generated')], { raise, store, nowISO: NOW });
  assert.deepEqual(store.resolved, ['alert-aug']);
  assert.equal(summary.alerts_resolved, 1);
});

test('a resolve {error} is counted as a write failure, not as resolved', async () => {
  const { raise } = recordingRaise();
  const store = mockStore({ openIds: { [`${ACME}:2026-08`]: 'alert-aug' }, resolveError: 'update blocked' });
  const summary = await syncEomFailureAlerts([result(ACME, 8, 'generated')], { raise, store, nowISO: NOW });
  assert.equal(summary.alerts_resolved, 0);
  assert.equal(summary.alert_write_failures, 1);
  assert.match(summary.write_failures[0].error, /resolve: update blocked/);
});

test('an open-alert lookup {error} is counted as a write failure', async () => {
  const { raise } = recordingRaise();
  const summary = await syncEomFailureAlerts([result(ACME, 8, 'generated')], { raise, store: mockStore({ lookupError: 'timeout' }), nowISO: NOW });
  assert.equal(summary.alert_write_failures, 1);
  assert.match(summary.write_failures[0].error, /open-alert lookup: timeout/);
});

test("'skipped' (incl. locked) neither raises nor resolves", async () => {
  const { raise, raised } = recordingRaise();
  const store = mockStore({ openIds: { [`${ACME}:2026-07`]: 'alert-jul' } });
  const summary = await syncEomFailureAlerts(
    [result(ACME, 7, 'skipped', { error: 'Month is locked (invoiced)' })],
    { raise, store, nowISO: NOW },
  );
  assert.equal(raised.length, 0);
  assert.deepEqual(store.resolved, []);
  assert.deepEqual([summary.alerts_raised, summary.alerts_resolved, summary.alert_write_failures], [0, 0, 0]);
});

test('one company failing to write does not stop the others', async () => {
  const raise: RaiseBillingAlertFn = (a) =>
    a.entityId.startsWith(ACME) ? Promise.reject(new Error('socket hang up')) : Promise.resolve({ ok: true });
  const summary = await syncEomFailureAlerts(
    [result(ACME, 7, 'failed', { error: 'x' }), result(BETA, 7, 'failed', { error: 'y' })],
    { raise, store: mockStore({}), nowISO: NOW },
  );
  assert.equal(summary.alerts_raised, 1);
  assert.equal(summary.alert_write_failures, 1);
});

// =============================================================================
// drain_recalculation_queue error -> recalc_drain_failed
// =============================================================================

test('a drain error raises recalc_drain_failed keyed by the sync type', async () => {
  const rpc = mockRpc(() => OK);
  const outcome = await raiseDrainFailureAlert(makeRaiseBillingAlert(rpc), {
    syncType: 'clockify_timesheets',
    syncRunId: 'run-1',
    errorMessage: 'Recalculation RPC error: canceling statement due to statement timeout',
  });
  assert.deepEqual(outcome, { alert_type: 'recalc_drain_failed', alert_raised: true, alert_error: null });
  assert.equal(rpc.calls.length, 1);
  assert.equal(rpc.calls[0].fn, 'raise_billing_alert');
  assert.equal(rpc.calls[0].args?.p_type, 'recalc_drain_failed');
  assert.equal(rpc.calls[0].args?.p_entity_id, 'clockify_timesheets');
  assert.equal(rpc.calls[0].args?.p_severity, 'error');
  assert.match(String(rpc.calls[0].args?.p_title), /statement timeout/);
  assert.deepEqual(rpc.calls[0].args?.p_metadata, {
    sync_type: 'clockify_timesheets',
    sync_run_id: 'run-1',
    error_message: 'Recalculation RPC error: canceling statement due to statement timeout',
  });
});

test('a failed recalc_drain_failed alert write is surfaced in the step result', async () => {
  const outcome = await raiseDrainFailureAlert(
    makeRaiseBillingAlert(mockRpc(() => ({ data: null, error: { message: 'raise_billing_alert does not exist' } }))),
    { syncType: 'clickup_timesheets', syncRunId: 'run-2', errorMessage: 'boom' },
  );
  assert.equal(outcome.alert_raised, false);
  assert.match(outcome.alert_error ?? '', /raise_billing_alert\(recalc_drain_failed\): raise_billing_alert does not exist/);
});

test('a throwing RPC client is caught and reported by makeRaiseBillingAlert', async () => {
  const raise = makeRaiseBillingAlert(mockRpc(() => Promise.reject(new Error('network down'))));
  const outcome = await raise(buildDrainFailureAlert({ syncType: 'clickup_timesheets', syncRunId: 'r', errorMessage: 'e' }));
  assert.deepEqual(outcome, { ok: false, error: 'raise_billing_alert(recalc_drain_failed) threw: network down' });
});
