import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { BambooEmployee } from '../types';

interface UseBambooEmployeesResult {
  /** All BambooHR employees */
  employees: BambooEmployee[];
  /** BambooHR employees not yet assigned to any resource */
  availableEmployees: BambooEmployee[];
  /** Loading state */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refetch employees */
  refetch: () => void;
}

/**
 * Hook to fetch BambooHR employees and determine which are available for linking.
 * An employee is "available" if their bamboo_id is not already assigned to a resource.
 */
export function useBambooEmployees(): UseBambooEmployeesResult {
  const [employees, setEmployees] = useState<BambooEmployee[]>([]);
  const [assignedBambooIds, setAssignedBambooIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Fetch all bamboo employees
        const { data: bambooData, error: bambooError } = await supabase
          .from('bamboo_employees')
          .select('*')
          .order('last_name', { ascending: true });

        if (bambooError) throw bambooError;

        // Fetch all resources with bamboo_employee_id assigned
        const { data: resourcesData, error: resourcesError } = await supabase
          .from('resources')
          .select('bamboo_employee_id')
          .not('bamboo_employee_id', 'is', null);

        if (resourcesError) throw resourcesError;

        // Build set of assigned bamboo IDs
        const assigned = new Set<string>(
          (resourcesData || [])
            .map(r => r.bamboo_employee_id)
            .filter((id): id is string => id !== null)
        );

        setEmployees(bambooData || []);
        setAssignedBambooIds(assigned);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch BambooHR employees');
        setEmployees([]);
        setAssignedBambooIds(new Set());
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [refetchTrigger]);

  // Filter to only available (unassigned) employees
  const availableEmployees = useMemo(() => {
    return employees.filter(emp => !assignedBambooIds.has(emp.bamboo_id));
  }, [employees, assignedBambooIds]);

  const refetch = () => setRefetchTrigger(n => n + 1);

  return {
    employees,
    availableEmployees,
    loading,
    error,
    refetch,
  };
}

export default useBambooEmployees;
