import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, subMonths, startOfMonth } from 'date-fns';
import { supabase } from '../lib/supabase';
import { aggregateByProject, aggregateByResource } from '../utils/calculations';
import { aggregateEntriesByMonth } from '../utils/chartTransforms';
import type { TimesheetEntry, ProjectSummary, ResourceSummary, DateRange } from '../types';
import type { MonthlyAggregate } from '../types/charts';

interface ResourceRecord {
  external_label: string;
  first_name: string | null;
  last_name: string | null;
}

interface AssociationRecord {
  user_id: string;
  resource_id: string;
  source: string;
  resource: {
    first_name: string | null;
    last_name: string | null;
    external_label: string;
  } | null;
}

interface UseTimesheetDataOptions {
  /** Number of months before start date to fetch for historical charts */
  extendedMonths?: number;
}

interface UseTimesheetDataResult {
  entries: TimesheetEntry[];
  projects: ProjectSummary[];
  resources: ResourceSummary[];
  /** Monthly aggregates for line chart (only populated if extendedMonths > 0) */
  monthlyAggregates: MonthlyAggregate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTimesheetData(
  dateRange: DateRange,
  options: UseTimesheetDataOptions = {}
): UseTimesheetDataResult {
  const { extendedMonths = 0 } = options;
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [extendedEntries, setExtendedEntries] = useState<TimesheetEntry[]>([]);
  const [resourceRecords, setResourceRecords] = useState<ResourceRecord[]>([]);
  const [associationRecords, setAssociationRecords] = useState<AssociationRecord[]>([]);
  const [projectRates, setProjectRates] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Derive stable string keys for the date range
  const startDateStr = format(dateRange.start, 'yyyy-MM-dd');
  const endDateStr = format(dateRange.end, 'yyyy-MM-dd');

  // Calculate extended start date for historical charts
  const extendedStartDate = extendedMonths > 0
    ? format(startOfMonth(subMonths(dateRange.start, extendedMonths)), 'yyyy-MM-dd')
    : startDateStr;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch timesheet entries, resources, and project rates in parallel
      const entriesPromise = supabase
        .from('v_timesheet_entries')
        .select('*')
        .gte('work_date', startDateStr)
        .lte('work_date', endDateStr)
        .order('work_date', { ascending: false });

      const resourcesPromise = supabase
        .from('resources')
        .select('external_label, first_name, last_name');

      const projectsPromise = supabase
        .from('projects')
        .select('project_name, rate');

      // Fetch associations with their resource data for user_id -> displayName mapping
      const associationsPromise = supabase
        .from('resource_user_associations')
        .select(`
          user_id,
          resource_id,
          source,
          resource:resources(first_name, last_name, external_label)
        `);

      // If extended months requested, fetch historical entries too
      const extendedPromise = extendedMonths > 0
        ? supabase
            .from('v_timesheet_entries')
            .select('*')
            .gte('work_date', extendedStartDate)
            .lte('work_date', endDateStr)
            .order('work_date', { ascending: false })
        : null;

      const [entriesResult, resourcesResult, projectsResult, associationsResult, extendedResult] = await Promise.all([
        entriesPromise,
        resourcesPromise,
        projectsPromise,
        associationsPromise,
        extendedPromise,
      ]);

      if (entriesResult.error) {
        throw new Error(entriesResult.error.message);
      }
      if (resourcesResult.error) {
        throw new Error(resourcesResult.error.message);
      }
      if (projectsResult.error) {
        throw new Error(projectsResult.error.message);
      }
      if (associationsResult.error) {
        throw new Error(associationsResult.error.message);
      }
      if (extendedResult?.error) {
        throw new Error(extendedResult.error.message);
      }

      setEntries(entriesResult.data || []);
      setResourceRecords(resourcesResult.data || []);
      setAssociationRecords(associationsResult.data || []);
      setExtendedEntries(extendedResult?.data || []);

      // Build project rates map
      const ratesMap = new Map<string, number>();
      for (const project of projectsResult.data || []) {
        if (project.rate !== null) {
          ratesMap.set(project.project_name, project.rate);
        }
      }
      setProjectRates(ratesMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [startDateStr, endDateStr, extendedMonths, extendedStartDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build display name lookup: user_name/external_label -> "first_name last_name"
  // Uses associations to map user_ids from different systems to the same display name
  const displayNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();

    // First, add external_label -> displayName from resources (existing behavior)
    for (const r of resourceRecords) {
      if (r.first_name || r.last_name) {
        const displayName = [r.first_name, r.last_name].filter(Boolean).join(' ');
        lookup.set(r.external_label, displayName);
      }
    }

    // Then, add user_name from associations (for multi-system support)
    // This allows entries from different systems with different user_names
    // to be grouped under the same resource's display name
    for (const assoc of associationRecords) {
      const resource = assoc.resource;
      if (resource && (resource.first_name || resource.last_name)) {
        const displayName = [resource.first_name, resource.last_name].filter(Boolean).join(' ');
        // Map both the user_id and the external_label to this display name
        // (entries use user_name which often equals external_label)
        lookup.set(resource.external_label, displayName);
      }
    }

    return lookup;
  }, [resourceRecords, associationRecords]);

  // Build user_id -> displayName lookup for proper grouping
  // This maps timesheet entry user_ids to their resource's display name
  const userIdToDisplayNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();

    for (const assoc of associationRecords) {
      const resource = assoc.resource;
      if (resource) {
        const displayName = resource.first_name || resource.last_name
          ? [resource.first_name, resource.last_name].filter(Boolean).join(' ')
          : resource.external_label;
        lookup.set(assoc.user_id, displayName);
      }
    }

    return lookup;
  }, [associationRecords]);

  const projects = useMemo(
    () => aggregateByProject(entries, displayNameLookup, userIdToDisplayNameLookup),
    [entries, displayNameLookup, userIdToDisplayNameLookup]
  );
  const resources = useMemo(
    () => aggregateByResource(entries, displayNameLookup, userIdToDisplayNameLookup),
    [entries, displayNameLookup, userIdToDisplayNameLookup]
  );

  // Calculate monthly aggregates for line chart (uses extended entries if available)
  const monthlyAggregates = useMemo(
    () => aggregateEntriesByMonth(extendedEntries.length > 0 ? extendedEntries : entries, projectRates),
    [extendedEntries, entries, projectRates]
  );

  return {
    entries,
    projects,
    resources,
    monthlyAggregates,
    loading,
    error,
    refetch: fetchData,
  };
}
