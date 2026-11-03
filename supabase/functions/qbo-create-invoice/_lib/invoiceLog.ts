// =============================================================================
// qbo_invoice_log writes that can never demote a 'sent' row
// =============================================================================
// qbo_invoice_log is what the invoiced-month lock reads: a 'sent' row (or any
// row carrying a qbo_invoice_id) is the record that a month was billed. Before
// this module every write was an unconditional upsert on
// (company_id, report_year, report_month), so:
//   - a late 'error' write (e.g. the losing side of two concurrent sends)
//     replaced a 'sent' row and unlocked an invoiced month;
//   - a failed 'sent' write after QuickBooks created the invoice was only
//     console-logged, and the response still said success.
//
// writeInvoiceLogUnlessSent: UPDATE ... WHERE status <> 'sent', else INSERT.
// If neither lands because the row is (or concurrently became) 'sent', the
// outcome is 'already_sent' — never a silent overwrite.
// =============================================================================

import type { BillingAlert } from '../../_shared/billingAlerts.ts';

export type InvoiceLogStatus = 'pending' | 'sent' | 'error';

export interface InvoiceLogKey {
  company_id: string;
  report_year: number;
  report_month: number;
}

export type InvoiceLogRow = InvoiceLogKey & { status: InvoiceLogStatus } & Record<string, unknown>;

type DbError = { message: string; code?: string } | null;

/** Two conditional primitives; index.ts adapts supabase-js. */
export interface InvoiceLogStore {
  /** UPDATE the key's row WHERE status <> 'sent'; returns rows changed. */
  updateUnlessSent(key: InvoiceLogKey, row: InvoiceLogRow): Promise<{ count: number; error: DbError }>;
  /** Plain INSERT; a unique violation (23505) means the row already exists. */
  insert(row: InvoiceLogRow): Promise<{ error: DbError }>;
}

export type InvoiceLogWriteOutcome =
  | { kind: 'written' }
  | { kind: 'already_sent' }
  | { kind: 'failed'; error: string };

const UNIQUE_VIOLATION = '23505';

export async function writeInvoiceLogUnlessSent(
  store: InvoiceLogStore,
  row: InvoiceLogRow,
): Promise<InvoiceLogWriteOutcome> {
  const key: InvoiceLogKey = {
    company_id: row.company_id,
    report_year: row.report_year,
    report_month: row.report_month,
  };
  try {
    const updated = await store.updateUnlessSent(key, row);
    if (updated.error) return { kind: 'failed', error: `qbo_invoice_log update: ${updated.error.message}` };
    if (updated.count > 0) return { kind: 'written' };

    // No non-sent row: either no row at all, or the row is 'sent'.
    const inserted = await store.insert(row);
    if (!inserted.error) return { kind: 'written' };
    if (inserted.error.code === UNIQUE_VIOLATION) {
      // The row exists, and the update above did not touch it, so it is 'sent'
      // (or a concurrent writer just created it — recheck by retrying once).
      const retry = await store.updateUnlessSent(key, row);
      if (retry.error) return { kind: 'failed', error: `qbo_invoice_log update (retry): ${retry.error.message}` };
      return retry.count > 0 ? { kind: 'written' } : { kind: 'already_sent' };
    }
    return { kind: 'failed', error: `qbo_invoice_log insert: ${inserted.error.message}` };
  } catch (err) {
    return { kind: 'failed', error: `qbo_invoice_log write threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// =============================================================================
// Invoice created in QuickBooks, but not recorded as 'sent'
// =============================================================================

export const QBO_INVOICE_LOG_WRITE_FAILED_ALERT = 'qbo_invoice_log_write_failed';

export interface CreatedInvoiceContext {
  companyId: string;
  companyName: string | null;
  year: number;
  month: number;
  qboInvoiceId: string;
  invoiceNumber: string;
  /** Why the 'sent' row is missing — a failed write, or another send won. */
  reason: string;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function invoiceLabel(ctx: CreatedInvoiceContext): string {
  return `QuickBooks invoice ${ctx.invoiceNumber ? `#${ctx.invoiceNumber} ` : ''}(Id ${ctx.qboInvoiceId})`;
}

export function buildLogWriteFailedAlert(ctx: CreatedInvoiceContext): BillingAlert {
  const key = monthKey(ctx.year, ctx.month);
  return {
    type: QBO_INVOICE_LOG_WRITE_FAILED_ALERT,
    entityId: `${ctx.companyId}:${key}`,
    title:
      `${invoiceLabel(ctx)} WAS created for ${ctx.companyName ?? ctx.companyId} (${key}) ` +
      `but Manifest did not record it as sent — the month may be unlocked and could be ` +
      `invoiced again: ${ctx.reason}`,
    metadata: {
      company_id: ctx.companyId,
      company_name: ctx.companyName,
      report_year: ctx.year,
      report_month: ctx.month,
      report_month_key: key,
      qbo_invoice_id: ctx.qboInvoiceId,
      invoice_number: ctx.invoiceNumber || null,
      error_message: ctx.reason,
    },
    severity: 'error',
  };
}

/**
 * Non-2xx body for "QuickBooks has the invoice, Manifest's log does not".
 * 409 when a concurrent send already holds the 'sent' row (likely duplicate
 * invoice in QuickBooks); 500 when the write itself failed.
 */
export function createdButUnloggedResponse(
  ctx: CreatedInvoiceContext,
  alreadySent: boolean,
  alert: { raised: boolean; error: string | null },
): { status: 409 | 500; body: Record<string, unknown> } {
  const label = invoiceLabel(ctx);
  const error = alreadySent
    ? `${label} WAS created in QuickBooks, but ${monthKey(ctx.year, ctx.month)} was already ` +
      `recorded as sent by another send — QuickBooks likely now has a duplicate invoice. ` +
      `Check QuickBooks and void one of them.`
    : `${label} WAS created in QuickBooks, but recording it in Manifest failed: ${ctx.reason}. ` +
      `Do NOT resend — the invoice exists. An alert has ${alert.raised ? '' : 'NOT '}been raised.`;
  return {
    status: alreadySent ? 409 : 500,
    body: {
      error,
      invoiceCreatedInQbo: true,
      invoiceId: ctx.qboInvoiceId,
      invoiceNumber: ctx.invoiceNumber,
      logWriteError: ctx.reason,
      alertRaised: alert.raised,
      ...(alert.error ? { alertError: alert.error } : {}),
    },
  };
}
