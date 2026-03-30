/**
 * EOMReportsPage - Reports (End of Month + Weekly Status)
 *
 * Drill-down page displaying generated CSV reports organized by
 * Year > Month > Customer (EOM) and Year > Month > Week > Company (Weekly),
 * with download, regenerate, resend, and backfill actions.
 *
 * Uses custom inline accordions with ChevronIcon for hierarchy.
 *
 * @official 2026-03-30
 * @category Page
 */

import { useState, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { useEOMReports, MONTH_NAMES } from '../../hooks/useEOMReports';
import { useWeeklyReports } from '../../hooks/useWeeklyReports';
import type { WeeklyCompanyReport, WeekGroup, WeeklyMonthGroup } from '../../hooks/useWeeklyReports';
import { useQBOConnection } from '../../hooks/useQBOConnection';
import { useQBOCustomerMappings } from '../../hooks/useQBOCustomerMappings';
import type { EOMCustomerReport, EOMMonthGroup } from '../../hooks/useEOMReports';
import { Card } from '../Card';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { Modal } from '../Modal';
import { Tooltip } from '../Tooltip';

// ============================================================================
// ICONS (inline SVGs using design system token classes)
// ============================================================================

function DownloadIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-vercel-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ============================================================================
// EOM SUB-COMPONENTS
// ============================================================================

interface CustomerRowProps {
  customer: EOMCustomerReport;
  isDownloading: boolean;
  isRegenerating: boolean;
  isMappedToQBO: boolean;
  qboConnected: boolean;
  onDownload: () => void;
  onRegenerate: () => void;
}

function CustomerRow({
  customer,
  isDownloading,
  isRegenerating,
  isMappedToQBO,
  qboConnected,
  onDownload,
  onRegenerate,
}: CustomerRowProps) {
  const statusBadge = (() => {
    switch (customer.status) {
      case 'generated':
        return (
          <Tooltip
            content={customer.generatedAt
              ? `Generated ${format(new Date(customer.generatedAt), 'MMM d, yyyy h:mm a')}${customer.generationNumber && customer.generationNumber > 1 ? ` (v${customer.generationNumber})` : ''}`
              : 'Generated'}
          >
            <Badge variant="success" size="sm">Generated</Badge>
          </Tooltip>
        );
      case 'available':
        return <Badge variant="default" size="sm">Available</Badge>;
      case 'pending':
        return <Badge variant="warning" size="sm">Pending</Badge>;
    }
  })();

  return (
    <div className="flex items-center justify-between py-2.5 px-4 hover:bg-vercel-gray-50 transition-colors rounded-md">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm text-vercel-gray-600 truncate">{customer.companyName}</span>
        {statusBadge}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
        <Tooltip content={customer.storagePath ? 'Download CSV' : 'No report available'}>
          <Button
            variant="secondary"
            size="sm"
            disabled={!customer.storagePath || isDownloading}
            onClick={onDownload}
          >
            {isDownloading ? <Spinner size="sm" /> : <DownloadIcon />}
            <span className="ml-1.5">Download</span>
          </Button>
        </Tooltip>
        {qboConnected && isMappedToQBO && (
          <Tooltip content="Coming soon">
            <Button
              variant="secondary"
              size="sm"
              disabled
            >
              <span className="ml-1.5">Send to QB</span>
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Regenerate report">
          <Button
            variant="ghost"
            size="sm"
            disabled={isRegenerating}
            onClick={onRegenerate}
          >
            {isRegenerating ? <Spinner size="sm" /> : <RefreshIcon />}
            <span className="ml-1.5">Regenerate</span>
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

interface MonthAccordionProps {
  monthGroup: EOMMonthGroup;
  defaultExpanded: boolean;
  downloadingReports: Map<string, boolean>;
  regeneratingReports: Map<string, boolean>;
  isGeneratingMonth: boolean;
  mappedCompanyIds: Set<string>;
  qboConnected: boolean;
  onDownload: (storagePath: string, companyName: string, year: number, month: number) => void;
  onGenerateMonth: (year: number, month: number) => void;
  onOpenConfirmModal: (customer: EOMCustomerReport, year: number, month: number) => void;
}

function MonthAccordion({
  monthGroup,
  defaultExpanded,
  downloadingReports,
  regeneratingReports,
  isGeneratingMonth,
  mappedCompanyIds,
  qboConnected,
  onDownload,
  onOpenConfirmModal,
  onGenerateMonth,
}: MonthAccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      {/* Month header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center gap-3 p-4 text-left hover:bg-vercel-gray-50 transition-colors focus:outline-none"
        >
          <ChevronIcon expanded={expanded} />
          <span className="text-sm font-medium text-vercel-gray-600">{monthGroup.label}</span>
          <span className="text-xs font-mono text-vercel-gray-300">
            {monthGroup.generatedCount}/{monthGroup.totalCount} reports generated
          </span>
        </button>
        <div className="pr-4 flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isGeneratingMonth}
            onClick={(e) => {
              e.stopPropagation();
              onGenerateMonth(monthGroup.year, monthGroup.month);
            }}
          >
            {isGeneratingMonth ? (
              <>
                <Spinner size="sm" />
                <span className="ml-1.5">Generating...</span>
              </>
            ) : (
              <>
                <RefreshIcon />
                <span className="ml-1.5">Regenerate All</span>
              </>
            )}
          </Button>
          {qboConnected && (
            <Button
              variant="secondary"
              size="sm"
              disabled
            >
              Send All to QB
            </Button>
          )}
        </div>
      </div>

      {/* Customer rows */}
      {expanded && (
        <div className="border-t border-vercel-gray-100 py-1 px-2">
          {monthGroup.customers.map(customer => {
            const rKey = `${customer.companyId}-${monthGroup.year}-${monthGroup.month}`;
            const dKey = `${customer.storagePath}-${monthGroup.year}-${monthGroup.month}`;

            return (
              <CustomerRow
                key={customer.companyId}
                customer={customer}
                isDownloading={downloadingReports.get(dKey) || false}
                isRegenerating={regeneratingReports.get(rKey) || false}
                isMappedToQBO={mappedCompanyIds.has(customer.companyId)}
                qboConnected={qboConnected}
                onDownload={() => {
                  if (customer.storagePath) {
                    onDownload(customer.storagePath, customer.companyName, monthGroup.year, monthGroup.month);
                  }
                }}
                onRegenerate={() => {
                  onOpenConfirmModal(customer, monthGroup.year, monthGroup.month);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface EOMYearAccordionProps {
  yearGroup: { year: number; months: EOMMonthGroup[] };
  defaultExpanded: boolean;
  currentMonth: { year: number; month: number };
  downloadingReports: Map<string, boolean>;
  regeneratingReports: Map<string, boolean>;
  generatingMonths: Map<string, boolean>;
  mappedCompanyIds: Set<string>;
  qboConnected: boolean;
  onDownload: (storagePath: string, companyName: string, year: number, month: number) => void;
  onGenerateMonth: (year: number, month: number) => void;
  onOpenConfirmModal: (customer: EOMCustomerReport, year: number, month: number) => void;
}

function EOMYearAccordion({
  yearGroup,
  defaultExpanded,
  currentMonth,
  downloadingReports,
  regeneratingReports,
  generatingMonths,
  mappedCompanyIds,
  qboConnected,
  onDownload,
  onGenerateMonth,
  onOpenConfirmModal,
}: EOMYearAccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="space-y-3">
      {/* Year header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 bg-white rounded-lg border border-vercel-gray-100 hover:bg-vercel-gray-50 transition-colors focus:outline-none text-left"
      >
        <ChevronIcon expanded={expanded} />
        <span className="text-lg font-semibold text-vercel-gray-600">{yearGroup.year}</span>
        <span className="text-xs font-mono text-vercel-gray-300">
          {yearGroup.months.length} {yearGroup.months.length === 1 ? 'month' : 'months'}
        </span>
      </button>

      {/* Month accordions */}
      {expanded && (
        <div className="space-y-3 ml-6">
          {yearGroup.months.map(monthGroup => {
            const isMostRecent =
              monthGroup.year === currentMonth.year &&
              monthGroup.month === currentMonth.month;

            return (
              <MonthAccordion
                key={`${monthGroup.year}-${monthGroup.month}`}
                monthGroup={monthGroup}
                defaultExpanded={isMostRecent}
                downloadingReports={downloadingReports}
                regeneratingReports={regeneratingReports}
                isGeneratingMonth={generatingMonths.get(`${monthGroup.year}-${monthGroup.month}`) || false}
                mappedCompanyIds={mappedCompanyIds}
                qboConnected={qboConnected}
                onDownload={onDownload}
                onGenerateMonth={onGenerateMonth}
                onOpenConfirmModal={onOpenConfirmModal}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// WEEKLY SUB-COMPONENTS
// ============================================================================

interface WeeklyCompanyRowProps {
  company: WeeklyCompanyReport;
  isDownloading: boolean;
  isResending: boolean;
  onDownload: () => void;
  onResend: () => void;
}

function WeeklyCompanyRow({
  company,
  isDownloading,
  isResending,
  onDownload,
  onResend,
}: WeeklyCompanyRowProps) {
  const statusBadge = company.hasReport ? (
    <Tooltip
      content={company.generatedAt
        ? `Generated ${format(new Date(company.generatedAt), 'MMM d, yyyy h:mm a')}`
        : 'Generated'}
    >
      <Badge variant="success" size="sm">Generated</Badge>
    </Tooltip>
  ) : (
    <Badge variant="default" size="sm">Available</Badge>
  );

  return (
    <div className="flex items-center justify-between py-2.5 px-4 hover:bg-vercel-gray-50 transition-colors rounded-md">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm text-vercel-gray-600 truncate">{company.companyName}</span>
        {statusBadge}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
        <Tooltip content={company.hasReport ? 'Download CSV' : 'Generate and download CSV'}>
          <Button
            variant="secondary"
            size="sm"
            disabled={isDownloading}
            onClick={onDownload}
          >
            {isDownloading ? <Spinner size="sm" /> : <DownloadIcon />}
            <span className="ml-1.5">Download</span>
          </Button>
        </Tooltip>
        <Tooltip content="Resend weekly report email to project managers">
          <Button
            variant="secondary"
            size="sm"
            disabled={isResending}
            onClick={onResend}
          >
            {isResending ? <Spinner size="sm" /> : <MailIcon />}
            <span className="ml-1.5">Resend Report</span>
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

interface WeekAccordionProps {
  week: WeekGroup;
  defaultExpanded: boolean;
  downloadingReports: Map<string, boolean>;
  resendingReports: Map<string, boolean>;
  onDownload: (storagePath: string | null, companyId: string, companyName: string, weekStart: string, weekEnd: string) => void;
  onOpenResendModal: (company: WeeklyCompanyReport, weekStart: string, weekEnd: string, weekLabel: string) => void;
}

function WeekAccordion({
  week,
  defaultExpanded,
  downloadingReports,
  resendingReports,
  onDownload,
  onOpenResendModal,
}: WeekAccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      {/* Week header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-vercel-gray-50 transition-colors focus:outline-none"
      >
        <ChevronIcon expanded={expanded} />
        <span className="text-sm font-medium text-vercel-gray-600">{week.weekLabel}</span>
        <span className="text-xs font-mono text-vercel-gray-300">
          {week.generatedCount}/{week.totalCount} reports generated
        </span>
      </button>

      {/* Company rows */}
      {expanded && (
        <div className="border-t border-vercel-gray-100 py-1 px-2">
          {week.companies.map(company => {
            const dKey = `${company.companyId}-${week.weekStart}`;
            const rKey = `${company.companyId}-${week.weekStart}`;

            return (
              <WeeklyCompanyRow
                key={company.companyId}
                company={company}
                isDownloading={downloadingReports.get(dKey) || false}
                isResending={resendingReports.get(rKey) || false}
                onDownload={() => {
                  onDownload(company.storagePath, company.companyId, company.companyName, week.weekStart, week.weekEnd);
                }}
                onResend={() => {
                  onOpenResendModal(company, week.weekStart, week.weekEnd, week.weekLabel);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface WeeklyMonthAccordionProps {
  monthGroup: WeeklyMonthGroup;
  defaultExpanded: boolean;
  mostRecentWeekStart: string | null;
  downloadingReports: Map<string, boolean>;
  resendingReports: Map<string, boolean>;
  onDownload: (storagePath: string | null, companyId: string, companyName: string, weekStart: string, weekEnd: string) => void;
  onOpenResendModal: (company: WeeklyCompanyReport, weekStart: string, weekEnd: string, weekLabel: string) => void;
}

function WeeklyMonthAccordion({
  monthGroup,
  defaultExpanded,
  mostRecentWeekStart,
  downloadingReports,
  resendingReports,
  onDownload,
  onOpenResendModal,
}: WeeklyMonthAccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Compute total generated/total across all weeks in this month
  const totalGenerated = monthGroup.weeks.reduce((sum, w) => sum + w.generatedCount, 0);
  const totalCount = monthGroup.weeks.reduce((sum, w) => sum + w.totalCount, 0);

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      {/* Month header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-vercel-gray-50 transition-colors focus:outline-none"
      >
        <ChevronIcon expanded={expanded} />
        <span className="text-sm font-medium text-vercel-gray-600">{monthGroup.label}</span>
        <span className="text-xs font-mono text-vercel-gray-300">
          {totalGenerated}/{totalCount} reports generated
        </span>
      </button>

      {/* Week accordions */}
      {expanded && (
        <div className="border-t border-vercel-gray-100 p-3 space-y-3">
          {monthGroup.weeks.map(week => {
            const isMostRecent = week.weekStart === mostRecentWeekStart;

            return (
              <WeekAccordion
                key={week.weekStart}
                week={week}
                defaultExpanded={isMostRecent}
                downloadingReports={downloadingReports}
                resendingReports={resendingReports}
                onDownload={onDownload}
                onOpenResendModal={onOpenResendModal}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface WeeklyYearAccordionProps {
  yearGroup: { year: number; months: WeeklyMonthGroup[] };
  defaultExpanded: boolean;
  mostRecentMonth: number | null;
  mostRecentWeekStart: string | null;
  downloadingReports: Map<string, boolean>;
  resendingReports: Map<string, boolean>;
  onDownload: (storagePath: string | null, companyId: string, companyName: string, weekStart: string, weekEnd: string) => void;
  onOpenResendModal: (company: WeeklyCompanyReport, weekStart: string, weekEnd: string, weekLabel: string) => void;
}

function WeeklyYearAccordion({
  yearGroup,
  defaultExpanded,
  mostRecentMonth,
  mostRecentWeekStart,
  downloadingReports,
  resendingReports,
  onDownload,
  onOpenResendModal,
}: WeeklyYearAccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Count total months
  const monthCount = yearGroup.months.length;

  return (
    <div className="space-y-3">
      {/* Year header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 bg-white rounded-lg border border-vercel-gray-100 hover:bg-vercel-gray-50 transition-colors focus:outline-none text-left"
      >
        <ChevronIcon expanded={expanded} />
        <span className="text-lg font-semibold text-vercel-gray-600">{yearGroup.year}</span>
        <span className="text-xs font-mono text-vercel-gray-300">
          {monthCount} {monthCount === 1 ? 'month' : 'months'}
        </span>
      </button>

      {/* Month accordions */}
      {expanded && (
        <div className="space-y-3 ml-6">
          {yearGroup.months.map(monthGroup => {
            const isMostRecentMonth = monthGroup.month === mostRecentMonth;

            return (
              <WeeklyMonthAccordion
                key={`${monthGroup.year}-${monthGroup.month}`}
                monthGroup={monthGroup}
                defaultExpanded={isMostRecentMonth}
                mostRecentWeekStart={isMostRecentMonth ? mostRecentWeekStart : null}
                downloadingReports={downloadingReports}
                resendingReports={resendingReports}
                onDownload={onDownload}
                onOpenResendModal={onOpenResendModal}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export function EOMReportsPage() {
  const [activeView, setActiveView] = useState<'eom' | 'weekly'>('eom');

  // ---- EOM hook ----
  const {
    years: eomYears,
    loading: eomLoading,
    error: eomError,
    regeneratingReports,
    downloadingReports: eomDownloadingReports,
    generatingMonths,
    backfilling,
    downloadReport: eomDownloadReport,
    regenerateReport,
    generateMonth,
    backfillAll,
  } = useEOMReports();

  // ---- Weekly hook ----
  const {
    years: weeklyYears,
    loading: weeklyLoading,
    error: weeklyError,
    downloadingReports: weeklyDownloadingReports,
    resendingReports: weeklyResendingReports,
    downloadReport: weeklyDownloadReport,
    resendReport: weeklyResendReport,
  } = useWeeklyReports();

  // ---- QBO ----
  const {
    isConnected: qboConnected,
    realmId: qboRealmId,
    isLoading: qboLoading,
    error: qboError,
    startConnection: qboStartConnection,
    disconnect: qboDisconnect,
  } = useQBOConnection();

  const {
    mappings: qboMappings,
    error: qboMappingError,
  } = useQBOCustomerMappings();

  const mappedCompanyIds = useMemo(() => {
    return new Set(qboMappings.map(m => m.company_id));
  }, [qboMappings]);

  // ---- QBO disconnect confirmation modal state ----
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  const handleConfirmDisconnect = useCallback(async () => {
    setShowDisconnectModal(false);
    await qboDisconnect();
  }, [qboDisconnect]);

  // ---- EOM Regeneration confirmation modal state ----
  const [confirmModal, setConfirmModal] = useState<{
    customer: EOMCustomerReport;
    year: number;
    month: number;
  } | null>(null);

  const handleOpenConfirmModal = useCallback((
    customer: EOMCustomerReport,
    year: number,
    month: number,
  ) => {
    setConfirmModal({ customer, year, month });
  }, []);

  const handleConfirmRegenerate = useCallback(async () => {
    if (!confirmModal) return;
    const { customer, year, month } = confirmModal;
    setConfirmModal(null);
    await regenerateReport(year, month, customer.companyId);
  }, [confirmModal, regenerateReport]);

  // ---- Weekly Resend confirmation modal state ----
  const [weeklyResendModal, setWeeklyResendModal] = useState<{
    company: WeeklyCompanyReport;
    weekStart: string;
    weekEnd: string;
    weekLabel: string;
  } | null>(null);
  const [weeklyResendAlert, setWeeklyResendAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleOpenWeeklyResendModal = useCallback((
    company: WeeklyCompanyReport,
    weekStart: string,
    weekEnd: string,
    weekLabel: string,
  ) => {
    setWeeklyResendModal({ company, weekStart, weekEnd, weekLabel });
  }, []);

  const handleConfirmWeeklyResend = useCallback(async () => {
    if (!weeklyResendModal) return;
    const { company, weekStart, weekEnd, weekLabel } = weeklyResendModal;
    setWeeklyResendModal(null);
    setWeeklyResendAlert(null);

    try {
      const result = await weeklyResendReport(company.companyId, company.companyName, weekStart, weekEnd);
      setWeeklyResendAlert({
        type: 'success',
        message: `Weekly report for ${company.companyName} (${weekLabel}) sent to ${result?.sentTo?.join(', ') || 'project managers'}.`,
      });
    } catch (err) {
      setWeeklyResendAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to resend weekly report',
      });
    }
  }, [weeklyResendModal, weeklyResendReport]);

  // ---- EOM default expansion ----
  const eomMostRecentMonth = eomYears.length > 0 && eomYears[0].months.length > 0
    ? { year: eomYears[0].months[0].year, month: eomYears[0].months[0].month }
    : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

  // ---- Weekly default expansion ----
  const weeklyMostRecent = useMemo(() => {
    if (weeklyYears.length === 0) return { year: null as number | null, month: null as number | null, weekStart: null as string | null };
    const firstYear = weeklyYears[0];
    if (firstYear.months.length === 0) return { year: firstYear.year, month: null, weekStart: null };
    const firstMonth = firstYear.months[0];
    if (firstMonth.weeks.length === 0) return { year: firstYear.year, month: firstMonth.month, weekStart: null };
    return { year: firstYear.year, month: firstMonth.month, weekStart: firstMonth.weeks[0].weekStart };
  }, [weeklyYears]);

  // Determine which loading/error to show based on active view
  const loading = activeView === 'eom' ? eomLoading : weeklyLoading;
  const error = activeView === 'eom' ? eomError : weeklyError;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-vercel-gray-600">
              Reports
            </h1>
            <p className="text-sm text-vercel-gray-400 mt-1">
              Monthly and weekly revenue reports per customer.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* QBO Connection Status / Button */}
            {qboLoading ? (
              <Spinner size="sm" />
            ) : qboConnected ? (
              <div className="flex items-center gap-2">
                <Badge variant="success" size="sm">QB Connected</Badge>
                <Tooltip content={qboRealmId ? `Realm: ${qboRealmId}` : 'Disconnect QuickBooks'}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDisconnectModal(true)}
                  >
                    Disconnect
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="md"
                onClick={qboStartConnection}
              >
                Connect to QuickBooks
              </Button>
            )}
            {activeView === 'eom' && (
              <Button
                variant="secondary"
                size="md"
                disabled={backfilling || eomLoading}
                onClick={backfillAll}
              >
                {backfilling ? (
                  <>
                    <Spinner size="sm" />
                    <span className="ml-2">Generating...</span>
                  </>
                ) : (
                  'Generate All Missing'
                )}
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* View Toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={activeView === 'eom' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setActiveView('eom')}
        >
          End of Month
        </Button>
        <Button
          variant={activeView === 'weekly' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setActiveView('weekly')}
        >
          Weekly Status
        </Button>
      </div>
      <div className="border-t border-vercel-gray-100" />

      {/* Error States */}
      {error && <Alert message={error} icon="error" variant="error" />}
      {qboError && <Alert message={qboError} icon="error" variant="error" />}
      {qboMappingError && <Alert message={qboMappingError} icon="error" variant="error" />}

      {/* Weekly Resend Alert */}
      {activeView === 'weekly' && weeklyResendAlert && (
        <Alert
          message={weeklyResendAlert.message}
          icon={weeklyResendAlert.type === 'success' ? 'info' : 'error'}
          variant={weeklyResendAlert.type === 'success' ? 'default' : 'error'}
        />
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading reports...</span>
        </div>
      )}

      {/* ================================================================ */}
      {/* EOM VIEW                                                         */}
      {/* ================================================================ */}
      {activeView === 'eom' && (
        <>
          {/* Empty State */}
          {!eomLoading && eomYears.length === 0 && !eomError && (
            <Card padding="lg">
              <div className="text-center py-8 space-y-4">
                <p className="text-sm text-vercel-gray-400">
                  No end-of-month reports are available yet. Reports become eligible on the 5th
                  of each month for the preceding billing period.
                </p>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={backfilling}
                  onClick={backfillAll}
                >
                  {backfilling ? (
                    <>
                      <Spinner size="sm" />
                      <span className="ml-2">Generating...</span>
                    </>
                  ) : (
                    'Generate All Missing'
                  )}
                </Button>
              </div>
            </Card>
          )}

          {/* Drill-down Hierarchy */}
          {!eomLoading && eomYears.length > 0 && (
            <div className="space-y-4">
              {eomYears.map(yearGroup => (
                <EOMYearAccordion
                  key={yearGroup.year}
                  yearGroup={yearGroup}
                  defaultExpanded={yearGroup.year === eomMostRecentMonth.year}
                  currentMonth={eomMostRecentMonth}
                  downloadingReports={eomDownloadingReports}
                  regeneratingReports={regeneratingReports}
                  generatingMonths={generatingMonths}
                  mappedCompanyIds={mappedCompanyIds}
                  qboConnected={qboConnected}
                  onDownload={eomDownloadReport}
                  onGenerateMonth={generateMonth}
                  onOpenConfirmModal={handleOpenConfirmModal}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ================================================================ */}
      {/* WEEKLY VIEW                                                      */}
      {/* ================================================================ */}
      {activeView === 'weekly' && (
        <>
          {/* Empty State */}
          {!weeklyLoading && weeklyYears.length === 0 && !weeklyError && (
            <Card padding="lg">
              <div className="text-center py-8">
                <p className="text-sm text-vercel-gray-400">
                  No weekly reports are available yet. Weekly reports are generated for each
                  completed Monday-Sunday billing week.
                </p>
              </div>
            </Card>
          )}

          {/* Drill-down Hierarchy */}
          {!weeklyLoading && weeklyYears.length > 0 && (
            <div className="space-y-4">
              {weeklyYears.map(yearGroup => (
                <WeeklyYearAccordion
                  key={yearGroup.year}
                  yearGroup={yearGroup}
                  defaultExpanded={yearGroup.year === weeklyMostRecent.year}
                  mostRecentMonth={yearGroup.year === weeklyMostRecent.year ? weeklyMostRecent.month : null}
                  mostRecentWeekStart={yearGroup.year === weeklyMostRecent.year ? weeklyMostRecent.weekStart : null}
                  downloadingReports={weeklyDownloadingReports}
                  resendingReports={weeklyResendingReports}
                  onDownload={weeklyDownloadReport}
                  onOpenResendModal={handleOpenWeeklyResendModal}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* EOM Regeneration Confirmation Modal */}
      <Modal
        isOpen={confirmModal !== null}
        onClose={() => setConfirmModal(null)}
        title="Regenerate Report"
        maxWidth="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmModal(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmRegenerate}>
              Regenerate
            </Button>
          </>
        }
      >
        {confirmModal && (
          <p className="text-sm text-vercel-gray-400">
            This will regenerate the CSV report for{' '}
            <span className="font-medium text-vercel-gray-600">{confirmModal.customer.companyName}</span>
            {' '}&mdash;{' '}
            <span className="font-medium text-vercel-gray-600">
              {MONTH_NAMES[confirmModal.month - 1]} {confirmModal.year}
            </span>.
            {confirmModal.customer.status === 'generated' && ' The previous version will be replaced.'}
          </p>
        )}
      </Modal>

      {/* Weekly Resend Report Confirmation Modal */}
      <Modal
        isOpen={weeklyResendModal !== null}
        onClose={() => setWeeklyResendModal(null)}
        title="Resend Weekly Report"
        maxWidth="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWeeklyResendModal(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmWeeklyResend}>
              Send
            </Button>
          </>
        }
      >
        {weeklyResendModal && (
          <p className="text-sm text-vercel-gray-400">
            This will email the weekly revenue report for{' '}
            <span className="font-medium text-vercel-gray-600">{weeklyResendModal.company.companyName}</span>
            {' '}(week of{' '}
            <span className="font-medium text-vercel-gray-600">{weeklyResendModal.weekLabel}</span>
            ) to all assigned project managers. If a report has not been generated yet, one will be created automatically.
          </p>
        )}
      </Modal>

      {/* QBO Disconnect Confirmation Modal */}
      <Modal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        title="Disconnect QuickBooks"
        maxWidth="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDisconnectModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDisconnect}>
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm text-vercel-gray-400">
          This will remove the QuickBooks Online connection. You will need to re-authorize
          to send invoices to QuickBooks.
        </p>
      </Modal>

    </div>
  );
}
