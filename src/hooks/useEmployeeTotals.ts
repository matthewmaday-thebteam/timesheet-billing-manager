import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import type { EmployeeTotal, DateRange } from '../types';

// ── Local types for canonical user resolution ────────────────────────────

interface AssociationRecord {
  user_id: string;
  resource_id: string;
  resource: {
    first_name: string | null;
    last_name: string | null;
    external_label: string;
  } | null;
}

interface ResourceRecord {
  id: string;
  external_label: string;
  first_name: string | null;
  last_name: string | null;
}

interface CanonicalMappingRecord {
  entity_id: string;
  canonical_entity_id: string;
}

interface ProjectCanonicalRecord {
  project_id: string;
  canonical_project_id: string;
  role: string;
}

interface ProjectRecord {
  id: string;
  project_id: string;
}

// ── Return type ──────────────────────────────────────────────────────────

interface UseEmployeeTotalsResult {
  rows: EmployeeTotal[];
  userIdToDisplayNameLookup: Map<string, string>;
  projectCanonicalIdLookup: Map<string, string>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch employee_totals (Layer 2) and build canonical lookups
 * for resolving user_id -> display name and project_id -> canonical project ID.
 *
 * All queries run in parallel for performance.
 */
export function useEmployeeTotals(
  dateRange: DateRange,
): UseEmployeeTotalsResult {
  const [rows, setRows] = useState<EmployeeTotal[]>([]);
  const [associationRecords, setAssociationRecords] = useState<AssociationRecord[]>([]);
  const [resourceRecords, setResourceRecords] = useState<ResourceRecord[]>([]);
  const [canonicalMappings, setCanonicalMappings] = useState<CanonicalMappingRecord[]>([]);
  const [projectCanonicalRecords, setProjectCanonicalRecords] = useState<ProjectCanonicalRecord[]>([]);
  const [projectRecords, setProjectRecords] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startDateStr = format(dateRange.start, 'yyyy-MM-dd');
  const endDateStr = format(dateRange.end, 'yyyy-MM-dd');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Query 1: Fetch employee_totals for the date range
      const totalsPromise = supabase
        .from('employee_totals')
        .select('*')
        .gte('work_date', startDateStr)
        .lte('work_date', endDateStr);

      // Query 2a: Fetch resource_user_associations with resource data
      const associationsPromise = supabase
        .from('resource_user_associations')
        .select(`
          user_id,
          resource_id,
          resource:resources(first_name, last_name, external_label)
        `);

      // Query 2b: Fetch resources for display name resolution
      const resourcesPromise = supabase
        .from('resources')
        .select('id, external_label, first_name, last_name');

      // Query 2c: Fetch canonical entity mapping
      const canonicalPromise = supabase
        .from('v_entity_canonical')
        .select('entity_id, canonical_entity_id');

      // Query 3a: Fetch project canonical mapping
      const projectCanonicalPromise = supabase
        .from('v_project_canonical')
        .select('project_id, canonical_project_id, role');

      // Query 3b: Fetch projects for UUID -> external ID mapping
      const projectsPromise = supabase
        .from('projects')
        .select('id, project_id');

      const [
        totalsResult,
        associationsResult,
        resourcesResult,
        canonicalResult,
        projectCanonicalResult,
        projectsResult,
      ] = await Promise.all([
        totalsPromise,
        associationsPromise,
        resourcesPromise,
        canonicalPromise,
        projectCanonicalPromise,
        projectsPromise,
      ]);

      if (totalsResult.error) {
        throw new Error(totalsResult.error.message);
      }
      if (associationsResult.error) {
        throw new Error(associationsResult.error.message);
      }
      if (resourcesResult.error) {
        throw new Error(resourcesResult.error.message);
      }
      // Canonical mapping is optional
      if (canonicalResult.error && !canonicalResult.error.message.includes('does not exist')) {
        console.warn('Failed to fetch canonical mapping:', canonicalResult.error.message);
      }
      if (projectCanonicalResult.error) {
        console.warn('Failed to fetch project canonical mapping:', projectCanonicalResult.error.message);
      }
      if (projectsResult.error) {
        throw new Error(projectsResult.error.message);
      }

      setRows(totalsResult.data || []);
      setResourceRecords(resourcesResult.data || []);
      setProjectCanonicalRecords(projectCanonicalResult.data || []);
      setProjectRecords(projectsResult.data || []);

      // Normalize association data — Supabase may return resource as array
      const normalized: AssociationRecord[] = (associationsResult.data || []).map((assoc) => ({
        user_id: assoc.user_id,
        resource_id: assoc.resource_id,
        resource: Array.isArray(assoc.resource) ? assoc.resource[0] || null : assoc.resource,
      }));
      setAssociationRecords(normalized);
      setCanonicalMappings(canonicalResult.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch employee totals');
    } finally {
      setLoading(false);
    }
  }, [startDateStr, endDateStr]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build canonical entity mapping: resource_id -> canonical_resource_id
  const canonicalEntityMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const mapping of canonicalMappings) {
      map.set(mapping.entity_id, mapping.canonical_entity_id);
    }
    return map;
  }, [canonicalMappings]);

  // Build resource_id -> display name lookup
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

  // Build user_id -> canonical display name lookup
  // Mirrors the exact logic from useTimesheetData/useEmployeeDailyTotals
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

  // Build project UUID -> project details lookup
  const projectByUuid = useMemo(() => {
    const map = new Map<string, ProjectRecord>();
    for (const project of projectRecords) {
      map.set(project.id, project);
    }
    return map;
  }, [projectRecords]);

  // Build project canonical ID lookup: external project_id -> canonical external project_id
  // This maps member project IDs to their primary project's external ID for billing lookups
  const projectCanonicalIdLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const record of projectCanonicalRecords) {
      const project = projectByUuid.get(record.project_id);
      const canonicalProject = projectByUuid.get(record.canonical_project_id);

      if (!project || !canonicalProject) continue;

      // Map external project_id to canonical project's external ID
      lookup.set(project.project_id, canonicalProject.project_id);
    }
    return lookup;
  }, [projectCanonicalRecords, projectByUuid]);

  return { rows, userIdToDisplayNameLookup, projectCanonicalIdLookup, loading, error };
}

export default useEmployeeTotals;
