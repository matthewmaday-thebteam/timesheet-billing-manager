import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type {
  MonthSelection,
  ProjectRateDisplay,
  ProjectRatesForMonthResult,
  RateSource,
  RoundingIncrement,
} from '../types';

/**
 * Helper to convert MonthSelection to Date (first of month)
 */
function monthToDate(month: MonthSelection): Date {
  return new Date(month.year, month.month - 1, 1);
}

/**
 * Helper to format month as ISO date string (YYYY-MM-DD)
 * Note: Manually formats to avoid timezone conversion issues with toISOString()
 */
function formatMonthAsISO(month: MonthSelection): string {
  const yyyy = month.year;
  const mm = String(month.month).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

/**
 * Get current month as MonthSelection
 */
export function getCurrentMonth(): MonthSelection {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

/**
 * Format MonthSelection for display (e.g., "January 2026")
 */
export function formatMonthDisplay(month: MonthSelection): string {
  const date = monthToDate(month);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Navigate to previous month
 */
export function getPreviousMonth(month: MonthSelection): MonthSelection {
  if (month.month === 1) {
    return { year: month.year - 1, month: 12 };
  }
  return { year: month.year, month: month.month - 1 };
}

/**
 * Navigate to next month
 */
export function getNextMonth(month: MonthSelection): MonthSelection {
  if (month.month === 12) {
    return { year: month.year + 1, month: 1 };
  }
  return { year: month.year, month: month.month + 1 };
}

/**
 * Check if month is in the future
 */
export function isFutureMonth(month: MonthSelection): boolean {
  const current = getCurrentMonth();
  if (month.year > current.year) return true;
  if (month.year === current.year && month.month > current.month) return true;
  return false;
}

interface UseMonthlyRatesOptions {
  selectedMonth: MonthSelection;
}

interface UseMonthlyRatesReturn {
  projectsWithRates: ProjectRateDisplay[];
  isLoading: boolean;
  error: string | null;
  updateRate: (projectId: string, month: MonthSelection, rate: number) => Promise<boolean>;
  updateRounding: (projectId: string, month: MonthSelection, increment: RoundingIncrement) => Promise<boolean>;
  refetch: () => void;
}

/**
 * Hook to fetch and manage monthly project rates.
 * Calls get_all_project_rates_for_month RPC function.
 */
export function useMonthlyRates({ selectedMonth }: UseMonthlyRatesOptions): UseMonthlyRatesReturn {
  const [data, setData] = useState<ProjectRatesForMonthResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch rates for the selected month
  const fetchRates = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const monthStr = formatMonthAsISO(selectedMonth);

      const { data: result, error: rpcError } = await supabase.rpc(
        'get_all_project_rates_for_month',
        { p_month: monthStr }
      );

      if (rpcError) throw rpcError;

      setData(result || []);
    } catch (err) {
      console.error('Error fetching monthly rates:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch rates');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth]);

  // Fetch on mount and when month changes
  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  // Transform raw data to ProjectRateDisplay
  const projectsWithRates = useMemo<ProjectRateDisplay[]>(() => {
    return data.map((row) => {
      // Ensure effectiveRounding is a valid number (RPC returns INTEGER, but be defensive)
      // Default to 15 if the value is missing or invalid
      let effectiveRounding: RoundingIncrement = 15;
      if (row.effective_rounding !== null && row.effective_rounding !== undefined) {
        const numValue = typeof row.effective_rounding === 'number'
          ? row.effective_rounding
          : Number(row.effective_rounding);
        if ([0, 5, 15, 30].includes(numValue)) {
          effectiveRounding = numValue as RoundingIncrement;
        }
      }

      return {
        projectId: row.project_id,
        externalProjectId: row.external_project_id,
        projectName: row.project_name,
        clientId: row.client_id,
        clientName: row.client_name,
        firstSeenMonth: row.first_seen_month,
        effectiveRate: row.effective_rate,
        source: row.source as RateSource,
        sourceMonth: row.source_month,
        existedInSelectedMonth: row.existed_in_month,
        hasExplicitRateThisMonth: row.source === 'explicit',
        // Rounding fields - use validated effectiveRounding
        effectiveRounding,
        roundingSource: (row.rounding_source ?? 'default') as RateSource,
        roundingSourceMonth: row.rounding_source_month,
        hasExplicitRoundingThisMonth: row.rounding_source === 'explicit',
      };
    });
  }, [data]);

  // Update rate for a project in a specific month
  const updateRate = useCallback(
    async (projectId: string, month: MonthSelection, rate: number): Promise<boolean> => {
      try {
        const monthStr = formatMonthAsISO(month);

        const { error: rpcError } = await supabase.rpc(
          'set_project_rate_for_month',
          {
            p_project_id: projectId,
            p_month: monthStr,
            p_rate: rate,
          }
        );

        if (rpcError) throw rpcError;

        // Refetch to get updated data
        await fetchRates();

        return true;
      } catch (err) {
        console.error('Error updating rate:', err);
        setError(err instanceof Error ? err.message : 'Failed to update rate');
        return false;
      }
    },
    [fetchRates]
  );

  // Update rounding for a project in a specific month
  const updateRounding = useCallback(
    async (projectId: string, month: MonthSelection, increment: RoundingIncrement): Promise<boolean> => {
      try {
        const monthStr = formatMonthAsISO(month);

        const { error: rpcError } = await supabase.rpc(
          'set_project_rounding_for_month',
          {
            p_project_id: projectId,
            p_month: monthStr,
            p_increment: increment,
          }
        );

        if (rpcError) throw rpcError;

        // Refetch to get updated data
        await fetchRates();

        return true;
      } catch (err) {
        console.error('Error updating rounding:', err);
        setError(err instanceof Error ? err.message : 'Failed to update rounding');
        return false;
      }
    },
    [fetchRates]
  );

  return {
    projectsWithRates,
    isLoading,
    error,
    updateRate,
    updateRounding,
    refetch: fetchRates,
  };
}

/**
 * Hook to get effective rates for a date range (for reports/dashboard).
 * Calls get_effective_rates_for_range RPC function.
 */
interface EffectiveRateForMonth {
  projectId: string;
  rateMonth: string;
  effectiveRate: number;
  source: RateSource;
  sourceMonth: string | null;
}

interface UseEffectiveRatesRangeReturn {
  rates: EffectiveRateForMonth[];
  ratesByProjectMonth: Map<string, number>; // "projectId:YYYY-MM" -> rate
  isLoading: boolean;
  error: string | null;
}

export function useEffectiveRatesRange(
  startMonth: MonthSelection,
  endMonth: MonthSelection
): UseEffectiveRatesRangeReturn {
  const [rates, setRates] = useState<EffectiveRateForMonth[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRates = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const startStr = formatMonthAsISO(startMonth);
        const endStr = formatMonthAsISO(endMonth);

        const { data: result, error: rpcError } = await supabase.rpc(
          'get_effective_rates_for_range',
          {
            p_start_month: startStr,
            p_end_month: endStr,
          }
        );

        if (rpcError) throw rpcError;

        const mapped: EffectiveRateForMonth[] = (result || []).map((row: any) => ({
          projectId: row.project_id,
          rateMonth: row.rate_month,
          effectiveRate: row.effective_rate,
          source: row.source as RateSource,
          sourceMonth: row.source_month,
        }));

        setRates(mapped);
      } catch (err) {
        console.error('Error fetching rates range:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch rates');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRates();
  }, [startMonth, endMonth]);

  // Build lookup map: "projectId:YYYY-MM" -> rate
  const ratesByProjectMonth = useMemo(() => {
    const map = new Map<string, number>();
    rates.forEach((r) => {
      // Extract YYYY-MM from rate_month (which is YYYY-MM-DD)
      const yyyymm = r.rateMonth.substring(0, 7);
      map.set(`${r.projectId}:${yyyymm}`, r.effectiveRate);
    });
    return map;
  }, [rates]);

  return {
    rates,
    ratesByProjectMonth,
    isLoading,
    error,
  };
}
