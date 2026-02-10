import { useState, useCallback, useMemo } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { Card } from '../Card';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { useMonthlyRates, getCurrentMonth, formatMonthDisplay } from '../../hooks/useMonthlyRates';
import { useCompanies } from '../../hooks/useCompanies';
import { useTimesheetData } from '../../hooks/useTimesheetData';
import { useUnifiedBilling } from '../../hooks/useUnifiedBilling';
import {
  parseClockify,
  parseClickUp,
  runValidation,
  formatHoursDisplay,
  formatMinutesDisplay,
  formatCurrencyDisplay,
  getStatusIcon,
} from '../../utils/diagnostics';
import type {
  NormalizedEntry,
  ValidationReport,
  ProjectValidationResult,
  BillingConfigLookup,
} from '../../utils/diagnostics';
import { useSummaryBilling } from '../../hooks/useSummaryBilling';
import { formatCurrency } from '../../utils/billing';
import type { MonthSelection } from '../../types';
import type { ProjectBillingResult, MonthlyBillingResult } from '../../utils/billingCalculations';

/**
 * App billing data for a project (from database)
 */
interface AppBillingData {
  roundedHours: number;
  billedHours: number;
  billedRevenue: number;
  rate: number;
}

/**
 * File upload state
 */
interface FileUploadState {
  clockifyContent: string | null;
  clickupContent: string | null;
  clockifyFileName: string | null;
  clickupFileName: string | null;
}

/**
 * Project validation card component
 */
