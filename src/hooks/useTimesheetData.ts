import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, subMonths, startOfMonth } from 'date-fns';
import { supabase } from '../lib/supabase';
import { aggregateByProject, aggregateByResource } from '../utils/calculations';
import { aggregateEntriesByMonth } from '../utils/chartTransforms';
import type { TimesheetEntry, ProjectSummary, ResourceSummary, DateRange } from '../types';
import type { MonthlyAggregate } from '../types/charts';

interface ResourceRecord {
  id: string;
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

interface CanonicalMappingRecord {
  entity_id: string;
  canonical_entity_id: string;
  role: string;
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
  const [canonicalMappings, setCanonicalMappings] = useState<CanonicalMappingRecord[]>([]);
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
        .select('id, external_label, first_name, last_name');

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

      // Fetch canonical entity mapping for physical person grouping
      const canonicalPromise = supabase
        .from('v_entity_canonical')
        .select('entity_id, canonical_entity_id, role');

      // If extended months requested, fetch historical entries too
      const extendedPromise = extendedMonths > 0
        ? supabase
            .from('v_timesheet_entries')
            .select('*')
            .gte('work_date', extendedStartDate)
            .lte('work_date', endDateStr)
            .order('work_date', { ascending: false })
        : null;

      const [entriesResult, resourcesResult, projectsResult, associationsResult, canonicalResult, extendedResult] = await Promise.all([
        entriesPromise,
        resourcesPromise,
        projectsPromise,
        associationsPromise,
        canonicalPromise,
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
      // Canonical mapping is optional - don't fail if view doesn't exist yet
      if (canonicalResult.error && !canonicalResult.error.message.includes('does not exist')) {
        console.warn('Failed to fetch canonical mapping:', canonicalResult.error.message);
      }
      if (extendedResult?.error) {
        throw new Error(extendedResult.error.message);
      }

      setEntries(entriesResult.data || []);
      setResourceRecords(resourcesResult.data || []);
      // Transform association data - Supabase may return resource as array
      const normalizedAssociations: AssociationRecord[] = (associationsResult.data || []).map((assoc) => ({
        user_id: assoc.user_id,
        resource_id: assoc.resource_id,
        source: assoc.source,
        resource: Array.isArray(assoc.resource) ? assoc.resource[0] || null : assoc.resource,
      }));
      setAssociationRecords(normalizedAssociations);
      setCanonicalMappings(canonicalResult.data || []);
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

  // Build canonical entity mapping: resource_id -> canonical_resource_id
  // This allows grouped entities to be aggregated under the primary entity
  const canonicalEntityMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const mapping of canonicalMappings) {
      map.set(mapping.entity_id, mapping.canonical_entity_id);
    }
    return map;
  }, [canonicalMappings]);

  // Build resource_id -> displayName lookup
  const resourceDisplayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of resourceRecords) {
      const displayName = r.first_name || r.last_name
        ? [r.first_name, r.last_name].filter(Boolean).join(' ')
        : r.external_label;
      map.set(r.id, displayName);
    }
    return map;
  }, [resourceRecords]);

  // Build display name lookup: user_name/external_label -> "first_name last_name"
  // Uses associations and canonical mapping to aggregate grouped entities
  const displayNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();

    // First, add external_label -> displayName from resources
    // Use canonical entity's display name if the resource is grouped
    for (const r of resourceRecords) {
      if (r.first_name || r.last_name) {
        // Get canonical entity for this resource (or self if not grouped)
        const canonicalId = canonicalEntityMap.get(r.id) || r.id;
        const canonicalDisplayName = resourceDisplayNameMap.get(canonicalId);
        const displayName = canonicalDisplayName || [r.first_name, r.last_name].filter(Boolean).join(' ');
        lookup.set(r.external_label, displayName);
      }
    }

    // Then, add user_name from associations (for multi-system support)
    // This allows entries from different systems with different user_names
    // to be grouped under the same canonical entity's display name
    for (const assoc of associationRecords) {
      const resource = assoc.resource;
      if (resource && (resource.first_name || resource.last_name)) {
        // Get canonical entity for the associated resource
        const canonicalId = canonicalEntityMap.get(assoc.resource_id) || assoc.resource_id;
        const canonicalDisplayName = resourceDisplayNameMap.get(canonicalId);
        const displayName = canonicalDisplayName || [resource.first_name, resource.last_name].filter(Boolean).join(' ');
        lookup.set(resource.external_label, displayName);
      }
    }

    return lookup;
  }, [resourceRecords, associationRecords, canonicalEntityMap, resourceDisplayNameMap]);

  // Build user_id -> displayName lookup for proper grouping
  // This maps timesheet entry user_ids to their CANONICAL entity's display name
  // (so grouped entities' time entries are aggregated together)
  const userIdToDisplayNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();

    for (const assoc of associationRecords) {
      // Get canonical entity for this resource
      const canonicalId = canonicalEntityMap.get(assoc.resource_id) || assoc.resource_id;
      const canonicalDisplayName = resourceDisplayNameMap.get(canonicalId);

      if (canonicalDisplayName) {
        lookup.set(assoc.user_id, canonicalDisplayName);
      } else if (assoc.resource) {
        // Fallback to the resource's own display name
        const displayName = assoc.resource.first_name || assoc.resource.last_name
          ? [assoc.resource.first_name, assoc.resource.last_name].filter(Boolean).join(' ')
          : assoc.resource.external_label;
        lookup.set(assoc.user_id, displayName);
      }
    }

    return lookup;
  }, [associationRecords, canonicalEntityMap, resourceDisplayNameMap]);

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
