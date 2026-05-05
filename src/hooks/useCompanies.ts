import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type {
  Company,
  CompanyWithGrouping,
  CompanyFormData,
  CompanyGroupRole,
} from '../types';

interface UseCompaniesResult {
  /** Companies filtered for Companies table (excludes members) */
  companies: CompanyWithGrouping[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refetch data */
  refetch: () => void;
  /** Update a company */
  updateCompany: (id: string, data: CompanyFormData) => Promise<boolean>;
  /** Create a new manually-originated company */
  createCompany: (displayName: string, clientName?: string) => Promise<Company | null>;
  /** Whether an update is in progress */
  isUpdating: boolean;
}

/**
 * Hook to fetch company table entities with grouping information.
 * Returns only companies that should appear in the Companies table:
 * - Unassociated companies
 * - Primary companies (with their member counts)
 * Excludes member companies.
 */
export function useCompanies(): UseCompaniesResult {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [groupingData, setGroupingData] = useState<Map<string, {
    role: CompanyGroupRole;
    groupId: string | null;
    memberCount: number;
    projectCount: number;
  }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch from the view that filters out members
      const { data: viewData, error: viewError } = await supabase
        .from('v_company_table_entities')
        .select('*')
        .order('client_name', { ascending: true });

      if (viewError) {
        throw new Error(viewError.message);
      }

      // Parse the view data
      const companyList: Company[] = [];
      const groupingMap = new Map<string, {
        role: CompanyGroupRole;
        groupId: string | null;
        memberCount: number;
        projectCount: number;
      }>();

      for (const row of viewData || []) {
        const company: Company = {
          id: row.id,
          client_id: row.client_id,
          client_name: row.client_name,
          display_name: row.display_name,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };

        companyList.push(company);

        groupingMap.set(row.id, {
          role: (row.grouping_role || 'unassociated') as CompanyGroupRole,
          groupId: row.group_id,
          memberCount: row.member_count || 0,
          projectCount: row.project_count || 0,
        });
      }

      setCompanies(companyList);
      setGroupingData(groupingMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch company data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build the final entities with grouping info
  const companiesWithGrouping = useMemo((): CompanyWithGrouping[] => {
    return companies.map(company => {
      const groupInfo = groupingData.get(company.id) || {
        role: 'unassociated' as CompanyGroupRole,
        groupId: null,
        memberCount: 0,
        projectCount: 0,
      };

      return {
        ...company,
        grouping_role: groupInfo.role,
        group_id: groupInfo.groupId,
        member_count: groupInfo.memberCount,
        project_count: groupInfo.projectCount,
      };
    });
  }, [companies, groupingData]);

  const updateCompany = useCallback(async (
    id: string,
    data: CompanyFormData
  ): Promise<boolean> => {
    setIsUpdating(true);

    const previousCompanies = [...companies];

    // Optimistic update
    setCompanies(prev =>
      prev.map(c =>
        c.id === id
          ? {
              ...c,
              display_name: data.display_name || null,
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );

    try {
      const { error: updateError } = await supabase
        .from('companies')
        .update({
          display_name: data.display_name || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        setCompanies(previousCompanies);
        throw new Error(updateError.message);
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update company');
      return false;
    } finally {
      setIsUpdating(false);
    }
  }, [companies]);

  const createCompany = useCallback(async (
    displayName: string,
    clientName?: string
  ): Promise<Company | null> => {
    setIsUpdating(true);
    setError(null);

    const previousCompanies = [...companies];
    const previousGrouping = new Map(groupingData);

    const trimmedDisplayName = displayName.trim();
    const trimmedClientName = clientName?.trim() || trimmedDisplayName;
    const clientId = 'manual_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

    try {
      const { data, error: insertError } = await supabase
        .from('companies')
        .insert({
          client_id: clientId,
          client_name: trimmedClientName,
          display_name: trimmedDisplayName,
          manual_origin: true,
        })
        .select('*')
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      const created: Company = {
        id: data.id,
        client_id: data.client_id,
        client_name: data.client_name,
        display_name: data.display_name,
        created_at: data.created_at,
        updated_at: data.updated_at,
        manual_origin: data.manual_origin,
      };

      setCompanies(prev => [...prev, created]);
      setGroupingData(prev => {
        const next = new Map(prev);
        next.set(created.id, {
          role: 'unassociated',
          groupId: null,
          memberCount: 0,
          projectCount: 0,
        });
        return next;
      });

      return created;
    } catch (err) {
      setCompanies(previousCompanies);
      setGroupingData(previousGrouping);
      setError(err instanceof Error ? err.message : 'Failed to create company');
      return null;
    } finally {
      setIsUpdating(false);
    }
  }, [companies, groupingData]);

  return {
    companies: companiesWithGrouping,
    loading,
    error,
    refetch: fetchData,
    updateCompany,
    createCompany,
    isUpdating,
  };
}
