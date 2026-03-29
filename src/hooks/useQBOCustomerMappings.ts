/**
 * useQBOCustomerMappings - QuickBooks Online customer mapping hook
 *
 * Manages the mapping between Manifest companies and QBO customers.
 * Fetches existing mappings from Supabase, provides CRUD operations,
 * and calls the qbo-customers Edge Function to retrieve the QBO
 * customer list.
 *
 * @official 2026-03-29
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { QBOCustomer, QBOCustomerMapping } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseQBOCustomerMappingsResult {
  /** All existing company-to-QBO-customer mappings */
  mappings: QBOCustomerMapping[];
  /** Initial data loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Fetch QBO customers from the Edge Function */
  fetchQBOCustomers: () => Promise<QBOCustomer[]>;
  /** Upsert a mapping (company_id is the natural key) */
  saveMapping: (companyId: string, qboCustomerId: string, qboCustomerName: string) => Promise<boolean>;
  /** Remove a mapping for a company */
  removeMapping: (companyId: string) => Promise<boolean>;
  /** Get the mapping for a specific company (or undefined) */
  getMappingForCompany: (companyId: string) => QBOCustomerMapping | undefined;
  /** Re-fetch mappings from the database */
  refetch: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract meaningful error from a Supabase Edge Function error response.
 * Mirrors the pattern from useQBOConnection / useEOMReports.
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

export function useQBOCustomerMappings(): UseQBOCustomerMappingsResult {
  const [mappings, setMappings] = useState<QBOCustomerMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Fetch existing mappings from Supabase ----
  const fetchMappings = useCallback(async (isInitial = false) => {
    if (isInitial) setIsLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('qbo_customer_mappings')
        .select('*')
        .order('created_at', { ascending: true });

      if (queryError) throw queryError;

      setMappings((data as QBOCustomerMapping[]) || []);
    } catch (err) {
      console.error('Error fetching QBO customer mappings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch QBO customer mappings');
    } finally {
      if (isInitial) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMappings(true);
  }, [fetchMappings]);

  // ---- Fetch QBO customers from Edge Function ----
  const fetchQBOCustomers = useCallback(async (): Promise<QBOCustomer[]> => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke('qbo-customers', {
        body: {},
      });

      if (fnError) throw new Error(await extractFnError(fnError));

      return (data?.customers as QBOCustomer[]) || [];
    } catch (err) {
      console.error('Error fetching QBO customers:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch QBO customers';
      setError(message);
      return [];
    }
  }, []);

  // ---- Save (upsert) a mapping ----
  const saveMapping = useCallback(async (
    companyId: string,
    qboCustomerId: string,
    qboCustomerName: string,
  ): Promise<boolean> => {
    setError(null);

    try {
      const { error: upsertError } = await supabase
        .from('qbo_customer_mappings')
        .upsert(
          {
            company_id: companyId,
            qbo_customer_id: qboCustomerId,
            qbo_customer_name: qboCustomerName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'company_id' }
        );

      if (upsertError) throw upsertError;

      // Refresh local state
      await fetchMappings();
      return true;
    } catch (err) {
      console.error('Error saving QBO customer mapping:', err);
      setError(err instanceof Error ? err.message : 'Failed to save QBO customer mapping');
      return false;
    }
  }, [fetchMappings]);

  // ---- Remove a mapping ----
  const removeMapping = useCallback(async (companyId: string): Promise<boolean> => {
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('qbo_customer_mappings')
        .delete()
        .eq('company_id', companyId);

      if (deleteError) throw deleteError;

      // Refresh local state
      await fetchMappings();
      return true;
    } catch (err) {
      console.error('Error removing QBO customer mapping:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove QBO customer mapping');
      return false;
    }
  }, [fetchMappings]);

  // ---- Get mapping for a specific company ----
  const getMappingForCompany = useCallback((companyId: string): QBOCustomerMapping | undefined => {
    return mappings.find(m => m.company_id === companyId);
  }, [mappings]);

  return {
    mappings,
    isLoading,
    error,
    fetchQBOCustomers,
    saveMapping,
    removeMapping,
    getMappingForCompany,
    refetch: fetchMappings,
  };
}

export default useQBOCustomerMappings;
