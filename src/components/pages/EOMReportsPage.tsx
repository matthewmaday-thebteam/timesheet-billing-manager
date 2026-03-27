/**
 * EOMReportsPage - End of Month Reports
 *
 * Drill-down page displaying generated CSV reports organized by
 * Year > Month > Customer, with download, regenerate, and backfill actions.
 *
 * Uses AccordionNested for the hierarchy, with custom customer rows
 * showing status badges and action buttons.
 *
 * @official 2026-03-27
 * @category Page
 */

import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useEOMReports, MONTH_NAMES } from '../../hooks/useEOMReports';
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
// SUB-COMPONENTS
// ============================================================================

interface CustomerRowProps {
  customer: EOMCustomerReport;
  isDownloading: boolean;
  isRegenerating: boolean;
  onDownload: () => void;
  onRegenerate: () => void;
}

function CustomerRow({
  customer,
  isDownloading,
  isRegenerating,
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
        <Tooltip content="Send to QuickBooks">
          <Button
            variant="secondary"
            size="sm"
            disabled
          >
            <span className="ml-1.5">Send to QB</span>
          </Button>
        </Tooltip>
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
          <Button
            variant="secondary"
            size="sm"
            disabled
          >
            Send All to QB
          </Button>
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

interface YearAccordionProps {
  yearGroup: { year: number; months: EOMMonthGroup[] };
  defaultExpanded: boolean;
  currentMonth: { year: number; month: number };
  downloadingReports: Map<string, boolean>;
  regeneratingReports: Map<string, boolean>;
  generatingMonths: Map<string, boolean>;
  onDownload: (storagePath: string, companyName: string, year: number, month: number) => void;
  onGenerateMonth: (year: number, month: number) => void;
  onOpenConfirmModal: (customer: EOMCustomerReport, year: number, month: number) => void;
}

function YearAccordion({
  yearGroup,
  defaultExpanded,
  currentMonth,
  downloadingReports,
  regeneratingReports,
  generatingMonths,
  onDownload,
  onGenerateMonth,
  onOpenConfirmModal,
}: YearAccordionProps) {
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
            // Most recent month in the most recent year is expanded by default
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
// MAIN PAGE COMPONENT
// ============================================================================

export function EOMReportsPage() {
  const {
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
  } = useEOMReports();

  // ---- Regeneration confirmation modal state ----
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

  // Determine current year/month for default expansion
  const now = new Date();
  const currentMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };

  // Find the most recent month that has data (for default expansion)
  const mostRecentMonth = years.length > 0 && years[0].months.length > 0
    ? { year: years[0].months[0].year, month: years[0].months[0].month }
    : currentMonth;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-vercel-gray-600">
              End of Month Reports
            </h1>
            <p className="text-sm text-vercel-gray-400 mt-1">
              Monthly CSV revenue reports per customer, generated after the 5th of each month.
            </p>
          </div>
          <Button
            variant="secondary"
            size="md"
            disabled={backfilling || loading}
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
      </section>

      {/* Error State */}
      {error && <Alert message={error} icon="error" variant="error" />}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading reports...</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && years.length === 0 && !error && (
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
      {!loading && years.length > 0 && (
        <div className="space-y-4">
          {years.map(yearGroup => (
            <YearAccordion
              key={yearGroup.year}
              yearGroup={yearGroup}
              defaultExpanded={yearGroup.year === mostRecentMonth.year}
              currentMonth={mostRecentMonth}
              downloadingReports={downloadingReports}
              regeneratingReports={regeneratingReports}
              generatingMonths={generatingMonths}
              onDownload={downloadReport}
              onGenerateMonth={generateMonth}
              onOpenConfirmModal={handleOpenConfirmModal}
            />
          ))}
        </div>
      )}

      {/* Regeneration Confirmation Modal */}
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
    </div>
  );
}
