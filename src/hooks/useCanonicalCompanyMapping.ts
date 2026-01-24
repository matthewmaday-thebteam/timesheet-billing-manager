import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface CanonicalCompanyInfo {
  /** The canonical (primary) company's ID */
  canonicalCompanyId: string;
  /** The canonical company's display name (or client_name if no display_name) */
  canonicalDisplayName: string;
  /** The canonical company's client_id */
  canonicalClientId: string;
  /** Role of this company: 'primary', 'member', or 'unassociated' */
  role: 'primary' | 'member' | 'unassociated';
}

interface UseCanonicalCompanyMappingResult {
  /**
   * Get the canonical company info for a given client_id.
   * Returns the primary company's info if this client is part of a group,
   * or the company's own info if unassociated.
   */
  getCanonicalCompany: (clientId: string | null) => CanonicalCompanyInfo | null;
  /**
   * Map from client_id to canonical company info.
   * Useful for batch operations.
   */
  mappingByClientId: Map<string, CanonicalCompanyInfo>;
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refetch data */
  refetch: () => void;
}

interface CompanyRecord {
  id: string;
  client_id: string;
  client_name: string;
  display_name: string | null;
}

interface CanonicalMappingRecord {
  company_id: string;
  canonical_company_id: string;
  role: string;
}

/**
 * Hook to fetch canonical company mapping.
 * Maps each company (by client_id) to its canonical (primary) company.
 * Used for aggregating data by canonical company in reports.
 */
export function useCanonicalCompanyMapping(): UseCanonicalCompanyMappingResult {
  const [mappingByClientId, setMappingByClientId] = useState<Map<string, CanonicalCompanyInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch companies and canonical mapping separately (view joins don't work reliably)
      const [companiesResult, canonicalResult] = await Promise.all([
        supabase
          .from('companies')
          .select('id, client_id, client_name, display_name'),
        supabase
          .from('v_company_canonical')
          .select('company_id, canonical_company_id, role'),
      ]);

      if (companiesResult.error) {
        throw new Error(companiesResult.error.message);
      }
      if (canonicalResult.error) {
        throw new Error(canonicalResult.error.message);
      }

      const companies = (companiesResult.data || []) as CompanyRecord[];
      const canonicalMappings = (canonicalResult.data || []) as CanonicalMappingRecord[];

      // Build company_id (UUID) -> company details lookup
      const companyById = new Map<string, CompanyRecord>();
      for (const company of companies) {
        companyById.set(company.id, company);
      }

      // Build client_id -> canonical company info mapping
      const mapping = new Map<string, CanonicalCompanyInfo>();

      for (const row of canonicalMappings) {
        const company = companyById.get(row.company_id);
        const canonicalCompany = companyById.get(row.canonical_company_id);

        if (!company || !canonicalCompany) continue;

        const info: CanonicalCompanyInfo = {
          canonicalCompanyId: canonicalCompany.id,
          canonicalDisplayName: canonicalCompany.display_name || canonicalCompany.client_name,
          canonicalClientId: canonicalCompany.client_id,
          role: row.role as 'primary' | 'member' | 'unassociated',
        };

        // Map by the original company's client_id
        mapping.set(company.client_id, info);
      }

      setMappingByClientId(mapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch canonical company mapping');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getCanonicalCompany = useCallback((clientId: string | null): CanonicalCompanyInfo | null => {
    if (!clientId) return null;
    return mappingByClientId.get(clientId) || null;
  }, [mappingByClientId]);

  return {
    getCanonicalCompany,
    mappingByClientId,
    loading,
    error,
    refetch: fetchData,
  };
}
