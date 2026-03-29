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

import { useState, useCallback, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { useEOMReports, MONTH_NAMES } from '../../hooks/useEOMReports';
import { useQBOConnection } from '../../hooks/useQBOConnection';
import { useQBOCustomerMappings } from '../../hooks/useQBOCustomerMappings';
import type { EOMCustomerReport, EOMMonthGroup } from '../../hooks/useEOMReports';
import type { QBOCustomer } from '../../types';
import { Card } from '../Card';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { Modal } from '../Modal';
import { Select } from '../Select';
import type { SelectOption } from '../Select';
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
  isMappedToQBO: boolean;
  onDownload: () => void;
  onRegenerate: () => void;
}

function CustomerRow({
  customer,
  isDownloading,
  isRegenerating,
  isMappedToQBO,
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
        <Tooltip content={isMappedToQBO ? 'Coming soon' : 'Map this company to a QuickBooks customer first'}>
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
  mappedCompanyIds: Set<string>;
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
                isMappedToQBO={mappedCompanyIds.has(customer.companyId)}
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
  mappedCompanyIds: Set<string>;
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
  mappedCompanyIds,
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
                mappedCompanyIds={mappedCompanyIds}
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
// QBO CUSTOMER MAPPING MODAL
// ============================================================================

/** Local state for a single company row in the mapping modal */
interface MappingRowState {
  companyId: string;
  companyName: string;
  selectedQBOCustomerId: string;
  originalQBOCustomerId: string;
  isSaving: boolean;
  saveSuccess: boolean;
}

interface QBOCustomerMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  companies: { companyId: string; companyName: string }[];
  getMappingForCompany: (companyId: string) => { qbo_customer_id: string; qbo_customer_name: string } | undefined;
  fetchQBOCustomers: () => Promise<QBOCustomer[]>;
  saveMapping: (companyId: string, qboCustomerId: string, qboCustomerName: string) => Promise<boolean>;
  removeMapping: (companyId: string) => Promise<boolean>;
}

function QBOCustomerMappingModal({
  isOpen,
  onClose,
  companies,
  getMappingForCompany,
  fetchQBOCustomers,
  saveMapping,
  removeMapping,
}: QBOCustomerMappingModalProps) {
  const [qboCustomers, setQboCustomers] = useState<QBOCustomer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Map<string, MappingRowState>>(new Map());

  // Build Select options from QBO customers
  const qboCustomerOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [
      { value: '', label: 'Not mapped' },
    ];
    for (const customer of qboCustomers) {
      const label = customer.companyName
        ? `${customer.displayName} (${customer.companyName})`
        : customer.displayName;
      options.push({ value: customer.id, label });
    }
    return options;
  }, [qboCustomers]);

  // Fetch QBO customers when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    async function loadCustomers() {
      setIsLoadingCustomers(true);
      setFetchError(null);

      const customers = await fetchQBOCustomers();

      if (cancelled) return;

      if (customers.length === 0) {
        setFetchError('No customers returned from QuickBooks. Please check your QBO connection.');
      }

      setQboCustomers(customers);
      setIsLoadingCustomers(false);
    }

    loadCustomers();

    return () => { cancelled = true; };
  }, [isOpen, fetchQBOCustomers]);

  // Initialize row states when companies or mappings change
  useEffect(() => {
    if (!isOpen) return;

    const newStates = new Map<string, MappingRowState>();
    for (const company of companies) {
      const existing = getMappingForCompany(company.companyId);
      newStates.set(company.companyId, {
        companyId: company.companyId,
        companyName: company.companyName,
        selectedQBOCustomerId: existing?.qbo_customer_id || '',
        originalQBOCustomerId: existing?.qbo_customer_id || '',
        isSaving: false,
        saveSuccess: false,
      });
    }
    setRowStates(newStates);
  }, [isOpen, companies, getMappingForCompany]);

  // Handle dropdown change for a company row
  const handleSelectionChange = useCallback((companyId: string, qboCustomerId: string) => {
    setRowStates(prev => {
      const next = new Map(prev);
      const existing = next.get(companyId);
      if (existing) {
        next.set(companyId, { ...existing, selectedQBOCustomerId: qboCustomerId, saveSuccess: false });
      }
      return next;
    });
  }, []);

  // Save a single row mapping
  const handleSaveRow = useCallback(async (companyId: string) => {
    const row = rowStates.get(companyId);
    if (!row) return;

    // Mark as saving
    setRowStates(prev => {
      const next = new Map(prev);
      next.set(companyId, { ...row, isSaving: true, saveSuccess: false });
      return next;
    });

    let success: boolean;

    if (row.selectedQBOCustomerId === '') {
      // Remove mapping
      success = await removeMapping(companyId);
    } else {
      // Find the QBO customer name for storage
      const qboCustomer = qboCustomers.find(c => c.id === row.selectedQBOCustomerId);
      const qboCustomerName = qboCustomer?.displayName || 'Unknown';
      success = await saveMapping(companyId, row.selectedQBOCustomerId, qboCustomerName);
    }

    // Update row state
    setRowStates(prev => {
      const next = new Map(prev);
      const current = next.get(companyId);
      if (current) {
        next.set(companyId, {
          ...current,
          isSaving: false,
          saveSuccess: success,
          originalQBOCustomerId: success ? current.selectedQBOCustomerId : current.originalQBOCustomerId,
        });
      }
      return next;
    });
  }, [rowStates, qboCustomers, saveMapping, removeMapping]);

  // Determine if a row has unsaved changes
  const hasChanges = useCallback((companyId: string): boolean => {
    const row = rowStates.get(companyId);
    if (!row) return false;
    return row.selectedQBOCustomerId !== row.originalQBOCustomerId;
  }, [rowStates]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Map Companies to QuickBooks Customers"
      maxWidth="3xl"
    >
      {/* Loading state */}
      {isLoadingCustomers && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading QuickBooks customers...</span>
        </div>
      )}

      {/* Error state */}
      {fetchError && !isLoadingCustomers && (
        <Alert message={fetchError} icon="error" variant="error" />
      )}

      {/* Mapping rows */}
      {!isLoadingCustomers && !fetchError && (
        <div className="space-y-3">
          <p className="text-sm text-vercel-gray-400 mb-4">
            Map each Manifest company to its corresponding QuickBooks customer. Changes are saved per row.
          </p>

          {companies.map(company => {
            const row = rowStates.get(company.companyId);
            if (!row) return null;

            return (
              <div
                key={company.companyId}
                className="flex items-center gap-3 py-2.5 px-3 rounded-md border border-vercel-gray-100 bg-white"
              >
                {/* Company name */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-vercel-gray-600 truncate block">
                    {company.companyName}
                  </span>
                </div>

                {/* QBO customer dropdown */}
                <div className="w-72 flex-shrink-0">
                  <Select
                    value={row.selectedQBOCustomerId}
                    onChange={(value) => handleSelectionChange(company.companyId, value)}
                    options={qboCustomerOptions}
                    placeholder="Select QB customer..."
                    disabled={row.isSaving}
                  />
                </div>

                {/* Save button per row */}
                <div className="flex-shrink-0 w-20">
                  {row.saveSuccess && !hasChanges(company.companyId) ? (
                    <Badge variant="success" size="sm">Saved</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!hasChanges(company.companyId) || row.isSaving}
                      onClick={() => handleSaveRow(company.companyId)}
                    >
                      {row.isSaving ? <Spinner size="sm" /> : 'Save'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {companies.length === 0 && (
            <p className="text-sm text-vercel-gray-300 text-center py-6">
              No companies found. Generate reports first to see companies here.
            </p>
          )}
        </div>
      )}
    </Modal>
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
    fetchQBOCustomers,
    saveMapping: qboSaveMapping,
    removeMapping: qboRemoveMapping,
    getMappingForCompany,
  } = useQBOCustomerMappings();

  // ---- QBO customer mapping modal state ----
  const [showMappingModal, setShowMappingModal] = useState(false);

  // ---- Build set of mapped company IDs for quick lookups ----
  const mappedCompanyIds = useMemo(() => {
    return new Set(qboMappings.map(m => m.company_id));
  }, [qboMappings]);

  // ---- Extract unique companies from report data for the mapping modal ----
  const uniqueCompanies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const yearGroup of years) {
      for (const monthGroup of yearGroup.months) {
        for (const customer of monthGroup.customers) {
          if (!seen.has(customer.companyId)) {
            seen.set(customer.companyId, customer.companyName);
          }
        }
      }
    }
    return Array.from(seen.entries())
      .map(([companyId, companyName]) => ({ companyId, companyName }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [years]);

  // ---- QBO disconnect confirmation modal state ----
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  const handleConfirmDisconnect = useCallback(async () => {
    setShowDisconnectModal(false);
    await qboDisconnect();
  }, [qboDisconnect]);

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
          <div className="flex items-center gap-3">
            {/* QBO Connection Status / Button */}
            {qboLoading ? (
              <Spinner size="sm" />
            ) : qboConnected ? (
              <div className="flex items-center gap-2">
                <Badge variant="success" size="sm">QB Connected</Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowMappingModal(true)}
                >
                  Map Customers
                </Button>
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
        </div>
      </section>

      {/* Error States */}
      {error && <Alert message={error} icon="error" variant="error" />}
      {qboError && <Alert message={qboError} icon="error" variant="error" />}
      {qboMappingError && <Alert message={qboMappingError} icon="error" variant="error" />}

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
              mappedCompanyIds={mappedCompanyIds}
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

      {/* QBO Customer Mapping Modal */}
      <QBOCustomerMappingModal
        isOpen={showMappingModal}
        onClose={() => setShowMappingModal(false)}
        companies={uniqueCompanies}
        getMappingForCompany={getMappingForCompany}
        fetchQBOCustomers={fetchQBOCustomers}
        saveMapping={qboSaveMapping}
        removeMapping={qboRemoveMapping}
      />
    </div>
  );
}
