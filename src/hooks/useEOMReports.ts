/**
 * useEOMReports - End of Month Reports data hook
 *
 * Fetches report metadata from eom_reports + v_eom_report_availability,
 * groups into Year > Month > Customer hierarchy, and exposes download,
 * regenerate, generateMonth, and backfillAll actions.
 *
 * @official 2026-03-27
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

/** Raw row from v_eom_report_availability view */
export interface EOMAvailabilityRow {
  company_id: string;
  client_id: string;
  company_name: string;
  report_year: number;
  report_month: number;
  report_id: string | null;
  generated_at: string | null;
  generation_number: number | null;
  storage_path: string | null;
  file_size_bytes: number | null;
  total_hours: number | null;
  total_revenue_cents: number | null;
  project_count: number | null;
  source_data_hash: string | null;
  has_report: boolean;
}

/** Status of a single company-month report */
export type ReportStatus = 'generated' | 'available' | 'pending';

/** A single customer entry within a month */
export interface EOMCustomerReport {
  companyId: string;
  clientId: string;
  companyName: string;
  reportId: string | null;
  status: ReportStatus;
  generatedAt: string | null;
  generationNumber: number | null;
  storagePath: string | null;
  fileSizeBytes: number | null;
  totalHours: number | null;
  totalRevenueCents: number | null;
  projectCount: number | null;
}

/** A month grouping containing customer reports */
export interface EOMMonthGroup {
  year: number;
  month: number;
  label: string; // e.g., "March 2026"
  customers: EOMCustomerReport[];
  generatedCount: number;
  totalCount: number;
}

/** A year grouping containing month groups */
export interface EOMYearGroup {
  year: number;
  months: EOMMonthGroup[];
}

