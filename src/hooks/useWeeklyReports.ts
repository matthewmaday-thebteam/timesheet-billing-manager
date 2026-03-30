/**
 * useWeeklyReports - Weekly Status Reports data hook
 *
 * Fetches report metadata from v_weekly_report_availability,
 * groups into Year > Month > Week > Company hierarchy, and exposes
 * download and resend actions.
 *
 * @official 2026-03-30
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { MONTH_NAMES } from './useEOMReports';

// ============================================================================
// TYPES
// ============================================================================

/** Raw row from v_weekly_report_availability view */
export interface WeeklyAvailabilityRow {
  company_id: string;
  client_id: string;
  company_name: string;
  report_year: number;
  report_month: number;
  week_start: string;  // YYYY-MM-DD
  week_end: string;    // YYYY-MM-DD
  report_id: string | null;
  generated_at: string | null;
  storage_path: string | null;
  file_size_bytes: number | null;
  total_hours: number | null;
  total_revenue_cents: number | null;
  project_count: number | null;
  task_count: number | null;
  sent_at: string | null;
  sent_to: string[] | null;
  has_report: boolean;
}

/** A single company entry within a week */
export interface WeeklyCompanyReport {
  companyId: string;
  companyName: string;
  hasReport: boolean;
  generatedAt: string | null;
  storagePath: string | null;
  totalHours: number | null;
  sentAt: string | null;
}

/** A week grouping containing company reports */
export interface WeekGroup {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;  // e.g., "Mar 23 - Mar 29"
  companies: WeeklyCompanyReport[];
  generatedCount: number;
  totalCount: number;
}

/** A month grouping containing week groups */
export interface WeeklyMonthGroup {
  year: number;
  month: number;
  label: string;  // e.g., "March"
  weeks: WeekGroup[];
}

/** A year grouping containing month groups */
export interface WeeklyYearGroup {
  year: number;
  months: WeeklyMonthGroup[];
}

/** Return type for the hook */
export interface UseWeeklyReportsResult {
  /** Hierarchical data: Year > Month > Week > Company */
  years: WeeklyYearGroup[];
  /** Initial data loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Map of downloading reports keyed by `{companyId}-{weekStart}` */
  downloadingReports: Map<string, boolean>;
  /** Map of resending reports keyed by `{companyId}-{weekStart}` */
  resendingReports: Map<string, boolean>;
  /** Download a weekly report from Supabase Storage (or generate on demand) */
  downloadReport: (
    storagePath: string | null,
    companyId: string,
    companyName: string,
    weekStart: string,
    weekEnd: string,
  ) => Promise<void>;
  /** Resend a weekly report to project managers */
  resendReport: (
    companyId: string,
    companyName: string,
    weekStart: string,
    weekEnd: string,
  ) => Promise<{ sentTo: string[]; companyName: string }>;
}

// ============================================================================
// HELPERS
// ============================================================================

const MONTH_ABBREVS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function weekKey(companyId: string, weekStart: string): string {
  return `${companyId}-${weekStart}`;
}

/** Format "2026-03-23" → "Mar 23" */
function formatDateShort(dateStr: string): string {
  const [, monthStr, dayStr] = dateStr.split('-');
  const monthIdx = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  return `${MONTH_ABBREVS[monthIdx]} ${day}`;
}

/** Build week label: "Mar 23 - Mar 29" */
function buildWeekLabel(weekStart: string, weekEnd: string): string {
  return `${formatDateShort(weekStart)} - ${formatDateShort(weekEnd)}`;
}

