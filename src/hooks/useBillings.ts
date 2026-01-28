import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type {
  DateRange,
  BillingWithTransactionRow,
  BillingDisplay,
  CompanyBillingsGroup,
  TransactionType,
} from '../types';

/**
 * Parse a money string to cents (integer).
 * Handles formats: "1234", "1234.5", "1234.56", "1,234.56"
 * Returns null if invalid.
 *
 * IMPORTANT: No float arithmetic - uses string manipulation only.
 */
export function parseMoneyToCents(input: string): number | null {
  // Remove whitespace and commas
  const cleaned = input.trim().replace(/,/g, '').replace(/\s/g, '');

  // Reject empty string
  if (!cleaned) return null;

  // Reject invalid characters (allow digits and one decimal point)
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) {
    return null;
  }

  // Split on decimal point
  const parts = cleaned.split('.');
  const wholePart = parts[0] || '0';
  let decimalPart = parts[1] || '';

  // Pad decimal part to 2 digits
  decimalPart = decimalPart.padEnd(2, '0');

  // Convert to cents (integer math only)
  const dollars = parseInt(wholePart, 10);
  const cents = parseInt(decimalPart, 10);

  if (isNaN(dollars) || isNaN(cents)) return null;

  return dollars * 100 + cents;
}

/**
 * Format cents to currency display string.
 */
