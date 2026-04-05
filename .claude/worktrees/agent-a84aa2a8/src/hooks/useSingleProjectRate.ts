import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  MonthSelection,
  ProjectRateDisplayWithBilling,
  ProjectRatesForMonthResultWithBilling,
  RateSource,
  RoundingIncrement,
} from '../types';

/**
 * Helper to format month as ISO date string (YYYY-MM-DD)
 */
function formatMonthAsISO(month: MonthSelection): string {
  const yyyy = month.year;
  const mm = String(month.month).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

interface UseSingleProjectRateOptions {
  /** Project ID to fetch rate for (null to skip fetching) */
  projectId: string | null;
  /** Month to fetch rate for */
  month: MonthSelection;
  /** Whether the query is enabled (default: true) */
  enabled?: boolean;
}

interface UseSingleProjectRateReturn {
  /** Project rate data for the selected month (null if not found or loading) */
  projectRate: ProjectRateDisplayWithBilling | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Manually trigger a refetch */
  refetch: () => void;
}

/**
 * Hook to fetch rate data for a single project/month combination.
 * Uses the existing get_all_project_rates_for_month RPC and filters to the requested project.
 * Returns null if project not found (handles "project didn't exist yet" case).
 */
export function useSingleProjectRate({
  projectId,
  month,
  enabled = true,
}: UseSingleProjectRateOptions): UseSingleProjectRateReturn {
  const [projectRate, setProjectRate] = useState<ProjectRateDisplayWithBilling | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRate = useCallback(async () => {
    if (!projectId || !enabled) {
      setProjectRate(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const monthStr = formatMonthAsISO(month);

      const { data: result, error: rpcError } = await supabase.rpc(
        'get_all_project_rates_for_month',
        { p_month: monthStr }
      );

      if (rpcError) throw rpcError;

      // Find the specific project in the results
      const rows = (result || []) as ProjectRatesForMonthResultWithBilling[];
      const matchingRow = rows.find(row => row.project_id === projectId);

      if (!matchingRow) {
        // Project not found for this month - return null (valid state)
        setProjectRate(null);
      } else {
        // Transform to ProjectRateDisplayWithBilling
        let effectiveRounding: RoundingIncrement = 15;
        if (matchingRow.effective_rounding !== null && matchingRow.effective_rounding !== undefined) {
          const numValue = typeof matchingRow.effective_rounding === 'number'
            ? matchingRow.effective_rounding
            : Number(matchingRow.effective_rounding);
          if ([0, 5, 15, 30].includes(numValue)) {
            effectiveRounding = numValue as RoundingIncrement;
          }
        }

        const transformed: ProjectRateDisplayWithBilling = {
          projectId: matchingRow.project_id,
          externalProjectId: matchingRow.external_project_id,
          projectName: matchingRow.project_name,
          clientId: matchingRow.client_id,
          clientName: matchingRow.client_name,
          canonicalClientId: matchingRow.canonical_client_id,
          canonicalClientName: matchingRow.canonical_client_name,
          firstSeenMonth: matchingRow.first_seen_month,
          effectiveRate: matchingRow.effective_rate,
          source: matchingRow.source as RateSource,
          sourceMonth: matchingRow.source_month,
          existedInSelectedMonth: matchingRow.existed_in_month,
          hasExplicitRateThisMonth: matchingRow.source === 'explicit',
          effectiveRounding,
          roundingSource: (matchingRow.rounding_source ?? 'default') as RateSource,
          roundingSourceMonth: matchingRow.rounding_source_month,
          hasExplicitRoundingThisMonth: matchingRow.rounding_source === 'explicit',
          minimumHours: matchingRow.minimum_hours ?? null,
          maximumHours: matchingRow.maximum_hours ?? null,
          carryoverEnabled: matchingRow.carryover_enabled ?? false,
          carryoverMaxHours: matchingRow.carryover_max_hours ?? null,
          carryoverExpiryMonths: matchingRow.carryover_expiry_months ?? null,
          limitsSource: (matchingRow.limits_source ?? 'default') as RateSource,
          limitsSourceMonth: matchingRow.limits_source_month ?? null,
          hasExplicitLimitsThisMonth: matchingRow.limits_source === 'explicit',
          isActive: matchingRow.is_active ?? true,
          activeSource: (matchingRow.active_source ?? 'default') as RateSource,
          activeSourceMonth: matchingRow.active_source_month ?? null,
          hasExplicitActiveThisMonth: matchingRow.active_source === 'explicit',
          carryoverHoursIn: matchingRow.carryover_hours_in ?? 0,
          carryoverSources: [],
        };

        setProjectRate(transformed);
      }
    } catch (err) {
      console.error('Error fetching single project rate:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch project rate');
      setProjectRate(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, month, enabled]);

  // Fetch when dependencies change
  useEffect(() => {
    fetchRate();
  }, [fetchRate]);

  return {
    projectRate,
    isLoading,
    error,
    refetch: fetchRate,
  };
}

export default useSingleProjectRate;
