import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  CompanyGroupRole,
  CompanyGroupMemberDisplay,
  CompanyGroupGetResult,
  UnassociatedCompany,
} from '../types';

interface UseCompanyGroupResult {
  /** Company's role in the grouping system */
  role: CompanyGroupRole;
  /** Group ID if this company is a primary (null otherwise) */
  groupId: string | null;
  /** Member companies if this company is a primary */
  members: CompanyGroupMemberDisplay[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refetch group data */
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch company group data for a specific company.
 * Returns the company's role (primary/member/unassociated) and its group members if primary.
 */
export function useCompanyGroup(companyId: string | null): UseCompanyGroupResult {
  const [role, setRole] = useState<CompanyGroupRole>('unassociated');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<CompanyGroupMemberDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroupData = useCallback(async () => {
    if (!companyId) {
      setRole('unassociated');
      setGroupId(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_company_group_get', {
        p_company_id: companyId,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const result = data as CompanyGroupGetResult;

      if (result && result.success) {
        setRole(result.role);
        setGroupId(result.group_id);

        // Parse members from the result
        if (result.members && Array.isArray(result.members)) {
          const memberList: CompanyGroupMemberDisplay[] = result.members.map((m) => ({
            member_company_id: m.member_company_id,
            client_id: m.client_id,
            client_name: m.client_name,
            display_name: m.display_name,
            added_at: m.added_at,
          }));
          setMembers(memberList);
        } else {
          setMembers([]);
        }
      } else {
        // No group data - company is unassociated
        setRole('unassociated');
        setGroupId(null);
        setMembers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch group data');
      // Set defaults on error
      setRole('unassociated');
      setGroupId(null);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchGroupData();
  }, [fetchGroupData]);

  return {
    role,
    groupId,
    members,
    loading,
    error,
    refetch: fetchGroupData,
  };
}

interface UseUnassociatedCompaniesResult {
  /** List of unassociated companies available for grouping */
  companies: UnassociatedCompany[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Fetch/refresh the list */
  fetch: (excludeCompanyId?: string) => Promise<void>;
}

/**
 * Hook to fetch companies available for adding to a group.
 * Only returns unassociated companies (not already a primary or member).
 */
export function useUnassociatedCompanies(): UseUnassociatedCompaniesResult {
  const [companies, setCompanies] = useState<UnassociatedCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanies = useCallback(async (excludeCompanyId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_list_unassociated_companies', {
        p_exclude_company_id: excludeCompanyId || null,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const companyList: UnassociatedCompany[] = (data || []).map((c: {
        company_id: string;
        client_id: string;
        client_name: string;
        display_name: string;
      }) => ({
        company_id: c.company_id,
        client_id: c.client_id,
        client_name: c.client_name,
        display_name: c.display_name || c.client_name,
      }));

      setCompanies(companyList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch unassociated companies');
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    companies,
    loading,
    error,
    fetch: fetchCompanies,
  };
}