/** Return type for the hook */
export interface UseEOMReportsResult {
  /** Hierarchical data: Year > Month > Customer */
  years: EOMYearGroup[];
  /** Initial data loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Map of regenerating reports keyed by `{companyId}-{year}-{month}` */
  regeneratingReports: Map<string, boolean>;
  /** Map of downloading reports keyed by `{companyId}-{year}-{month}` */
  downloadingReports: Map<string, boolean>;
  /** Whether a month-level generate is in progress, keyed by `{year}-{month}` */
  generatingMonths: Map<string, boolean>;
  /** Whether backfill is in progress */
  backfilling: boolean;
  /** Download a report CSV from Supabase Storage */
  downloadReport: (storagePath: string, companyName: string, year: number, month: number) => Promise<void>;
  /** Regenerate a single company-month report */
  regenerateReport: (year: number, month: number, companyId: string) => Promise<void>;
  /** Generate all reports for a given month */
  generateMonth: (year: number, month: number) => Promise<void>;
  /** Trigger full backfill of all missing reports */
  backfillAll: () => Promise<void>;
  /** Re-fetch data */
  refetch: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function reportKey(companyId: string, year: number, month: number): string {
  return `${companyId}-${year}-${month}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

function getReportStatus(row: EOMAvailabilityRow): ReportStatus {
  if (row.has_report) return 'generated';
  // The view only returns eligible months, so everything without a report is "available"
  return 'available';
}

function buildFilename(companyName: string, year: number, month: number): string {
  const safeName = companyName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const monthName = MONTH_NAMES[month - 1];
  return `${safeName}_Revenue_Report_${monthName}_${year}.csv`;
}

// ============================================================================
// HOOK
// ============================================================================

export function useEOMReports(): UseEOMReportsResult {
  const [rows, setRows] = useState<EOMAvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regeneratingReports, setRegeneratingReports] = useState<Map<string, boolean>>(new Map());
  const [downloadingReports, setDownloadingReports] = useState<Map<string, boolean>>(new Map());
  const [generatingMonths, setGeneratingMonths] = useState<Map<string, boolean>>(new Map());
  const [backfilling, setBackfilling] = useState(false);

  // ---- Fetch data ----
  // initialLoad controls the full-page spinner. Subsequent refreshes (after
  // regeneration) update data silently without flashing the loading state.
  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('v_eom_report_availability')
        .select('*')
        .order('report_year', { ascending: false })
        .order('report_month', { ascending: false })
        .order('company_name', { ascending: true });

      if (queryError) throw queryError;

      setRows((data as EOMAvailabilityRow[]) || []);
    } catch (err) {
      console.error('Error fetching EOM reports:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch EOM reports');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // ---- Build hierarchy ----
  const years = useMemo<EOMYearGroup[]>(() => {
    if (rows.length === 0) return [];

    // Group by year > month > customers
    const yearMap = new Map<number, Map<number, EOMCustomerReport[]>>();

    for (const row of rows) {
      // Hide zero-revenue companies — nothing to invoice
      if (row.has_report && (row.total_revenue_cents === null || row.total_revenue_cents === 0)) {
        continue;
      }

      if (!yearMap.has(row.report_year)) {
        yearMap.set(row.report_year, new Map());
      }
      const monthMap = yearMap.get(row.report_year)!;
      if (!monthMap.has(row.report_month)) {
        monthMap.set(row.report_month, []);
      }

      const customer: EOMCustomerReport = {
        companyId: row.company_id,
        clientId: row.client_id,
        companyName: row.company_name,
        reportId: row.report_id,
        status: getReportStatus(row),
        generatedAt: row.generated_at,
        generationNumber: row.generation_number,
        storagePath: row.storage_path,
        fileSizeBytes: row.file_size_bytes,
        totalHours: row.total_hours,
        totalRevenueCents: row.total_revenue_cents,
        projectCount: row.project_count,
      };

      monthMap.get(row.report_month)!.push(customer);
    }

    // Build sorted structure
    const result: EOMYearGroup[] = [];

    // Years descending
    const sortedYears = [...yearMap.keys()].sort((a, b) => b - a);

    for (const year of sortedYears) {
      const monthMap = yearMap.get(year)!;
      const months: EOMMonthGroup[] = [];

      // Months descending
      const sortedMonths = [...monthMap.keys()].sort((a, b) => b - a);

      for (const month of sortedMonths) {
        const customers = monthMap.get(month)!;
        // Customers already sorted alphabetically by the query, but ensure it
        customers.sort((a, b) => a.companyName.localeCompare(b.companyName));

        const generatedCount = customers.filter(c => c.status === 'generated').length;

        months.push({
          year,
          month,
          label: `${MONTH_NAMES[month - 1]} ${year}`,
          customers,
          generatedCount,
          totalCount: customers.length,
        });
      }

      result.push({ year, months });
    }

    return result;
  }, [rows]);

  // ---- Extract real error from edge function response ----
  const extractFnError = async (fnError: { message?: string; context?: Response }) => {
    // supabase.functions.invoke wraps non-2xx as a generic message.
    // The actual response body (our JSON error) is in fnError.context.
    if (fnError.context && typeof fnError.context.json === 'function') {
      try {
        const body = await fnError.context.json();
        return body?.error || body?.message || fnError.message || 'Unknown error';
      } catch { /* fall through */ }
    }
    return fnError.message || 'Unknown error';
  };

  // ---- Download report ----
  const downloadReport = useCallback(async (
    storagePath: string,
    companyName: string,
    year: number,
    month: number,
  ) => {
    const key = reportKey(storagePath, year, month);
    setDownloadingReports(prev => new Map(prev).set(key, true));
    setError(null);

    try {
      const { data, error: downloadError } = await supabase
        .storage
        .from('eom-reports')
        .download(storagePath);

      if (downloadError) throw downloadError;
      if (!data) throw new Error('No data received from storage');

      // Trigger browser download
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildFilename(companyName, year, month);
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (err) {
      console.error('Error downloading report:', err);
      setError(err instanceof Error ? err.message : 'Failed to download report');
    } finally {
      setDownloadingReports(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  // ---- Regenerate single report ----
  const regenerateReport = useCallback(async (
    year: number,
    month: number,
    companyId: string,
  ) => {
    const key = reportKey(companyId, year, month);
    setRegeneratingReports(prev => new Map(prev).set(key, true));
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-eom-report', {
        body: { year, month, companyId },
      });

      if (fnError) throw new Error(await extractFnError(fnError));
      if (data?.failed > 0) throw new Error(data.details?.[0]?.error || 'Report generation failed');

      // Refresh data to show updated status
      await fetchData();
    } catch (err) {
      console.error('Error regenerating report:', err);
      setError(err instanceof Error ? err.message : 'Failed to regenerate report');
    } finally {
      setRegeneratingReports(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, [fetchData]);

  // ---- Generate all reports for a month ----
  const generateMonth = useCallback(async (year: number, month: number) => {
    const key = monthKey(year, month);
    setGeneratingMonths(prev => new Map(prev).set(key, true));
    setError(null);

    try {
      const { error: fnError } = await supabase.functions.invoke('generate-eom-report', {
        body: { year, month },
      });

      if (fnError) throw new Error(await extractFnError(fnError));

      await fetchData();
    } catch (err) {
      console.error('Error generating month reports:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate reports for month');
    } finally {
      setGeneratingMonths(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, [fetchData]);

  // ---- Backfill all missing reports ----
  const backfillAll = useCallback(async () => {
    setBackfilling(true);
    setError(null);

    try {
      const { error: fnError } = await supabase.functions.invoke('generate-eom-report', {
        body: { backfill: true },
      });

      if (fnError) throw new Error(await extractFnError(fnError));

      await fetchData();
    } catch (err) {
      console.error('Error backfilling reports:', err);
      setError(err instanceof Error ? err.message : 'Failed to backfill reports');
    } finally {
      setBackfilling(false);
    }
  }, [fetchData]);

  return {
    years,
    loading,
    error,
    regeneratingReports,
    downloadingReports,
    generatingMonths,
    backfilling,
    downloadReport,
    regenerateReport,
    generateMonth,
    backfillAll,
    refetch: fetchData,
  };
}

export default useEOMReports;
