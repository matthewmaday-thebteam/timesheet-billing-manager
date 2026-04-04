/**
 * useEmployeeProfit - Query employee-project profit data from v_employee_project_profit
 *
 * Returns a nested Map structure that EmployeePerformance.tsx can consume:
 *   outer key: canonical display name (employee's canonical name, matching EmployeePerformance grouping)
 *   inner key: canonical external project_id (matching EmployeePerformance project keys)
 *   value: { revenue, cost, profit } in dollars (converted from cents)
 *
 * This hook reads pre-calculated profit data from the database view created
 * in migration 065, which computes proportional revenue, cost, and profit
 * per employee per canonical project per month.
 *
 * The view returns entity UUIDs and project UUIDs; this hook resolves them
 * to display names and external project IDs for direct consumption by the
 * EmployeePerformance component.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { roundCurrency } from '../utils/billing';
import type { EmployeeProjectProfit, MonthSelection } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface EmployeeProjectProfitEntry {
  revenue: number;
  cost: number | null;
  profit: number | null;
}

/** Map from canonical display name to Map of canonical external project_id to profit */
type ProfitByEmployeeProject = Map<string, Map<string, EmployeeProjectProfitEntry>>;

interface UseEmployeeProfitReturn {
  /** Nested map: display name -> canonical external project_id -> { revenue, cost, profit } (dollars) */
  profitData: ProfitByEmployeeProject | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
}

interface ResourceRow {
  id: string;
  external_label: string;
  first_name: string | null;
  last_name: string | null;
}

interface ProjectRow {
  id: string;
  project_id: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatMonthAsISO(month: MonthSelection): string {
  const yyyy = month.year;
  const mm = String(month.month).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

function getDisplayName(resource: ResourceRow): string {
  return resource.first_name || resource.last_name
    ? [resource.first_name, resource.last_name].filter(Boolean).join(' ')
    : resource.external_label;
}

// ============================================================================
// HOOK
// ============================================================================

export function useEmployeeProfit(selectedMonth: MonthSelection): UseEmployeeProfitReturn {
  const [rows, setRows] = useState<EmployeeProjectProfit[]>([]);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthStr = formatMonthAsISO(selectedMonth);

  const fetchProfitData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [profitResult, resourcesResult, projectsResult] = await Promise.all([
        supabase
          .from('v_employee_project_profit')
          .select('*')
          .eq('month', monthStr),
        supabase
          .from('resources')
          .select('id, external_label, first_name, last_name'),
        supabase
          .from('projects')
          .select('id, project_id'),
      ]);

      if (profitResult.error) throw profitResult.error;
      if (resourcesResult.error) throw resourcesResult.error;
      if (projectsResult.error) throw projectsResult.error;

      setRows((profitResult.data as EmployeeProjectProfit[]) || []);
      setResources((resourcesResult.data as ResourceRow[]) || []);
      setProjects((projectsResult.data as ProjectRow[]) || []);
    } catch (err) {
      console.error('Error fetching employee profit data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch employee profit data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [monthStr]);

  useEffect(() => {
    fetchProfitData();
  }, [fetchProfitData]);

  // Transform flat rows into the nested Map structure keyed by display name and external project ID
  const profitData = useMemo<ProfitByEmployeeProject | null>(() => {
    if (rows.length === 0) return null;

    // Build resource UUID -> display name lookup
    const resourceDisplayName = new Map<string, string>();
    for (const r of resources) {
      resourceDisplayName.set(r.id, getDisplayName(r));
    }

    // Build project UUID -> external project_id lookup
    const projectUuidToExternal = new Map<string, string>();
    for (const p of projects) {
      projectUuidToExternal.set(p.id, p.project_id);
    }

    const outerMap: ProfitByEmployeeProject = new Map();

    for (const row of rows) {
      // Resolve canonical_entity_id (resource UUID) to display name
      const displayName = resourceDisplayName.get(row.canonical_entity_id);
      if (!displayName) continue; // Skip if resource not found

      // Resolve canonical_project_id (project UUID) to external project_id
      const externalProjectId = projectUuidToExternal.get(row.canonical_project_id);
      if (!externalProjectId) continue; // Skip if project not found

      if (!outerMap.has(displayName)) {
        outerMap.set(displayName, new Map());
      }

      const innerMap = outerMap.get(displayName)!;

      innerMap.set(externalProjectId, {
        revenue: roundCurrency(row.proportional_revenue_cents / 100),
        cost: row.employee_cost_cents != null ? roundCurrency(row.employee_cost_cents / 100) : null,
        profit: row.employee_profit_cents != null ? roundCurrency(row.employee_profit_cents / 100) : null,
      });
    }

    return outerMap;
  }, [rows, resources, projects]);

  return {
    profitData,
    loading,
    error,
  };
}

export default useEmployeeProfit;