export function formatCentsToDisplay(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

/**
 * Format a Date to ISO date string (YYYY-MM-DD).
 * Uses local date to avoid timezone issues.
 */
function formatDateAsISO(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Normalize a date to first of month.
 */
function normalizeToFirstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

interface UseBillingsOptions {
  dateRange: DateRange;
}

interface UseBillingsReturn {
  /** Companies with their billings grouped for accordion display */
  companyBillings: CompanyBillingsGroup[];
  /** Total revenue from all billings in range (in cents) */
  totalCents: number;
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Create a new billing */
  createBilling: (
    companyId: string,
    name: string,
    type: TransactionType,
    linkedProjectId?: string
  ) => Promise<string | null>;
  /** Update a billing */
  updateBilling: (
    billingId: string,
    updates: {
      name?: string;
      companyId?: string;
      type?: TransactionType;
      linkedProjectId?: string | null;
      clearLinkedProject?: boolean;
    }
  ) => Promise<boolean>;
  /** Delete a billing */
  deleteBilling: (billingId: string) => Promise<boolean>;
  /** Create a transaction */
  createTransaction: (
    billingId: string,
    transactionMonth: Date,
    amountCents: number,
    description: string
  ) => Promise<string | null>;
  /** Update a transaction */
  updateTransaction: (
    transactionId: string,
    updates: {
      transactionMonth?: Date;
      amountCents?: number;
      description?: string;
    }
  ) => Promise<boolean>;
  /** Delete a transaction */
  deleteTransaction: (transactionId: string) => Promise<boolean>;
  /** Refetch data */
  refetch: () => void;
}

/**
 * Hook to fetch and manage billings with transactions.
 */
export function useBillings({ dateRange }: UseBillingsOptions): UseBillingsReturn {
  const [rawData, setRawData] = useState<BillingWithTransactionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Fetch billings with transactions
  useEffect(() => {
    async function fetchBillings() {
      setIsLoading(true);
      setError(null);

      try {
        const startMonth = formatDateAsISO(normalizeToFirstOfMonth(dateRange.start));
        const endMonth = formatDateAsISO(normalizeToFirstOfMonth(dateRange.end));

        const { data, error: rpcError } = await supabase.rpc('get_billings_with_transactions', {
          p_start_month: startMonth,
          p_end_month: endMonth,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        setRawData((data as BillingWithTransactionRow[]) || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch billings');
        setRawData([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBillings();
  }, [dateRange.start, dateRange.end, refetchTrigger]);

  // Transform flat rows into nested structure
  const { companyBillings, totalCents } = useMemo(() => {
    const companyMap = new Map<string, CompanyBillingsGroup>();
    const billingMap = new Map<string, BillingDisplay>();

    for (const row of rawData) {
      // Get or create company
      if (!companyMap.has(row.company_id)) {
        companyMap.set(row.company_id, {
          companyId: row.company_id,
          companyClientId: row.company_client_id,
          companyName: row.company_display_name || row.company_name,
          billings: [],
          totalCents: 0,
        });
      }

      // Get or create billing (type and linkedProject are at billing level now)
      if (!billingMap.has(row.billing_id)) {
        const billing: BillingDisplay = {
          id: row.billing_id,
          companyId: row.company_id,
          companyName: row.company_display_name || row.company_name,
          name: row.billing_name,
          type: row.billing_type,
          linkedProjectId: row.linked_project_id,
          linkedProjectName: row.linked_project_name,
          transactions: [],
          totalCents: 0,
        };
        billingMap.set(row.billing_id, billing);
      }

      // Add transaction if present
      if (row.transaction_id && row.amount_cents !== null) {
        const billing = billingMap.get(row.billing_id)!;
        billing.transactions.push({
          id: row.transaction_id,
          transactionMonth: row.transaction_month!,
          amountCents: row.amount_cents,
          description: row.transaction_description || '',
        });
        billing.totalCents += row.amount_cents;
      }
    }

    // Group billings under companies and calculate totals
    for (const billing of billingMap.values()) {
      const company = companyMap.get(billing.companyId)!;
      company.billings.push(billing);
      company.totalCents += billing.totalCents;
    }

    // Sort companies by name, billings by name, transactions by month desc
    const companies = Array.from(companyMap.values()).sort((a, b) =>
      a.companyName.localeCompare(b.companyName)
    );

    for (const company of companies) {
      company.billings.sort((a, b) => a.name.localeCompare(b.name));
      for (const billing of company.billings) {
        billing.transactions.sort((a, b) =>
          b.transactionMonth.localeCompare(a.transactionMonth)
        );
      }
    }

    // Calculate grand total
    const total = companies.reduce((sum, c) => sum + c.totalCents, 0);

    return { companyBillings: companies, totalCents: total };
  }, [rawData]);

  // Refetch trigger
  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1);
  }, []);

  // Create billing (now includes type and linkedProjectId)
  const createBilling = useCallback(
    async (
      companyId: string,
      name: string,
      type: TransactionType,
      linkedProjectId?: string
    ): Promise<string | null> => {
      try {
        const { data, error: rpcError } = await supabase.rpc('create_billing', {
          p_company_id: companyId,
          p_name: name,
          p_type: type,
          p_linked_project_id: linkedProjectId || null,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        refetch();
        return data as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create billing');
        return null;
      }
    },
    [refetch]
  );

  // Update billing (now includes type and linkedProjectId)
  const updateBilling = useCallback(
    async (
      billingId: string,
      updates: {
        name?: string;
        companyId?: string;
        type?: TransactionType;
        linkedProjectId?: string | null;
        clearLinkedProject?: boolean;
      }
    ): Promise<boolean> => {
      try {
        const { error: rpcError } = await supabase.rpc('update_billing', {
          p_id: billingId,
          p_name: updates.name || null,
          p_company_id: updates.companyId || null,
          p_type: updates.type || null,
          p_linked_project_id: updates.linkedProjectId || null,
          p_clear_linked_project: updates.clearLinkedProject || false,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        refetch();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update billing');
        return false;
      }
    },
    [refetch]
  );

  // Delete billing
  const deleteBilling = useCallback(
    async (billingId: string): Promise<boolean> => {
      try {
        const { error: rpcError } = await supabase.rpc('delete_billing', {
          p_id: billingId,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        refetch();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete billing');
        return false;
      }
    },
    [refetch]
  );

  // Create transaction (simplified - no type or linkedProjectId)
  const createTransaction = useCallback(
    async (
      billingId: string,
      transactionMonth: Date,
      amountCents: number,
      description: string
    ): Promise<string | null> => {
      try {
        const monthStr = formatDateAsISO(normalizeToFirstOfMonth(transactionMonth));

        const { data, error: rpcError } = await supabase.rpc('create_billing_transaction', {
          p_billing_id: billingId,
          p_transaction_month: monthStr,
          p_amount_cents: amountCents,
          p_description: description,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        refetch();
        return data as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create transaction');
        return null;
      }
    },
    [refetch]
  );

  // Update transaction (simplified - no type or linkedProjectId)
  const updateTransaction = useCallback(
    async (
      transactionId: string,
      updates: {
        transactionMonth?: Date;
        amountCents?: number;
        description?: string;
      }
    ): Promise<boolean> => {
      try {
        const { error: rpcError } = await supabase.rpc('update_billing_transaction', {
          p_id: transactionId,
          p_transaction_month: updates.transactionMonth
            ? formatDateAsISO(normalizeToFirstOfMonth(updates.transactionMonth))
            : null,
          p_amount_cents: updates.amountCents ?? null,
          p_description: updates.description || null,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        refetch();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update transaction');
        return false;
      }
    },
    [refetch]
  );

  // Delete transaction
  const deleteTransaction = useCallback(
    async (transactionId: string): Promise<boolean> => {
      try {
        const { error: rpcError } = await supabase.rpc('delete_billing_transaction', {
          p_id: transactionId,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        refetch();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete transaction');
        return false;
      }
    },
    [refetch]
  );

  return {
    companyBillings,
    totalCents,
    isLoading,
    error,
    createBilling,
    updateBilling,
    deleteBilling,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    refetch,
  };
}
