import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { aggregateByProject, aggregateByResource } from '../utils/calculations';
import type { TimesheetEntry, ProjectSummary, ResourceSummary, DateRange } from '../types';

interface UseTimesheetDataResult {
  entries: TimesheetEntry[];
  projects: ProjectSummary[];
  resources: ResourceSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTimesheetData(dateRange: DateRange): UseTimesheetDataResult {
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const startDate = format(dateRange.start, 'yyyy-MM-dd');
      const endDate = format(dateRange.end, 'yyyy-MM-dd');

      const { data, error: queryError } = await supabase
        .from('timesheet_daily_rollups')
        .select('*')
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .order('work_date', { ascending: false });

      if (queryError) {
        throw new Error(queryError.message);
      }

      setEntries(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange.start.getTime(), dateRange.end.getTime()]);

  const projects = aggregateByProject(entries);
  const resources = aggregateByResource(entries);

  return {
    entries,
    projects,
    resources,
    loading,
    error,
    refetch: fetchData,
  };
}