function ProjectValidationCard({
  result,
  appBilling
}: {
  result: ProjectValidationResult;
  appBilling: AppBillingData | null;
}) {
  // Calculate discrepancies against App values
  const hasHoursDiscrepancy = appBilling && Math.abs(appBilling.roundedHours - result.roundedHours) > 0.01;
  const hasRevenueDiscrepancy = appBilling && Math.abs(appBilling.billedRevenue - result.billedRevenue) > 0.01;

  // Pass only if matched in system AND no discrepancies with App
  const actuallyPassed = result.matchedInSystem && !hasHoursDiscrepancy && !hasRevenueDiscrepancy;

  return (
    <Card variant="bordered" padding="md" className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium text-vercel-gray-600">
            {result.clientName} / {result.projectName}
          </h3>
          <p className="text-xs text-vercel-gray-400 mt-0.5">
            Source: {result.source === 'clockify' ? 'Clockify' : 'ClickUp'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!result.matchedInSystem && (
            <Badge variant="warning" size="sm">No Match</Badge>
          )}
          <Badge variant={actuallyPassed ? 'success' : 'error'} size="sm">
            {actuallyPassed ? 'Pass' : 'Fail'}
          </Badge>
        </div>
      </div>

      {/* Config Match Info */}
      {!result.matchedInSystem && (
        <div className="p-2 bg-warning-light rounded text-xs text-warning-text">
          <strong>Not found in system config.</strong> Using default rate ($0).
          <br />
          Source Project ID: <code className="bg-warning/20 px-1 rounded">{result.sourceProjectId}</code>
        </div>
      )}
      {result.matchedInSystem && result.matchedProjectName && (
        <div className="text-xs text-vercel-gray-400">
          Matched: <span className="text-vercel-gray-600">{result.matchedProjectName}</span>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {/* Raw Minutes */}
        <div className="flex justify-between">
          <span className="text-vercel-gray-400">Raw Minutes:</span>
          <span className="text-vercel-gray-600 font-mono">
            {formatMinutesDisplay(result.rawMinutes)} min
          </span>
        </div>

        {/* Actual Hours */}
        <div className="flex justify-between">
          <span className="text-vercel-gray-400">Actual Hours:</span>
          <span className="text-vercel-gray-600 font-mono">
            {formatHoursDisplay(result.actualHours)} hrs
          </span>
        </div>

        {/* Rounding */}
        <div className="flex justify-between">
          <span className="text-vercel-gray-400">Rounding:</span>
          <span className="text-vercel-gray-600 font-mono">
            {result.rounding === 0 ? 'Actual' : `${result.rounding} min`}
          </span>
        </div>

        {/* Rounded Hours */}
        <div className="flex justify-between items-center">
          <span className="text-vercel-gray-400">Rounded Hours:</span>
          <span className="flex items-center gap-1.5">
            <span className="text-vercel-gray-600 font-mono">
              {formatHoursDisplay(result.roundedHours)} hrs
            </span>
            <span className={result.checks.roundedHours.status === 'pass' ? 'text-success' : 'text-error'}>
              {getStatusIcon(result.checks.roundedHours.status)}
            </span>
          </span>
        </div>

        {/* Rate */}
        <div className="flex justify-between">
          <span className="text-vercel-gray-400">Rate:</span>
          <span className="text-vercel-gray-600 font-mono">
            {formatCurrencyDisplay(result.rate)}/hr
          </span>
        </div>

        {/* Base Revenue */}
        <div className="flex justify-between items-center">
          <span className="text-vercel-gray-400">Base Revenue:</span>
          <span className="flex items-center gap-1.5">
            <span className="text-vercel-gray-600 font-mono">
              {formatCurrencyDisplay(result.baseRevenue)}
            </span>
            <span className={result.checks.baseRevenue.status === 'pass' ? 'text-success' : 'text-error'}>
              {getStatusIcon(result.checks.baseRevenue.status)}
            </span>
          </span>
        </div>

        {/* Show min/max if applicable */}
        {result.minimumHours !== null && (
          <div className="flex justify-between col-span-2">
            <span className="text-vercel-gray-400">Min Hours:</span>
            <span className="text-vercel-gray-600 font-mono">
              {result.minimumHours}h {result.billedHours > result.roundedHours ? '(APPLIED)' : ''}
            </span>
          </div>
        )}
        {result.maximumHours !== null && (
          <div className="flex justify-between col-span-2">
            <span className="text-vercel-gray-400">Max Hours:</span>
            <span className="text-vercel-gray-600 font-mono">
              {result.maximumHours}h {result.billedHours < result.adjustedHours ? '(APPLIED)' : ''}
            </span>
          </div>
        )}
        {result.carryoverIn > 0 && (
          <div className="flex justify-between col-span-2">
            <span className="text-vercel-gray-400">Carryover In:</span>
            <span className="text-vercel-gray-600 font-mono">
              {formatHoursDisplay(result.carryoverIn)} hrs
            </span>
          </div>
        )}

        {/* Billed Hours (if different from rounded) */}
        {result.billedHours !== result.roundedHours && (
          <div className="flex justify-between">
            <span className="text-vercel-gray-400">Billed Hours:</span>
            <span className="text-vercel-gray-600 font-mono">
              {formatHoursDisplay(result.billedHours)} hrs
            </span>
          </div>
        )}

        {/* Billed Revenue (from diagnostic/raw files) */}
        <div className="flex justify-between items-center col-span-2 pt-2 border-t border-vercel-gray-100">
          <span className="text-vercel-gray-400 font-medium">Diagnostic Revenue:</span>
          <span className="flex items-center gap-1.5">
            <span className="text-vercel-gray-600 font-mono font-medium">
              {formatCurrencyDisplay(result.billedRevenue)}
            </span>
            <span className={result.checks.billedRevenue.status === 'pass' ? 'text-success' : 'text-error'}>
              {getStatusIcon(result.checks.billedRevenue.status)}
            </span>
          </span>
        </div>

        {/* App's calculated values (from database) */}
        {appBilling ? (
          <>
            <div className="flex justify-between items-center col-span-2">
              <span className="text-vercel-gray-400 font-medium">App Hours:</span>
              <span className={`font-mono font-medium ${hasHoursDiscrepancy ? 'text-error' : 'text-vercel-gray-600'}`}>
                {formatHoursDisplay(appBilling.roundedHours)} hrs
                {hasHoursDiscrepancy && (
                  <span className="text-xs ml-1">
                    (diff: {formatHoursDisplay(appBilling.roundedHours - result.roundedHours)})
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between items-center col-span-2">
              <span className="text-vercel-gray-400 font-medium">App Revenue:</span>
              <span className={`font-mono font-medium ${hasRevenueDiscrepancy ? 'text-error' : 'text-vercel-gray-600'}`}>
                {formatCurrencyDisplay(appBilling.billedRevenue)}
                {hasRevenueDiscrepancy && (
                  <span className="text-xs ml-1">
                    (diff: {formatCurrencyDisplay(appBilling.billedRevenue - result.billedRevenue)})
                  </span>
                )}
              </span>
            </div>
          </>
        ) : (
          <div className="col-span-2 text-xs text-vercel-gray-400 italic">
            No matching data in app database
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Validation summary component
 */
function ValidationSummary({ report }: { report: ValidationReport }) {
  const { summary } = report;

  return (
    <Card variant="elevated" padding="md" className="space-y-3">
      <h3 className="text-sm font-semibold text-vercel-gray-600 uppercase tracking-wide">
        Summary
      </h3>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-vercel-gray-400">Total Projects:</span>
          <span className="text-vercel-gray-600">
            {summary.totalProjects} (Clockify: {summary.clockifyProjects}, ClickUp: {summary.clickupProjects})
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-vercel-gray-400">Rounded Hours:</span>
          <Badge
            variant={summary.roundedHoursPassed === summary.totalProjects ? 'success' : 'error'}
            size="sm"
          >
            {summary.roundedHoursPassed}/{summary.totalProjects}
          </Badge>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-vercel-gray-400">Base Revenue:</span>
          <Badge
            variant={summary.baseRevenuePassed === summary.totalProjects ? 'success' : 'error'}
            size="sm"
          >
            {summary.baseRevenuePassed}/{summary.totalProjects}
          </Badge>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-vercel-gray-400">Billed Revenue:</span>
          <Badge
            variant={summary.billedRevenuePassed === summary.totalProjects ? 'success' : 'error'}
            size="sm"
          >
            {summary.billedRevenuePassed}/{summary.totalProjects}
          </Badge>
        </div>

        <div className="flex justify-between pt-2 border-t border-vercel-gray-100">
          <span className="text-vercel-gray-400 font-medium">Total:</span>
          <span className="text-vercel-gray-600 font-mono font-medium">
            {formatCurrencyDisplay(summary.totalBilledRevenue)}
          </span>
        </div>
      </div>
    </Card>
  );
}

/**
 * Comparison row for a single field
 */
function ComparisonRow({
  label,
  frontendValue,
  summaryValue,
  formatFn = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
}: {
  label: string;
  frontendValue: number;
  summaryValue: number;
  formatFn?: (v: number) => string;
}) {
  const diff = Math.abs(frontendValue - summaryValue);
  const hasDiff = diff > 0.005; // Tolerance for float display

  return (
    <tr className={hasDiff ? 'bg-error/5' : ''}>
      <td className="py-1 pr-3 text-vercel-gray-400">{label}</td>
      <td className="py-1 pr-3 text-right font-mono text-vercel-gray-600">{formatFn(frontendValue)}</td>
      <td className="py-1 pr-3 text-right font-mono text-vercel-gray-600">{formatFn(summaryValue)}</td>
      <td className={`py-1 text-right font-mono ${hasDiff ? 'text-error font-medium' : 'text-success'}`}>
        {hasDiff ? formatFn(frontendValue - summaryValue) : '0'}
      </td>
    </tr>
  );
}

/**
 * Summary vs Frontend comparison panel
 */
function SummaryComparisonPanel({
  frontendResult,
  summaryResult,
  summaryLoading,
  summaryError,
}: {
  frontendResult: MonthlyBillingResult | null;
  summaryResult: MonthlyBillingResult | null;
  summaryLoading: boolean;
  summaryError: string | null;
}) {
  // Build project lookup from frontend result (keyed by projectId)
  const frontendProjects = useMemo(() => {
    const map = new Map<string, ProjectBillingResult>();
    if (!frontendResult) return map;
    for (const company of frontendResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          map.set(project.projectId, project);
        }
      }
    }
    return map;
  }, [frontendResult]);

  // Build project lookup from summary result (keyed by projectId)
  const summaryProjects = useMemo(() => {
    const map = new Map<string, ProjectBillingResult>();
    if (!summaryResult) return map;
    for (const company of summaryResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          map.set(project.projectId, project);
        }
      }
    }
    return map;
  }, [summaryResult]);

  // Merge all project IDs from both sources
  const allProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of frontendProjects.keys()) ids.add(id);
    for (const id of summaryProjects.keys()) ids.add(id);
    return Array.from(ids).sort();
  }, [frontendProjects, summaryProjects]);

  // Count discrepancies (ignore DB-only projects with 0 hours/0 revenue — noise from SQL
  // creating rows for all canonical projects even when there are no entries)
  const discrepancyCount = useMemo(() => {
    let count = 0;
    for (const id of allProjectIds) {
      const fe = frontendProjects.get(id);
      const su = summaryProjects.get(id);
      // DB-only with 0 hours and 0 revenue is noise, not a real discrepancy
      if (!fe && su && su.billedHours === 0 && su.billedRevenue === 0) continue;
      // FE-only with 0 hours and 0 revenue is also noise
      if (fe && !su && fe.billedHours === 0 && fe.billedRevenue === 0) continue;
      if (!fe || !su) { count++; continue; }
      if (
        Math.abs(fe.roundedMinutes - su.roundedMinutes) > 0 ||
        Math.abs(fe.billedHours - su.billedHours) > 0.005 ||
        Math.abs(fe.billedRevenue - su.billedRevenue) > 0.005
      ) {
        count++;
      }
    }
    return count;
  }, [allProjectIds, frontendProjects, summaryProjects]);

  const fmtCurrency = (v: number) => formatCurrency(v) ?? '$0.00';
  const fmtHours = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMinutes = (v: number) => v.toLocaleString('en-US');

  if (summaryLoading) {
    return (
      <Card variant="default" padding="md">
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-vercel-gray-400">Loading summary table data...</span>
        </div>
      </Card>
    );
  }

  if (summaryError) {
    return (
      <Card variant="default" padding="md">
        <Alert message={`Summary table error: ${summaryError}`} icon="error" variant="error" />
      </Card>
    );
  }

  return (
    <Card variant="default" padding="md" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-vercel-gray-600 uppercase tracking-wide">
            Frontend vs Summary Table
          </h2>
          <p className="text-xs text-vercel-gray-400 mt-0.5">
            Compares in-browser billing (useUnifiedBilling) against pre-calculated summary table
          </p>
        </div>
        <Badge
          variant={discrepancyCount === 0 ? 'success' : 'error'}
          size="md"
        >
          {discrepancyCount === 0 ? 'All Match' : `${discrepancyCount} Discrepancies`}
        </Badge>
      </div>

      {/* Monthly Totals Comparison */}
      {frontendResult && summaryResult && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-vercel-gray-400 uppercase tracking-wide">
            Monthly Totals
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-vercel-gray-400 border-b border-vercel-gray-100">
                <tr>
                  <th className="text-left py-1 pr-3">Metric</th>
                  <th className="text-right py-1 pr-3">Frontend</th>
                  <th className="text-right py-1 pr-3">Summary</th>
                  <th className="text-right py-1">Diff</th>
                </tr>
              </thead>
              <tbody>
                <ComparisonRow label="Actual Minutes" frontendValue={frontendResult.actualMinutes} summaryValue={summaryResult.actualMinutes} formatFn={fmtMinutes} />
                <ComparisonRow label="Rounded Minutes" frontendValue={frontendResult.roundedMinutes} summaryValue={summaryResult.roundedMinutes} formatFn={fmtMinutes} />
                <ComparisonRow label="Rounded Hours" frontendValue={frontendResult.roundedHours} summaryValue={summaryResult.roundedHours} formatFn={fmtHours} />
                <ComparisonRow label="Billed Hours" frontendValue={frontendResult.billedHours} summaryValue={summaryResult.billedHours} formatFn={fmtHours} />
                <ComparisonRow label="Unbillable Hours" frontendValue={frontendResult.unbillableHours} summaryValue={summaryResult.unbillableHours} formatFn={fmtHours} />
                <ComparisonRow label="Base Revenue" frontendValue={frontendResult.baseRevenue} summaryValue={summaryResult.baseRevenue} formatFn={fmtCurrency} />
                <ComparisonRow label="Billed Revenue" frontendValue={frontendResult.billedRevenue} summaryValue={summaryResult.billedRevenue} formatFn={fmtCurrency} />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Project Comparison */}
      {allProjectIds.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-vercel-gray-400 uppercase tracking-wide">
            Per-Project ({allProjectIds.length} projects)
          </h3>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-vercel-gray-400 border-b border-vercel-gray-100 sticky top-0 bg-white">
                <tr>
                  <th className="text-left py-1 pr-2">Project</th>
                  <th className="text-right py-1 pr-2">FE Hours</th>
                  <th className="text-right py-1 pr-2">DB Hours</th>
                  <th className="text-right py-1 pr-2">FE Revenue</th>
                  <th className="text-right py-1 pr-2">DB Revenue</th>
                  <th className="text-right py-1">Status</th>
                </tr>
              </thead>
              <tbody className="text-vercel-gray-600">
                {allProjectIds.map((projectId) => {
                  const fe = frontendProjects.get(projectId);
                  const su = summaryProjects.get(projectId);

                  const hoursDiff = fe && su ? Math.abs(fe.billedHours - su.billedHours) : -1;
                  const revDiff = fe && su ? Math.abs(fe.billedRevenue - su.billedRevenue) : -1;
                  const hasIssue = !fe || !su || hoursDiff > 0.005 || revDiff > 0.005;
                  const projectName = fe?.projectName || su?.projectName || projectId;

                  return (
                    <tr key={projectId} className={`border-b border-vercel-gray-50 ${hasIssue ? 'bg-error/5' : ''}`}>
                      <td className="py-1 pr-2 font-medium truncate max-w-[200px]" title={projectName}>
                        {projectName}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {fe ? fmtHours(fe.billedHours) : '—'}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {su ? fmtHours(su.billedHours) : '—'}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {fe ? fmtCurrency(fe.billedRevenue) : '—'}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {su ? fmtCurrency(su.billedRevenue) : '—'}
                      </td>
                      <td className="py-1 text-right">
                        {!fe ? (
                          <Badge variant="warning" size="sm">DB only</Badge>
                        ) : !su ? (
                          <Badge variant="warning" size="sm">FE only</Badge>
                        ) : hasIssue ? (
                          <Badge variant="error" size="sm">Diff</Badge>
                        ) : (
                          <Badge variant="success" size="sm">Match</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!frontendResult && !summaryResult && (
        <p className="text-sm text-vercel-gray-400 text-center py-4">
          No billing data available for this month.
        </p>
      )}
    </Card>
  );
}

/**
 * Month selector component
 */
function MonthSelector({
  selectedMonth,
  onChange,
}: {
  selectedMonth: MonthSelection;
  onChange: (month: MonthSelection) => void;
}) {
  const handlePrev = () => {
    if (selectedMonth.month === 1) {
      onChange({ year: selectedMonth.year - 1, month: 12 });
    } else {
      onChange({ year: selectedMonth.year, month: selectedMonth.month - 1 });
    }
  };

  const handleNext = () => {
    if (selectedMonth.month === 12) {
      onChange({ year: selectedMonth.year + 1, month: 1 });
    } else {
      onChange({ year: selectedMonth.year, month: selectedMonth.month + 1 });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handlePrev}
        className="p-1.5 rounded hover:bg-vercel-gray-100 transition-colors"
        aria-label="Previous month"
      >
        <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-sm font-medium text-vercel-gray-600 min-w-[140px] text-center">
        {formatMonthDisplay(selectedMonth)}
      </span>
      <button
        onClick={handleNext}
        className="p-1.5 rounded hover:bg-vercel-gray-100 transition-colors"
        aria-label="Next month"
      >
        <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Diagnostics page component
 */
export function DiagnosticsPage() {
  const [selectedMonth, setSelectedMonth] = useState<MonthSelection>(getCurrentMonth);
  const [fileState, setFileState] = useState<FileUploadState>({
    clockifyContent: null,
    clickupContent: null,
    clockifyFileName: null,
    clickupFileName: null,
  });
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  // Key to force file input reset when clearing files
  const [inputKey, setInputKey] = useState(0);

  // Fetch billing configuration for the selected month
  const { projectsWithRates, isLoading: ratesLoading, error: ratesError } = useMonthlyRates({
    selectedMonth,
  });

  // Fetch companies for name lookup
  const { companies, loading: companiesLoading } = useCompanies();

  // Calculate date range for the selected month
  const dateRange = useMemo(() => {
    const monthDate = new Date(selectedMonth.year, selectedMonth.month - 1, 1);
    return {
      start: startOfMonth(monthDate),
      end: endOfMonth(monthDate),
    };
  }, [selectedMonth]);

  // Fetch timesheet entries from database for the selected month
  const { entries: dbEntries, projectCanonicalIdLookup, loading: entriesLoading } = useTimesheetData(dateRange);

  // Fetch summary table data for comparison
  const {
    billingResult: summaryBillingResult,
    isLoading: summaryLoading,
    error: summaryError,
  } = useSummaryBilling({ selectedMonth });

  // Use the SAME billing engine as Dashboard/RevenuePage (canonical grouping, carryover injection, etc.)
  const { billingResult: frontendBillingResult } = useUnifiedBilling({
    entries: dbEntries,
    projectsWithRates,
    projectCanonicalIdLookup,
  });

  // Build per-project lookup from unified billing result (for file-based validation cards)
  const appBillingByProject = useMemo(() => {
    const lookup = new Map<string, AppBillingData>();
    for (const company of frontendBillingResult.companies) {
      for (const project of company.projects) {
        if (project.projectId) {
          lookup.set(project.projectId, {
            roundedHours: project.roundedHours,
            billedHours: project.billedHours,
            billedRevenue: project.billedRevenue,
            rate: project.rate,
          });
        }
      }
    }
    return lookup;
  }, [frontendBillingResult]);

  // Build billing config lookup (ID-only)
  const billingConfigLookup = useMemo(() => {
    const lookup = new Map<string, BillingConfigLookup>();

    for (const project of projectsWithRates) {
      // Key by project ID only - no name fallbacks
      const config: BillingConfigLookup = {
        rate: project.effectiveRate,
        rounding: project.effectiveRounding,
        minimumHours: project.minimumHours,
        maximumHours: project.maximumHours,
        carryoverEnabled: project.carryoverEnabled,
        carryoverIn: project.carryoverHoursIn,
        isActive: project.isActive,
        matchedInSystem: true,
        matchedProjectName: project.projectName,
      };

      lookup.set(project.externalProjectId, config);
    }

    return lookup;
  }, [projectsWithRates]);

  // Build company name lookup (ID-only)
  const companyNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();

    for (const company of companies) {
      const displayName = company.display_name || company.client_name;
      // Key by client ID only - no name fallbacks
      lookup.set(company.client_id, displayName);
    }

    return lookup;
  }, [companies]);

  // Handle file upload
  const handleFileUpload = useCallback(
    (type: 'clockify' | 'clickup') => async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const content = await file.text();

        // Validate JSON
        JSON.parse(content);

        setFileState((prev) => ({
          ...prev,
          [`${type}Content`]: content,
          [`${type}FileName`]: file.name,
        }));
        setValidationError(null);
      } catch (err) {
        setValidationError(`Invalid JSON in ${type} file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    []
  );

  // Run validation
  const handleRunValidation = useCallback(() => {
    if (!fileState.clockifyContent && !fileState.clickupContent) {
      setValidationError('Please upload at least one source file.');
      return;
    }

    setIsValidating(true);
    setValidationError(null);

    try {
      // Parse entries from uploaded files
      const entries: NormalizedEntry[] = [];

      if (fileState.clockifyContent) {
        const clockifyEntries = parseClockify(fileState.clockifyContent);
        entries.push(...clockifyEntries);
      }

      if (fileState.clickupContent) {
        const clickupEntries = parseClickUp(fileState.clickupContent);
        entries.push(...clickupEntries);
      }

      if (entries.length === 0) {
        setValidationError('No time entries found in the uploaded files.');
        return;
      }

      // Build lookup functions (ID-only, no name fallbacks)
      const getBillingConfig = (projectId: string): BillingConfigLookup => {
        // Only look up by project ID - no name fallbacks
        const config = billingConfigLookup.get(projectId);
        if (config) return config;

        // Return default config (not matched in system)
        return {
          rate: 0,
          rounding: 15,
          minimumHours: null,
          maximumHours: null,
          carryoverEnabled: false,
          carryoverIn: 0,
          isActive: true,
          matchedInSystem: false,
          matchedProjectName: null,
        };
      };

      const getCompanyName = (clientId: string): string => {
        // Only look up by client ID - no name fallbacks
        const name = companyNameLookup.get(clientId);
        return name || 'Unknown';
      };

      // Run validation
      const report = runValidation(entries, {
        getBillingConfig,
        getCompanyName,
      });

      setValidationReport(report);
    } catch (err) {
      setValidationError(`Validation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsValidating(false);
    }
  }, [fileState, billingConfigLookup, companyNameLookup]);

  // Clear files
  const handleClearFiles = useCallback(() => {
    setFileState({
      clockifyContent: null,
      clickupContent: null,
      clockifyFileName: null,
      clickupFileName: null,
    });
    setValidationReport(null);
    setValidationError(null);
    // Increment key to force file input elements to reset
    setInputKey(prev => prev + 1);
  }, []);

  const isLoading = ratesLoading || companiesLoading || entriesLoading;
  const hasFiles = fileState.clockifyContent || fileState.clickupContent;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Diagnostics</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Validate billing calculations against raw source data
          </p>
        </div>
        <MonthSelector selectedMonth={selectedMonth} onChange={setSelectedMonth} />
      </div>

      {/* Error States */}
      {ratesError && <Alert message={ratesError} icon="error" variant="error" />}
      {validationError && <Alert message={validationError} icon="error" variant="error" />}

      {/* Loading State */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading billing configuration...</span>
        </div>
      ) : (
        <>
          {/* System Projects Reference */}
          <Card variant="subtle" padding="md" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-vercel-gray-600 uppercase tracking-wide">
                System Projects ({projectsWithRates.length})
              </h2>
              <span className="text-xs text-vercel-gray-400">
                Projects loaded from billing config for {formatMonthDisplay(selectedMonth)}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-vercel-gray-400 border-b border-vercel-gray-100">
                  <tr>
                    <th className="text-left py-1 pr-2">Project Name</th>
                    <th className="text-left py-1 pr-2">Client</th>
                    <th className="text-right py-1 pr-2">Rate</th>
                    <th className="text-left py-1">Project ID</th>
                  </tr>
                </thead>
                <tbody className="text-vercel-gray-600">
                  {projectsWithRates.slice(0, 50).map((project) => (
                    <tr key={project.projectId} className="border-b border-vercel-gray-50">
                      <td className="py-1 pr-2 font-medium">{project.projectName}</td>
                      <td className="py-1 pr-2">{project.clientName || '—'}</td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {formatCurrencyDisplay(project.effectiveRate)}
                      </td>
                      <td className="py-1 font-mono text-vercel-gray-400 truncate max-w-[200px]">
                        {project.externalProjectId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {projectsWithRates.length > 50 && (
                <p className="text-xs text-vercel-gray-400 mt-2">
                  Showing first 50 of {projectsWithRates.length} projects
                </p>
              )}
            </div>
          </Card>

          {/* Frontend vs Summary Table Comparison */}
          <SummaryComparisonPanel
            frontendResult={frontendBillingResult}
            summaryResult={summaryBillingResult}
            summaryLoading={summaryLoading}
            summaryError={summaryError}
          />

          {/* Upload Section */}
          <Card variant="default" padding="md" className="space-y-4">
            <h2 className="text-sm font-semibold text-vercel-gray-600 uppercase tracking-wide">
              Upload Raw Source Files
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Clockify Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-vercel-gray-600">
                  clockify.txt
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex-1">
                    <input
                      key={`clockify-${inputKey}`}
                      type="file"
                      accept=".txt,.json"
                      onChange={handleFileUpload('clockify')}
                      className="hidden"
                    />
                    <div className="flex items-center justify-center px-4 py-2 border border-vercel-gray-100 rounded-lg cursor-pointer hover:bg-vercel-gray-50 transition-colors">
                      {fileState.clockifyFileName ? (
                        <span className="text-sm text-vercel-gray-600 truncate">
                          {fileState.clockifyFileName}
                        </span>
                      ) : (
                        <span className="text-sm text-vercel-gray-400">Choose File</span>
                      )}
                    </div>
                  </label>
                  {fileState.clockifyFileName && (
                    <Badge variant="success" size="sm">Loaded</Badge>
                  )}
                </div>
              </div>

              {/* ClickUp Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-vercel-gray-600">
                  clickup.txt
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex-1">
                    <input
                      key={`clickup-${inputKey}`}
                      type="file"
                      accept=".txt,.json"
                      onChange={handleFileUpload('clickup')}
                      className="hidden"
                    />
                    <div className="flex items-center justify-center px-4 py-2 border border-vercel-gray-100 rounded-lg cursor-pointer hover:bg-vercel-gray-50 transition-colors">
                      {fileState.clickupFileName ? (
                        <span className="text-sm text-vercel-gray-600 truncate">
                          {fileState.clickupFileName}
                        </span>
                      ) : (
                        <span className="text-sm text-vercel-gray-400">Choose File</span>
                      )}
                    </div>
                  </label>
                  {fileState.clickupFileName && (
                    <Badge variant="success" size="sm">Loaded</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="primary"
                onClick={handleRunValidation}
                disabled={!hasFiles || isValidating}
              >
                {isValidating ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Validating...
                  </>
                ) : (
                  'Run Validation'
                )}
              </Button>
              {hasFiles && (
                <Button variant="secondary" onClick={handleClearFiles}>
                  Clear Files
                </Button>
              )}
            </div>
          </Card>

          {/* Validation Report */}
          {validationReport && (
            <div className="space-y-4">
              {/* Report Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-vercel-gray-600 uppercase tracking-wide">
                    Validation Report
                  </h2>
                  <p className="text-xs text-vercel-gray-400 mt-0.5">
                    Generated: {new Date(validationReport.generatedAt).toLocaleString()}
                  </p>
                </div>
                <Badge
                  variant={validationReport.summary.allPassed ? 'success' : 'error'}
                  size="md"
                >
                  {validationReport.summary.allPassed ? 'All Passed' : 'Issues Found'}
                </Badge>
              </div>

              {/* Summary Card */}
              <ValidationSummary report={validationReport} />

              {/* Project Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {validationReport.projects.map((result) => (
                  <ProjectValidationCard
                    key={`${result.source}:${result.clientName}:${result.projectName}`}
                    result={result}
                    appBilling={appBillingByProject.get(result.sourceProjectId) || null}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
