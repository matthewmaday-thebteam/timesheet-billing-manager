import { Card } from '../Card';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { useSyncRuns } from '../../hooks/useSyncRuns';

/** Map sync_type DB values to human-readable labels */
const SYNC_TYPE_LABELS: Record<string, string> = {
  clockify_timesheets: 'Clockify',
  bamboohr_timeoff: 'BambooHR Time Off',
  bamboohr_employees: 'BambooHR Employees',
};

/** Unit suffix for hours/days columns based on sync type */
function getValueUnit(syncType: string): string | null {
  if (syncType === 'clockify_timesheets') return 'hrs';
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

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-vercel-gray-600">Diagnostics</h1>
        <p className="text-sm text-vercel-gray-400 mt-1">
          Sync Run Log — last 60 runs
        </p>
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
