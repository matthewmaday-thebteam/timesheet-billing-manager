/**
 * useQBOInvoices - QuickBooks Online invoice sending hook
 *
 * Fetches the invoice log from qbo_invoice_log, provides send/retry
 * actions via the qbo-create-invoice Edge Function, and tracks
 * per-company sending state in a Map.
 *
 * @official 2026-04-01
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { QBOInvoiceLogEntry } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseQBOInvoicesResult {
  /** All invoice log entries */
  invoiceLog: QBOInvoiceLogEntry[];
  /** Initial data loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Map of companies currently being sent, keyed by "{companyId}-{year}-{month}" */
  sendingCompanies: Map<string, boolean>;
  /** Send a single invoice to QBO */
  sendInvoice: (companyId: string, year: number, month: number, eomReportId?: string) => Promise<boolean>;
  /** Send invoices for all provided companies sequentially (QBO rate limit safety) */
  sendAllForMonth: (year: number, month: number, companies: Array<{ companyId: string; eomReportId?: string }>, onProgress?: (current: number, total: number) => void) => Promise<void>;
  /** Get the most recent invoice status for a company-month */
  getInvoiceStatus: (companyId: string, year: number, month: number) => QBOInvoiceLogEntry | undefined;
  /** Clear the current error */
  clearError: () => void;
  /** Re-fetch invoice log from the database */
  refetch: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

function invoiceKey(companyId: string, year: number, month: number): string {
  return `${companyId}-${year}-${month}`;
}

/**
 * Extract meaningful error from a Supabase Edge Function error response.
 * Mirrors the pattern from useQBOConnection / useQBOCustomerMappings.
 */
async function extractFnError(fnError: { message?: string; context?: Response }): Promise<string> {
  if (fnError.context && typeof fnError.context.json === 'function') {
    try {
      const body = await fnError.context.json();
      return body?.error || body?.message || fnError.message || 'Unknown error';
    } catch { /* fall through */ }
  }
  return fnError.message || 'Unknown error';
}

// ============================================================================
// HOOK
// ============================================================================

export function useQBOInvoices(): UseQBOInvoicesResult {
  const [invoiceLog, setInvoiceLog] = useState<QBOInvoiceLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingCompanies, setSendingCompanies] = useState<Map<string, boolean>>(new Map());

  // ---- Fetch invoice log from Supabase ----
  const fetchInvoiceLog = useCallback(async (isInitial = false) => {
    if (isInitial) setIsLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('qbo_invoice_log')
        .select('*')
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;

      setInvoiceLog((data as QBOInvoiceLogEntry[]) || []);
    } catch (err) {
      console.error('Error fetching QBO invoice log:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch QBO invoice log');
    } finally {
      if (isInitial) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoiceLog(true);
  }, [fetchInvoiceLog]);

  // ---- Clear error ----
  const clearError = useCallback(() => setError(null), []);

  // ---- Build a lookup map for fast status retrieval ----
  const invoiceLookup = useMemo(() => {
    const map = new Map<string, QBOInvoiceLogEntry>();
    // invoiceLog is sorted newest-first; only keep the most recent per key
    for (const entry of invoiceLog) {
      const key = invoiceKey(entry.company_id, entry.report_year, entry.report_month);
      if (!map.has(key)) {
        map.set(key, entry);
      }
    }
    return map;
  }, [invoiceLog]);

  // ---- Get invoice status for a company-month ----
  const getInvoiceStatus = useCallback((
    companyId: string,
    year: number,
    month: number,
  ): QBOInvoiceLogEntry | undefined => {
    return invoiceLookup.get(invoiceKey(companyId, year, month));
  }, [invoiceLookup]);

  // ---- Send a single invoice ----
  const sendInvoice = useCallback(async (
    companyId: string,
    year: number,
    month: number,
    eomReportId?: string,
  ): Promise<boolean> => {
    const key = invoiceKey(companyId, year, month);
    setSendingCompanies(prev => new Map(prev).set(key, true));
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('qbo-create-invoice', {
        body: { companyId, year, month, eomReportId },
      });

      if (fnError) throw new Error(await extractFnError(fnError));
      if (data?.error) throw new Error(data.error);

      // Refresh log to show updated status
      await fetchInvoiceLog();
      return true;
    } catch (err) {
      console.error('Error sending QBO invoice:', err);
      setError(err instanceof Error ? err.message : 'Failed to send invoice to QuickBooks');
      // Still refresh to capture any error status written to the log
      await fetchInvoiceLog();
      return false;
    } finally {
      setSendingCompanies(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, [fetchInvoiceLog]);

  // ---- Send all invoices for a month (sequential for QBO rate limit safety) ----
  const sendAllForMonth = useCallback(async (
    year: number,
    month: number,
    companies: Array<{ companyId: string; eomReportId?: string }>,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> => {
    setError(null);

    // Mark all as sending
    setSendingCompanies(prev => {
      const next = new Map(prev);
      for (const { companyId } of companies) {
        next.set(invoiceKey(companyId, year, month), true);
      }
      return next;
    });

    try {
      const total = companies.length;
      // Send sequentially to respect QBO rate limits
      for (let i = 0; i < companies.length; i++) {
        const { companyId, eomReportId } = companies[i];
        onProgress?.(i + 1, total);

        try {
          const { data, error: fnError } = await supabase.functions.invoke('qbo-create-invoice', {
            body: { companyId, year, month, eomReportId },
          });

          if (fnError) {
            const message = await extractFnError(fnError);
            console.error(`Error sending invoice for ${companyId}:`, message);
          } else if (data?.error) {
            console.error(`Error sending invoice for ${companyId}:`, data.error);
          }
        } catch (err) {
          console.error(`Error sending invoice for ${companyId}:`, err);
        }

        // Clear this company's sending state as it completes
        setSendingCompanies(prev => {
          const next = new Map(prev);
          next.delete(invoiceKey(companyId, year, month));
          return next;
        });
      }

      // Refresh once at the end
      await fetchInvoiceLog();
    } catch (err) {
      console.error('Error in sendAllForMonth:', err);
      setError(err instanceof Error ? err.message : 'Failed to send invoices');
      // Clear all sending states on unexpected error
      setSendingCompanies(prev => {
        const next = new Map(prev);
        for (const { companyId } of companies) {
          next.delete(invoiceKey(companyId, year, month));
        }
        return next;
      });
      await fetchInvoiceLog();
    }
  }, [fetchInvoiceLog]);

  return {
    invoiceLog,
    isLoading,
    error,
    sendingCompanies,
    sendInvoice,
    sendAllForMonth,
    getInvoiceStatus,
    clearError,
    refetch: fetchInvoiceLog,
  };
}

export default useQBOInvoices;
