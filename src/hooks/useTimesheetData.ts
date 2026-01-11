import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { aggregateByProject, aggregateByResource } from '../utils/calculations';
import type { TimesheetEntry, ProjectSummary, ResourceSummary, DateRange } from '../types';

interface ResourceRecord {
  external_label: string;
  first_name: string | null;
  last_name: string | null;
}

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
  const [resourceRecords, setResourceRecords] = useState<ResourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Derive stable string keys for the date range
  const startDateStr = format(dateRange.start, 'yyyy-MM-dd');
  const endDateStr = format(dateRange.end, 'yyyy-MM-dd');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch timesheet entries and resources in parallel
      const [entriesResult, resourcesResult] = await Promise.all([
        supabase
          .from('v_timesheet_entries')
          .select('*')
          .gte('work_date', startDateStr)
          .lte('work_date', endDateStr)
          .order('work_date', { ascending: false }),
        supabase
          .from('resources')
          .select('external_label, first_name, last_name'),
      ]);

      if (entriesResult.error) {
        throw new Error(entriesResult.error.message);
      }
      if (resourcesResult.error) {
        throw new Error(resourcesResult.error.message);
      }

      setEntries(entriesResult.data || []);
      setResourceRecords(resourcesResult.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [startDateStr, endDateStr]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build display name lookup: external_label -> "first_name last_name"
  const displayNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const r of resourceRecords) {
      if (r.first_name || r.last_name) {
        const displayName = [r.first_name, r.last_name].filter(Boolean).join(' ');
        lookup.set(r.external_label, displayName);
      }
    }
    return lookup;
  }, [resourceRecords]);

  const projects = useMemo(
    () => aggregateByProject(entries, displayNameLookup),
    [entries, displayNameLookup]
  );
  const resources = useMemo(
    () => aggregateByResource(entries, displayNameLookup),
    [entries, displayNameLookup]
  );

  return {
    entries,
    projects,
    resources,
    loading,
    error,
    refetch: fetchData,
  };
}
