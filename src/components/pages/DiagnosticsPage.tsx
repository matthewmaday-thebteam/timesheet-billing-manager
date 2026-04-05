import { useState } from 'react';
import { Card } from '../Card';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import { useSyncRuns } from '../../hooks/useSyncRuns';
import { supabase } from '../../lib/supabase';

/** Map sync_type DB values to human-readable labels */
const SYNC_TYPE_LABELS: Record<string, string> = {
  clockify_timesheets: 'Clockify',
  clickup_timesheets: 'ClickUp',
  bamboohr_timeoff: 'BambooHR Time Off',
  bamboohr_employees: 'BambooHR Employees',
};

/** Unit suffix for hours/days columns based on sync type */
function getValueUnit(syncType: string): string | null {
  if (syncType === 'clockify_timesheets') return 'hrs';
  if (syncType === 'clickup_timesheets') return 'hrs';
  if (syncType === 'bamboohr_timeoff') return 'days';
  return null;
}

/** Format source_hours/manifest_hours with 1 decimal place + unit suffix */
function formatHoursValue(value: number | null, syncType: string): string {
  const unit = getValueUnit(syncType);
  if (unit === null || value === null || value === undefined) return '\u2014';
  return `${value.toFixed(1)} ${unit}`;
}

/** Check if source and manifest hours mismatch (both non-null and different) */
function isHoursMismatch(sourceHours: number | null, manifestHours: number | null): boolean {
  if (sourceHours === null || manifestHours === null) return false;
  // Round to 1 decimal to avoid floating-point noise
  return Math.round(sourceHours * 10) !== Math.round(manifestHours * 10);
}

/** Format a timestamp as short datetime, e.g. "Apr 4, 14:30" */
function formatShortDatetime(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day}, ${hours}:${minutes}`;
}

/**
 * Diagnostics page — Sync Run Log
 *
 * Displays the last 60 sync runs in a table with status, counts, and errors.
 */
export function DiagnosticsPage() {
  const { syncRuns, loading, error } = useSyncRuns();
  const [exportingTimesheets, setExportingTimesheets] = useState(false);
  const [exportingBilling, setExportingBilling] = useState(false);
  const [exportingTaskTotals, setExportingTaskTotals] = useState(false);
  const [exportingEmployeeTotals, setExportingEmployeeTotals] = useState(false);

  async function exportTableToCSV(
    tableName: string,
    fileName: string,
    setLoading: (v: boolean) => void,
  ) {
    setLoading(true);
    try {
      const allRows: Record<string, unknown>[] = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < pageSize) break;
        offset += pageSize;
      }

      if (allRows.length === 0) {
        alert('No data found');
        return;
      }

      const headers = Object.keys(allRows[0]);
      const csvLines = [
        headers.join(','),
        ...allRows.map((row) =>
          headers
            .map((h) => {
              const val = row[h];
              if (val === null || val === undefined) return '';
              const str = String(val);
              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
              }
              return str;
            })
            .join(','),
        ),
      ];

      const bom = '\uFEFF';
      const blob = new Blob([bom + csvLines.join('\r\n')], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Diagnostics</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Sync Run Log — last 60 runs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={exportingTimesheets}
            onClick={() =>
              exportTableToCSV(
                'timesheet_daily_rollups',
                'layer_1.csv',
                setExportingTimesheets,
              )
            }
          >
            {exportingTimesheets ? 'Exporting...' : 'Export Layer 1'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportingBilling}
            onClick={() =>
              exportTableToCSV(
                'v_canonical_project_monthly_summary',
                'legacy_billing_summary.csv',
                setExportingBilling,
              )
            }
          >
            {exportingBilling ? 'Exporting...' : 'Export Legacy Billing Summary'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportingTaskTotals}
            onClick={() =>
              exportTableToCSV(
                'task_totals',
                'task_totals.csv',
                setExportingTaskTotals,
              )
            }
          >
            {exportingTaskTotals ? 'Exporting...' : 'Export Task Totals'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportingEmployeeTotals}
            onClick={() =>
              exportTableToCSV(
                'employee_totals',
                'employee_totals.csv',
                setExportingEmployeeTotals,
              )
            }
          >
            {exportingEmployeeTotals ? 'Exporting...' : 'Export Employee Totals'}
          </Button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Card variant="bordered" padding="md">
          <p className="text-sm text-error-text">{error}</p>
        </Card>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading sync runs...</span>
        </div>
      ) : (
        <Card variant="default" padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-vercel-gray-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Completed At
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Sync Type
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Source
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Manifest
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Source Hrs
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Manifest Hrs
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Deleted
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {syncRuns.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-sm text-vercel-gray-400">
                      No sync runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  syncRuns.map((run) => {
                    const hoursMismatch = isHoursMismatch(run.source_hours, run.manifest_hours);
                    return (
                    <tr
                      key={run.id}
                      className={`border-b border-vercel-gray-100 last:border-b-0 transition-colors ${
                        hoursMismatch
                          ? 'bg-warning-light hover:bg-warning-light'
                          : 'hover:bg-vercel-gray-50'
                      }`}
                    >
                      <td className="py-2.5 px-4 text-sm text-vercel-gray-600 font-mono whitespace-nowrap">
                        {formatShortDatetime(run.completed_at)}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-vercel-gray-600">
                        {SYNC_TYPE_LABELS[run.sync_type] || run.sync_type}
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant={run.success ? 'success' : 'error'} size="sm">
                          {run.success ? 'Pass' : 'Fail'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-sm text-vercel-gray-600 font-mono text-right">
                        {run.source_total}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-vercel-gray-600 font-mono text-right">
                        {run.manifest_total}
                      </td>
                      <td className={`py-2.5 px-4 text-sm font-mono text-right ${
                        hoursMismatch ? 'text-warning-text font-semibold' : 'text-vercel-gray-600'
                      }`}>
                        {formatHoursValue(run.source_hours, run.sync_type)}
                      </td>
                      <td className={`py-2.5 px-4 text-sm font-mono text-right ${
                        hoursMismatch ? 'text-warning-text font-semibold' : 'text-vercel-gray-600'
                      }`}>
                        {formatHoursValue(run.manifest_hours, run.sync_type)}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-vercel-gray-600 font-mono text-right">
                        {run.deleted_count}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-vercel-gray-400 max-w-[300px] truncate">
                        {run.error_message || '\u2014'}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
