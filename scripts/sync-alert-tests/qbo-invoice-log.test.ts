// =============================================================================
// Tests for qbo-create-invoice's qbo_invoice_log writes (_lib/invoiceLog.ts)
// =============================================================================
// Run from the repo root:
//   deno test --no-check scripts/sync-alert-tests/qbo-invoice-log.test.ts
//   node --test scripts/sync-alert-tests/qbo-invoice-log.test.ts
//
// qbo_invoice_log feeds the invoiced-month lock. Pinned here:
//   - an 'error' write never replaces a 'sent' row (concurrent sends);
//   - a 'sent' write that fails or loses the race is reported, not swallowed;
//   - the "created in QBO but not logged" alert + non-2xx response.
// The store is an in-memory table enforcing the UNIQUE month key, returning
// supabase-js `{ error }` shapes.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLogWriteFailedAlert,
  createdButUnloggedResponse,
  QBO_INVOICE_LOG_WRITE_FAILED_ALERT,
  writeInvoiceLogUnlessSent,
} from '../../supabase/functions/qbo-create-invoice/_lib/invoiceLog.ts';
import type {
  CreatedInvoiceContext,
  InvoiceLogKey,
  InvoiceLogRow,
  InvoiceLogStore,
} from '../../supabase/functions/qbo-create-invoice/_lib/invoiceLog.ts';

const ACME = '11111111-1111-1111-1111-111111111111';
const KEY: InvoiceLogKey = { company_id: ACME, report_year: 2026, report_month: 10 };

type Row = Record<string, unknown>;

/** In-memory qbo_invoice_log with the UNIQUE (company, year, month) key. */
function memoryStore(initial?: Row, faults: { updateError?: string; insertError?: string } = {}) {
  let stored: Row | null = initial ? { ...initial } : null;
  const store: InvoiceLogStore & { row: () => Row | null } = {
    row: () => stored,
    updateUnlessSent(_key, row) {
      if (faults.updateError) return Promise.resolve({ count: 0, error: { message: faults.updateError } });
      if (!stored || stored.status === 'sent') return Promise.resolve({ count: 0, error: null });
      stored = { ...stored, ...row };
      return Promise.resolve({ count: 1, error: null });
    },
    insert(row) {
      if (faults.insertError) return Promise.resolve({ error: { message: faults.insertError, code: 'XX000' } });
      if (stored) return Promise.resolve({ error: { message: 'duplicate key', code: '23505' } });
      stored = { ...row };
      return Promise.resolve({ error: null });
    },
  };
  return store;
}

function errorRow(extra: Row = {}): InvoiceLogRow {
  return { ...KEY, status: 'error', error_message: 'QBO 400: bad line', ...extra };
}

function sentRow(id: string): InvoiceLogRow {
  return { ...KEY, status: 'sent', qbo_invoice_id: id, invoice_number: `INV-${id}`, error_message: null };
}

// =============================================================================
// Conditional writes
// =============================================================================

test("an 'error' write never replaces a 'sent' row", async () => {
  const store = memoryStore({ ...KEY, status: 'sent', qbo_invoice_id: '900', invoice_number: 'INV-900' });
  const outcome = await writeInvoiceLogUnlessSent(store, errorRow());
  assert.deepEqual(outcome, { kind: 'already_sent' });
  assert.equal(store.row()?.status, 'sent');
  assert.equal(store.row()?.qbo_invoice_id, '900');
});

test("a second 'sent' write (lost race) does not overwrite the first invoice id", async () => {
  const store = memoryStore();
  assert.deepEqual(await writeInvoiceLogUnlessSent(store, sentRow('900')), { kind: 'written' });
  assert.deepEqual(await writeInvoiceLogUnlessSent(store, sentRow('901')), { kind: 'already_sent' });
  assert.equal(store.row()?.qbo_invoice_id, '900');
});

test("'error' and 'sent' writes land normally on an empty or 'error' month", async () => {
  const store = memoryStore();
  assert.deepEqual(await writeInvoiceLogUnlessSent(store, errorRow()), { kind: 'written' });
  assert.equal(store.row()?.status, 'error');
  assert.deepEqual(await writeInvoiceLogUnlessSent(store, sentRow('900')), { kind: 'written' });
  assert.equal(store.row()?.status, 'sent');
});

test('an error write without qbo_invoice_id keeps an id an earlier attempt persisted', async () => {
  const store = memoryStore({ ...KEY, status: 'error', qbo_invoice_id: '900', invoice_number: 'INV-900' });
  await writeInvoiceLogUnlessSent(store, errorRow({ error_message: 'retry failed' }));
  assert.equal(store.row()?.qbo_invoice_id, '900');
  assert.equal(store.row()?.error_message, 'retry failed');
});

