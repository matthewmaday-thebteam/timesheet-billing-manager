import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { EmployeeTimeOff } from '../types';

interface UseTimeOffOptions {
  /** Start date for filtering (inclusive) */
  startDate?: Date;
  /** End date for filtering (inclusive) */
  endDate?: Date;
  /** Only include approved time-off */
  approvedOnly?: boolean;
}

interface UseTimeOffResult {
  timeOff: EmployeeTimeOff[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch employee time-off records.
 * Filters by date range and optionally by approval status.
 */
export function useTimeOff(options: UseTimeOffOptions = {}): UseTimeOffResult {
  const { startDate, endDate, approvedOnly = true } = options;

  const [timeOff, setTimeOff] = useState<EmployeeTimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  useEffect(() => {
    async function fetchTimeOff() {
      setLoading(true);
      setError(null);

      try {
        let query = supabase
          .from('employee_time_off')
          .select('*');

        // Filter by status if approvedOnly
        if (approvedOnly) {
          query = query.eq('status', 'approved');
        }

        // Filter by date range - time off overlaps with the period
        if (startDate) {
          const startStr = formatDateLocal(startDate);
          query = query.lte('start_date', endDate ? formatDateLocal(endDate) : startStr);
        }
        if (endDate) {
          const endStr = formatDateLocal(endDate);
          query = query.gte('end_date', startDate ? formatDateLocal(startDate) : endStr);
        }

        query = query.order('start_date', { ascending: true });

        const { data, error: fetchError } = await query;

        if (fetchError) {
          throw fetchError;
        }

        setTimeOff(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch time-off data');
        setTimeOff([]);
      } finally {
        setLoading(false);
      }
    }

    fetchTimeOff();
  }, [startDate?.toISOString(), endDate?.toISOString(), approvedOnly, refetchTrigger]);

  const refetch = () => setRefetchTrigger((n) => n + 1);

  return { timeOff, loading, error, refetch };
}

/**
 * Format a Date to YYYY-MM-DD string in local timezone.
 */
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default useTimeOff;
