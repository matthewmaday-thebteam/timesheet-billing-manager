import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import type { EmployeeDailyTotal, DateRange } from '../types';

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

// ── Return type ──────────────────────────────────────────────────────────

interface UseEmployeeDailyTotalsResult {
  rows: EmployeeDailyTotal[];
  userIdToDisplayNameLookup: Map<string, string>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch employee_daily_totals (Layer 3) and a lightweight
 * canonical user lookup for resolving user_id → display name.
 *
 * Both queries run in parallel for performance.
 */
export function useEmployeeDailyTotals(
  dateRange: DateRange,
): UseEmployeeDailyTotalsResult {
  const [rows, setRows] = useState<EmployeeDailyTotal[]>([]);
  const [associationRecords, setAssociationRecords] = useState<AssociationRecord[]>([]);
  const [resourceRecords, setResourceRecords] = useState<ResourceRecord[]>([]);
  const [canonicalMappings, setCanonicalMappings] = useState<CanonicalMappingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startDateStr = format(dateRange.start, 'yyyy-MM-dd');
  const endDateStr = format(dateRange.end, 'yyyy-MM-dd');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Query 1: Fetch employee_daily_totals for the date range
      const totalsPromise = supabase
        .from('employee_daily_totals')
        .select('*')
        .gte('work_date', startDateStr)
        .lte('work_date', endDateStr)
        .order('work_date', { ascending: true });

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

      const [totalsResult, associationsResult, resourcesResult, canonicalResult] = await Promise.all([
        totalsPromise,
        associationsPromise,
        resourcesPromise,
        canonicalPromise,
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
      // Canonical mapping is optional — don't fail if view doesn't exist yet
      if (canonicalResult.error && !canonicalResult.error.message.includes('does not exist')) {
        console.warn('Failed to fetch canonical mapping:', canonicalResult.error.message);
      }

      setRows(totalsResult.data || []);
      setResourceRecords(resourcesResult.data || []);

      // Normalize association data — Supabase may return resource as array
      const normalized: AssociationRecord[] = (associationsResult.data || []).map((assoc) => ({
        user_id: assoc.user_id,
        resource_id: assoc.resource_id,
        resource: Array.isArray(assoc.resource) ? assoc.resource[0] || null : assoc.resource,
      }));
      setAssociationRecords(normalized);
      setCanonicalMappings(canonicalResult.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch burn data');
    } finally {
      setLoading(false);
    }
  }, [startDateStr, endDateStr]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build canonical entity mapping: resource_id → canonical_resource_id
  const canonicalEntityMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const mapping of canonicalMappings) {
      map.set(mapping.entity_id, mapping.canonical_entity_id);
    }
    return map;
  }, [canonicalMappings]);

  // Build resource_id → display name lookup
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

  // Build user_id → canonical display name lookup
  // Mirrors the exact logic from useTimesheetData.userIdToDisplayNameLookup
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

  return { rows, userIdToDisplayNameLookup, loading, error };
}

export default useEmployeeDailyTotals;
