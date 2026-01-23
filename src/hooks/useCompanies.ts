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

  return {
    companies: companiesWithGrouping,
    loading,
    error,
    refetch: fetchData,
    updateCompany,
    isUpdating,
  };
}