test('update {error} and insert {error} are failures, never "written"', async () => {
  const updateFail = await writeInvoiceLogUnlessSent(memoryStore(undefined, { updateError: 'permission denied' }), sentRow('900'));
  assert.equal(updateFail.kind, 'failed');
  assert.match((updateFail as { error: string }).error, /update: permission denied/);

  const insertFail = await writeInvoiceLogUnlessSent(memoryStore(undefined, { insertError: 'check violation' }), sentRow('900'));
  assert.equal(insertFail.kind, 'failed');
  assert.match((insertFail as { error: string }).error, /insert: check violation/);
});

test('a concurrent insert between update and insert is retried, not reported as sent', async () => {
  // First update sees no row; insert hits 23505 because a concurrent 'error'
  // row appeared; the retry update then lands on that non-sent row.
  let stored: Row | null = null;
  let updates = 0;
  const store: InvoiceLogStore = {
    updateUnlessSent(_k, row) {
      updates++;
      if (updates === 1) return Promise.resolve({ count: 0, error: null });
      stored = { ...stored, ...row };
      return Promise.resolve({ count: 1, error: null });
    },
    insert() {
      stored = { ...KEY, status: 'error' };
      return Promise.resolve({ error: { message: 'duplicate key', code: '23505' } });
    },
  };
  assert.deepEqual(await writeInvoiceLogUnlessSent(store, sentRow('900')), { kind: 'written' });
  assert.equal((stored as Row | null)?.status, 'sent');
});

test('a throwing store is reported as failed', async () => {
  const store: InvoiceLogStore = {
    updateUnlessSent: () => Promise.reject(new Error('socket hang up')),
    insert: () => Promise.resolve({ error: null }),
  };
  assert.deepEqual(await writeInvoiceLogUnlessSent(store, sentRow('900')), {
    kind: 'failed',
    error: 'qbo_invoice_log write threw: socket hang up',
  });
});

// =============================================================================
// Created in QBO, not logged -> alert + non-2xx
// =============================================================================

const CTX: CreatedInvoiceContext = {
  companyId: ACME,
  companyName: 'Acme Corp',
  year: 2026,
  month: 10,
  qboInvoiceId: '900',
  invoiceNumber: '1042',
  reason: 'qbo_invoice_log update: permission denied',
};

test('qbo_invoice_log_write_failed alert is keyed <company uuid>:<YYYY-MM> at error severity', () => {
  const alert = buildLogWriteFailedAlert(CTX);
  assert.equal(alert.type, QBO_INVOICE_LOG_WRITE_FAILED_ALERT);
  assert.equal(alert.type, 'qbo_invoice_log_write_failed');
  assert.equal(alert.entityId, `${ACME}:2026-10`);
  assert.equal(alert.severity, 'error');
  assert.match(alert.title, /#1042 \(Id 900\) WAS created for Acme Corp \(2026-10\)/);
  assert.equal(alert.metadata.qbo_invoice_id, '900');
  assert.equal(alert.metadata.invoice_number, '1042');
});

test('a failed sent-write returns 500 saying the invoice WAS created, with its number and id', () => {
  const r = createdButUnloggedResponse(CTX, false, { raised: true, error: null });
  assert.equal(r.status, 500);
  assert.match(String(r.body.error), /QuickBooks invoice #1042 \(Id 900\) WAS created in QuickBooks/);
  assert.match(String(r.body.error), /Do NOT resend/);
  assert.equal(r.body.invoiceCreatedInQbo, true);
  assert.equal(r.body.invoiceId, '900');
  assert.equal(r.body.invoiceNumber, '1042');
  assert.equal(r.body.alertRaised, true);
});

test('losing the sent race returns 409 flagging a likely duplicate invoice', () => {
  const r = createdButUnloggedResponse(CTX, true, { raised: true, error: null });
  assert.equal(r.status, 409);
  assert.match(String(r.body.error), /already recorded as sent .* duplicate invoice/);
});

test('a failed alert write is surfaced in the response body', () => {
  const r = createdButUnloggedResponse(CTX, false, { raised: false, error: 'raise_billing_alert: denied' });
  assert.equal(r.body.alertRaised, false);
  assert.equal(r.body.alertError, 'raise_billing_alert: denied');
  assert.match(String(r.body.error), /has NOT been raised/);
});