function buildWeeklyFilename(companyName: string, weekStart: string): string {
  const safeName = companyName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${safeName}_Weekly_Report_${weekStart}.csv`;
}

// ============================================================================
// HOOK
// ============================================================================

export function useWeeklyReports(): UseWeeklyReportsResult {
  const [rows, setRows] = useState<WeeklyAvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingReports, setDownloadingReports] = useState<Map<string, boolean>>(new Map());
  const [resendingReports, setResendingReports] = useState<Map<string, boolean>>(new Map());

  // ---- Fetch data ----
  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('v_weekly_report_availability')
        .select('*')
        .order('report_year', { ascending: false })
        .order('report_month', { ascending: false })
        .order('week_start', { ascending: false })
        .order('company_name', { ascending: true });

      if (queryError) throw queryError;

      setRows((data as WeeklyAvailabilityRow[]) || []);
    } catch (err) {
      console.error('Error fetching weekly reports:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch weekly reports');
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // ---- Build hierarchy ----
  const years = useMemo<WeeklyYearGroup[]>(() => {
    if (rows.length === 0) return [];

    // Group by year > month > week > companies
    const yearMap = new Map<number, Map<number, Map<string, WeeklyCompanyReport[]>>>();

    // Also store week metadata (weekEnd) keyed by weekStart
    const weekMeta = new Map<string, string>(); // weekStart → weekEnd

    for (const row of rows) {
      if (!yearMap.has(row.report_year)) {
        yearMap.set(row.report_year, new Map());
      }
      const monthMap = yearMap.get(row.report_year)!;
      if (!monthMap.has(row.report_month)) {
        monthMap.set(row.report_month, new Map());
      }
      const weekMap = monthMap.get(row.report_month)!;
      if (!weekMap.has(row.week_start)) {
        weekMap.set(row.week_start, []);
      }

      weekMeta.set(row.week_start, row.week_end);

      const company: WeeklyCompanyReport = {
        companyId: row.company_id,
        companyName: row.company_name,
        hasReport: row.has_report,
        generatedAt: row.generated_at,
        storagePath: row.storage_path,
        totalHours: row.total_hours,
        sentAt: row.sent_at,
      };

      weekMap.get(row.week_start)!.push(company);
    }

    // Build sorted structure
    const result: WeeklyYearGroup[] = [];

    // Years descending
    const sortedYears = [...yearMap.keys()].sort((a, b) => b - a);

    for (const year of sortedYears) {
      const monthMap = yearMap.get(year)!;
      const months: WeeklyMonthGroup[] = [];

      // Months descending
      const sortedMonths = [...monthMap.keys()].sort((a, b) => b - a);

      for (const month of sortedMonths) {
        const weekMap = monthMap.get(month)!;
        const weeks: WeekGroup[] = [];

        // Weeks descending (by week_start date string, YYYY-MM-DD sorts correctly)
        const sortedWeeks = [...weekMap.keys()].sort((a, b) => b.localeCompare(a));

        for (const ws of sortedWeeks) {
          const companies = weekMap.get(ws)!;
          // Companies already sorted alphabetically by the query, but ensure it
          companies.sort((a, b) => a.companyName.localeCompare(b.companyName));

          const we = weekMeta.get(ws)!;
          const generatedCount = companies.filter(c => c.hasReport).length;

          weeks.push({
            weekStart: ws,
            weekEnd: we,
            weekLabel: buildWeekLabel(ws, we),
            companies,
            generatedCount,
            totalCount: companies.length,
          });
        }

        months.push({
          year,
          month,
          label: MONTH_NAMES[month - 1],
          weeks,
        });
      }

      result.push({ year, months });
    }

    return result;
  }, [rows]);

  // ---- Extract real error from edge function response ----
  const extractFnError = async (fnError: { message?: string; context?: Response }) => {
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
    storagePath: string | null,
    companyId: string,
    companyName: string,
    weekStart: string,
    weekEnd: string,
  ) => {
    const key = weekKey(companyId, weekStart);
    setDownloadingReports(prev => new Map(prev).set(key, true));
    setError(null);

    try {
      let downloadPath = storagePath;

      // If no storage path, generate on demand
      if (!downloadPath) {
        const { data, error: fnError } = await supabase.functions.invoke('send-weekly-revenue-report', {
          body: { companyId, weekStart, weekEnd, generateOnly: true },
        });

        if (fnError) throw new Error(await extractFnError(fnError));
        if (!data?.reports || data.reports.length === 0) {
          throw new Error('No report was generated. Check that timesheet entries exist for this week.');
        }

        downloadPath = data.reports[0].storagePath;
        if (!downloadPath) {
          throw new Error('Report generated but no storage path returned.');
        }

        // Refetch data to update the UI with the new report
        await fetchData();
      }

      const { data, error: downloadError } = await supabase
        .storage
        .from('weekly-reports')
        .download(downloadPath);

      if (downloadError) throw downloadError;
      if (!data) throw new Error('No data received from storage');

      // Trigger browser download
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildWeeklyFilename(companyName, weekStart);
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (err) {
      console.error('Error downloading weekly report:', err);
      setError(err instanceof Error ? err.message : 'Failed to download weekly report');
    } finally {
      setDownloadingReports(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, [fetchData]);

  // ---- Resend report ----
  const resendReport = useCallback(async (
    companyId: string,
    companyName: string,
    weekStart: string,
    weekEnd: string,
  ) => {
    const key = weekKey(companyId, weekStart);
    setResendingReports(prev => new Map(prev).set(key, true));
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-weekly-revenue-report', {
        body: { companyId, weekStart, weekEnd },
      });

      if (fnError) throw new Error(await extractFnError(fnError));

      if (!data?.reports || data.reports.length === 0) {
        const reason = data?.message || data?.errors?.[0] || 'No report-enabled projects found or no timesheet entries for this week';
        throw new Error(reason);
      }

      const sentReport = data.reports[0];
      if (!sentReport.emailSent) {
        throw new Error('Report generated but email failed to send. Check SendGrid configuration.');
      }

      // Refetch data to show updated status
      await fetchData();

      // Return success info (caller handles the alert)
      return { sentTo: sentReport.pmEmails, companyName };
    } catch (err) {
      console.error('Error resending weekly report:', err);
      throw err; // Re-throw so the caller can handle the error alert
    } finally {
      setResendingReports(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }, [fetchData]);

  return {
    years,
    loading,
    error,
    downloadingReports,
    resendingReports,
    downloadReport,
    resendReport,
  };
}

export default useWeeklyReports;
