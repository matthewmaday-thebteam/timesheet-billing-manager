import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { EmploymentType } from '../types';

interface UseEmploymentTypesResult {
  employmentTypes: EmploymentType[];
  loading: boolean;
  error: string | null;
  getEmploymentTypeById: (id: string) => EmploymentType | undefined;
  getDefaultEmploymentTypeId: () => string | undefined;
}

export function useEmploymentTypes(): UseEmploymentTypesResult {
  const [employmentTypes, setEmploymentTypes] = useState<EmploymentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEmploymentTypes() {
      try {
        const { data, error: queryError } = await supabase
          .from('employment_types')
          .select('*')
          .order('name');

        if (queryError) throw new Error(queryError.message);
        setEmploymentTypes(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch employment types');
      } finally {
        setLoading(false);
      }
    }

    fetchEmploymentTypes();
  }, []);

  const getEmploymentTypeById = (id: string) =>
    employmentTypes.find(et => et.id === id);

  const getDefaultEmploymentTypeId = () =>
    employmentTypes.find(et => et.name === 'Full-time')?.id;

  return {
    employmentTypes,
    loading,
    error,
    getEmploymentTypeById,
    getDefaultEmploymentTypeId,
  };
}
