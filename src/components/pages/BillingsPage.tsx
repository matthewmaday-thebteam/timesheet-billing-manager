import { useState, useMemo, useEffect } from 'react';
import { startOfMonth, format, parse } from 'date-fns';
import { useBillings, formatCentsToDisplay, parseMoneyToCents } from '../../hooks/useBillings';
import { useCompanies } from '../../hooks/useCompanies';
import { useDateFilter } from '../../contexts/DateFilterContext';
import { RangeSelector } from '../atoms/RangeSelector';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { Spinner } from '../Spinner';
import { Alert } from '../Alert';
import { Input } from '../Input';
import { Select, type SelectOption } from '../Select';
import { DatePicker } from '../DatePicker';
import { DropdownMenu } from '../DropdownMenu';
import { supabase } from '../../lib/supabase';
import type {
  BillingDisplay,
  BillingTransactionDisplay,
  TransactionType,
  ProjectWithGrouping,
} from '../../types';
import { TRANSACTION_TYPE_LABELS } from '../../types';

// Transaction type options for Select
const TRANSACTION_TYPE_OPTIONS: SelectOption[] = [
  { value: 'service_fee', label: 'Service Fee' },
  { value: 'revenue_milestone', label: 'Revenue Milestone' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'license', label: 'License' },
  { value: 'reimbursement', label: 'Reimbursement' },
];

// Fetch projects for a company
async function fetchProjectsForCompany(companyId: string): Promise<ProjectWithGrouping[]> {
  const { data, error } = await supabase
    .from('v_project_table_entities')
    .select('*')
    .eq('company_uuid', companyId)
    .order('project_name', { ascending: true });

  if (error) {
    console.error('Failed to fetch projects:', error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name,
    rate: row.rate,
    target_hours: row.target_hours || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    grouping_role: row.grouping_role || 'unassociated',
    group_id: row.group_id,
    member_count: row.member_count || 0,
    company_uuid: row.company_uuid,
    company_display_name: row.company_display_name,
  }));
}

export function BillingsPage() {
  // Date range from shared context
  const { dateRange, mode, selectedMonth: filterSelectedMonth, setDateRange, setFilter } = useDateFilter();

  // Fetch billings data
  const {
    companyBillings,
    totalCents,
    isLoading,
    error,
    createBilling,
    updateBilling,
    deleteBilling,
    createTransaction,
    updateTransaction,
    deleteTransaction,
  } = useBillings({ dateRange });

  // Fetch companies for the dropdown
  const { companies } = useCompanies();

  // Company options for Select
  const companyOptions: SelectOption[] = useMemo(() =>
    companies.map((c) => ({
      value: c.id,
      label: c.display_name || c.client_name,
    })),
    [companies]
  );

  // Modal states
  const [isCreateBillingOpen, setIsCreateBillingOpen] = useState(false);
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [isEditBillingOpen, setIsEditBillingOpen] = useState(false);
  const [isEditTransactionOpen, setIsEditTransactionOpen] = useState(false);
  const [selectedBilling, setSelectedBilling] = useState<BillingDisplay | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<BillingTransactionDisplay | null>(null);

  // Create billing form state (includes type and linkedProject)
  const [newBillingCompanyId, setNewBillingCompanyId] = useState('');
  const [newBillingName, setNewBillingName] = useState('');
  const [newBillingType, setNewBillingType] = useState<TransactionType>('service_fee');
  const [newBillingLinkedProjectId, setNewBillingLinkedProjectId] = useState('');
  const [isSavingBilling, setIsSavingBilling] = useState(false);
  const [createBillingErrors, setCreateBillingErrors] = useState<{ company?: string; name?: string }>({});
  const [newBillingProjects, setNewBillingProjects] = useState<ProjectWithGrouping[]>([]);

  // Add transaction form state (simplified - no type or linkedProject)
  const [newTransactionDate, setNewTransactionDate] = useState('');
  const [newTransactionDescription, setNewTransactionDescription] = useState('');
  const [newTransactionAmount, setNewTransactionAmount] = useState('');
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);
  const [transactionErrors, setTransactionErrors] = useState<{ date?: string; amount?: string; description?: string }>({});

  // Edit billing form state (includes type and linkedProject)
  const [editBillingCompanyId, setEditBillingCompanyId] = useState('');
  const [editBillingName, setEditBillingName] = useState('');
  const [editBillingType, setEditBillingType] = useState<TransactionType>('service_fee');
  const [editBillingLinkedProjectId, setEditBillingLinkedProjectId] = useState('');
  const [isUpdatingBilling, setIsUpdatingBilling] = useState(false);
  const [editBillingErrors, setEditBillingErrors] = useState<{ company?: string; name?: string }>({});
  const [editBillingProjects, setEditBillingProjects] = useState<ProjectWithGrouping[]>([]);

  // Edit transaction form state (simplified - no type or linkedProject)
  const [editTransactionDate, setEditTransactionDate] = useState('');
  const [editTransactionDescription, setEditTransactionDescription] = useState('');
  const [editTransactionAmount, setEditTransactionAmount] = useState('');
  const [isUpdatingTransaction, setIsUpdatingTransaction] = useState(false);
  const [editTransactionErrors, setEditTransactionErrors] = useState<{ date?: string; amount?: string; description?: string }>({});

  // Project options for Create Billing
  const newBillingProjectOptions: SelectOption[] = useMemo(() => [
    { value: '', label: 'Select project...' },
    ...newBillingProjects.map((p) => ({
      value: p.id,
      label: p.project_name,
    })),
  ], [newBillingProjects]);

  // Project options for Edit Billing
  const editBillingProjectOptions: SelectOption[] = useMemo(() => [
    { value: '', label: 'Select project...' },
    ...editBillingProjects.map((p) => ({
      value: p.id,
      label: p.project_name,
    })),
  ], [editBillingProjects]);

  // Fetch projects when company changes in Create Billing modal
  useEffect(() => {
    if (isCreateBillingOpen && newBillingCompanyId) {
      fetchProjectsForCompany(newBillingCompanyId).then(setNewBillingProjects);
    } else {
      setNewBillingProjects([]);
    }
  }, [isCreateBillingOpen, newBillingCompanyId]);

  // Fetch projects when company changes in Edit Billing modal
  useEffect(() => {
    if (isEditBillingOpen && editBillingCompanyId) {
      fetchProjectsForCompany(editBillingCompanyId).then(setEditBillingProjects);
    } else {
      setEditBillingProjects([]);
    }
  }, [isEditBillingOpen, editBillingCompanyId]);

  // Open create billing modal
  const handleOpenCreateBilling = () => {
    setNewBillingCompanyId('');
    setNewBillingName('');
    setNewBillingType('service_fee');
    setNewBillingLinkedProjectId('');
    setCreateBillingErrors({});
    setNewBillingProjects([]);
    setIsCreateBillingOpen(true);
  };

  // Validate and save new billing
  const handleSaveBilling = async () => {
    const errors: { company?: string; name?: string } = {};
    if (!newBillingCompanyId) errors.company = 'Company is required';
    if (!newBillingName.trim()) errors.name = 'Billing name is required';

    if (Object.keys(errors).length > 0) {
      setCreateBillingErrors(errors);
      return;
    }

    setIsSavingBilling(true);
    const result = await createBilling(
      newBillingCompanyId,
      newBillingName.trim(),
      newBillingType,
      newBillingType === 'revenue_milestone' && newBillingLinkedProjectId
        ? newBillingLinkedProjectId
        : undefined
    );
    setIsSavingBilling(false);

    if (result) {
      setIsCreateBillingOpen(false);
    }
  };

  // Open add transaction modal
  const handleOpenAddTransaction = (billing: BillingDisplay) => {
    setSelectedBilling(billing);
    setNewTransactionDate(format(dateRange.start, 'yyyy-MM-dd'));
    setNewTransactionDescription('');
    setNewTransactionAmount('');
    setTransactionErrors({});
    setIsAddTransactionOpen(true);
  };

  // Validate and save transaction
  const handleSaveTransaction = async () => {
    if (!selectedBilling) return;

    const errors: { date?: string; amount?: string; description?: string } = {};

    if (!newTransactionDate) {
      errors.date = 'Date is required';
    }

    if (!newTransactionDescription.trim()) {
      errors.description = 'Description is required';
    }

    const cents = parseMoneyToCents(newTransactionAmount);
    if (cents === null) {
      errors.amount = 'Invalid amount. Use format: 1234.56';
    } else if (cents <= 0) {
      errors.amount = 'Amount must be greater than 0';
    }

    if (Object.keys(errors).length > 0) {
      setTransactionErrors(errors);
      return;
    }

    const parsedDate = parse(newTransactionDate, 'yyyy-MM-dd', new Date());
    const transactionDate = startOfMonth(parsedDate);

    setIsSavingTransaction(true);
    const result = await createTransaction(
      selectedBilling.id,
      transactionDate,
      cents!,
      newTransactionDescription.trim()
    );
    setIsSavingTransaction(false);

    if (result) {
      setIsAddTransactionOpen(false);
    }
  };

  // Open edit billing modal
  const handleOpenEditBilling = async (billing: BillingDisplay) => {
    setSelectedBilling(billing);
    setEditBillingCompanyId(billing.companyId);
    setEditBillingName(billing.name);
    setEditBillingType(billing.type);
    setEditBillingLinkedProjectId(billing.linkedProjectId || '');
    setEditBillingErrors({});

    // Fetch projects for the company
    const projects = await fetchProjectsForCompany(billing.companyId);
    setEditBillingProjects(projects);

    setIsEditBillingOpen(true);
  };

  // Save edited billing
  const handleUpdateBilling = async () => {
    if (!selectedBilling) return;

    const errors: { company?: string; name?: string } = {};
    if (!editBillingCompanyId) errors.company = 'Company is required';
    if (!editBillingName.trim()) errors.name = 'Billing name is required';

    if (Object.keys(errors).length > 0) {
      setEditBillingErrors(errors);
      return;
    }

    setIsUpdatingBilling(true);

    // Determine if we need to clear the linked project
    const clearLinkedProject = editBillingType !== 'revenue_milestone' ||
      (!!selectedBilling.linkedProjectId && !editBillingLinkedProjectId);

    const updates: {
      name?: string;
      companyId?: string;
      type?: TransactionType;
      linkedProjectId?: string | null;
      clearLinkedProject?: boolean;
    } = {};

    if (editBillingName.trim() !== selectedBilling.name) {
      updates.name = editBillingName.trim();
    }
    if (editBillingCompanyId !== selectedBilling.companyId) {
      updates.companyId = editBillingCompanyId;
    }
    if (editBillingType !== selectedBilling.type) {
      updates.type = editBillingType;
    }
    if (editBillingType === 'revenue_milestone' && editBillingLinkedProjectId) {
      if (editBillingLinkedProjectId !== selectedBilling.linkedProjectId) {
        updates.linkedProjectId = editBillingLinkedProjectId;
      }
    }
    if (clearLinkedProject) {
      updates.clearLinkedProject = true;
    }

    if (Object.keys(updates).length > 0) {
      await updateBilling(selectedBilling.id, updates);
    }

    setIsUpdatingBilling(false);
    setIsEditBillingOpen(false);
  };

  // Delete billing
  const handleDeleteBilling = async () => {
    if (!selectedBilling) return;

    if (!window.confirm(`Delete billing "${selectedBilling.name}" and all its transactions?`)) {
      return;
    }

    setIsUpdatingBilling(true);
    await deleteBilling(selectedBilling.id);
    setIsUpdatingBilling(false);
    setIsEditBillingOpen(false);
  };

  // Open edit transaction modal
  const handleOpenEditTransaction = (transaction: BillingTransactionDisplay, billing: BillingDisplay) => {
    setSelectedTransaction(transaction);
    setSelectedBilling(billing);
    setEditTransactionDate(format(new Date(transaction.transactionMonth), 'yyyy-MM-dd'));
    setEditTransactionDescription(transaction.description);
    setEditTransactionAmount((transaction.amountCents / 100).toFixed(2));
    setEditTransactionErrors({});
    setIsEditTransactionOpen(true);
  };

  // Save edited transaction
  const handleUpdateTransaction = async () => {
    if (!selectedTransaction) return;

    const errors: { date?: string; amount?: string; description?: string } = {};

    if (!editTransactionDate) {
      errors.date = 'Date is required';
    }

    if (!editTransactionDescription.trim()) {
      errors.description = 'Description is required';
    }

    const cents = parseMoneyToCents(editTransactionAmount);
    if (cents === null) {
      errors.amount = 'Invalid amount. Use format: 1234.56';
    } else if (cents <= 0) {
      errors.amount = 'Amount must be greater than 0';
    }

    if (Object.keys(errors).length > 0) {
      setEditTransactionErrors(errors);
      return;
    }

    const parsedDate = parse(editTransactionDate, 'yyyy-MM-dd', new Date());
    const transactionDate = startOfMonth(parsedDate);

    setIsUpdatingTransaction(true);
    const result = await updateTransaction(selectedTransaction.id, {
      transactionMonth: transactionDate,
      amountCents: cents!,
      description: editTransactionDescription.trim(),
    });
    setIsUpdatingTransaction(false);

    if (result) {
      setIsEditTransactionOpen(false);
    }
  };

  // Delete transaction
  const handleDeleteTransaction = async () => {
    if (!selectedTransaction) return;

    if (!window.confirm('Delete this transaction?')) {
      return;
    }

    setIsUpdatingTransaction(true);
    await deleteTransaction(selectedTransaction.id);
    setIsUpdatingTransaction(false);
    setIsEditTransactionOpen(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Fixed Billing</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Fixed-fee revenue containers for{' '}
            <span className="text-bteam-brand font-medium">
              {format(dateRange.start, 'MMMM yyyy')}
            </span>
          </p>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-lg font-semibold text-vercel-gray-600">
              {formatCentsToDisplay(totalCents)}
            </span>
          </div>
        )}
      </div>

      {/* Range Selector with Export and Add Billing */}
      <RangeSelector
        variant="billings"
        dateRange={dateRange}
        onChange={setDateRange}
        onExport={() => {}}
        onAddBilling={handleOpenCreateBilling}
        controlledMode={mode}
        controlledSelectedMonth={filterSelectedMonth}
        onFilterChange={setFilter}
      />

      {/* Error State */}
      {error && <Alert message={error} icon="error" variant="error" />}

      {/* Loading State */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading billings...</span>
        </div>
      ) : companyBillings.length === 0 ? (
        <div className="bg-white border border-vercel-gray-100 rounded-lg p-8 text-center">
          <p className="text-vercel-gray-400">No billings found. Click "Add Billing" to create one.</p>
        </div>
      ) : (
        /* Billings Table */
        <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-vercel-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Association
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                  Revenue
                </th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-vercel-gray-100">
              {companyBillings.map((company) => (
                <>
                  {/* Company Row */}
                  <tr key={company.companyId} className="bg-vercel-gray-50">
                    <td className="px-6 py-3">
                      <span className="text-sm font-semibold text-black">{company.companyName}</span>
                    </td>
                    <td />
                    <td />
                    <td />
                    <td className="px-6 py-3 text-right">
                      <span className="text-sm font-medium text-black">
                        {formatCentsToDisplay(company.totalCents)}
                      </span>
                    </td>
                    <td />
                  </tr>

                  {/* Billing Rows - type and association are shown here */}
                  {company.billings.map((billing) => (
                    <>
                      <tr key={billing.id} className="hover:bg-vercel-gray-50 transition-colors">
                        <td className="pl-10 pr-6 py-3">
                          <span className="text-sm text-vercel-gray-600">{billing.name}</span>
                        </td>
                        <td />
                        <td className="px-6 py-3">
                          <span className="text-sm text-vercel-gray-600">
                            {TRANSACTION_TYPE_LABELS[billing.type]}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          {billing.type === 'revenue_milestone' && billing.linkedProjectName && (
                            <span className="text-sm text-vercel-gray-600">
                              {billing.linkedProjectName}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="text-sm text-vercel-gray-600">
                            {formatCentsToDisplay(billing.totalCents)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <DropdownMenu
                            items={[
                              { label: 'Edit', onClick: () => handleOpenEditBilling(billing) },
                              { label: 'Add', onClick: () => handleOpenAddTransaction(billing) },
                            ]}
                          />
                        </td>
                      </tr>

                      {/* Transaction Rows - simplified, no type or association */}
                      {billing.transactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-vercel-gray-50 transition-colors">
                          <td className="pl-16 pr-6 py-2">
                            <span className="text-xs text-vercel-gray-300">{tx.description}</span>
                          </td>
                          <td className="px-6 py-2">
                            <span className="text-xs text-vercel-gray-300">
                              {format(new Date(tx.transactionMonth), 'MMM yyyy')}
                            </span>
                          </td>
                          <td />
                          <td />
                          <td className="px-6 py-2 text-right">
                            <span className="text-xs text-vercel-gray-400">
                              {formatCentsToDisplay(tx.amountCents)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <DropdownMenu
                              items={[
                                { label: 'Edit', onClick: () => handleOpenEditTransaction(tx, billing) },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </>
                  ))}
                </>
              ))}
            </tbody>
            <tfoot className="bg-vercel-gray-50">
              <tr>
                <td className="px-6 py-4 text-sm font-semibold text-vercel-gray-600">
                  Total
                </td>
                <td />
                <td />
                <td />
                <td className="px-6 py-4 text-right text-sm font-semibold text-vercel-gray-600">
                  {formatCentsToDisplay(totalCents)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Create Billing Modal - includes type and linkedProject */}
      <Modal
        isOpen={isCreateBillingOpen}
        onClose={() => setIsCreateBillingOpen(false)}
        title="Add Billing"
        maxWidth="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateBillingOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveBilling}
              disabled={isSavingBilling}
            >
              {isSavingBilling ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  Saving...
                </span>
              ) : (
                'Add Billing'
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); handleSaveBilling(); }} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
              Company
            </label>
            <Select
              value={newBillingCompanyId}
              onChange={(value) => {
                setNewBillingCompanyId(value);
                setNewBillingLinkedProjectId(''); // Clear project when company changes
                if (createBillingErrors.company) {
                  setCreateBillingErrors((prev) => ({ ...prev, company: undefined }));
                }
              }}
              options={companyOptions}
              placeholder="Select company..."
              className="w-full"
            />
            {createBillingErrors.company && (
              <p className="mt-1 text-xs text-bteam-brand" role="alert">
                {createBillingErrors.company}
              </p>
            )}
          </div>

          <Input
            label="Billing Name"
            value={newBillingName}
            onChange={(e) => {
              setNewBillingName(e.target.value);
              if (createBillingErrors.name) {
                setCreateBillingErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            placeholder="e.g., Q1 Milestone Payment"
            error={createBillingErrors.name}
          />

          <div>
            <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
              Type
            </label>
            <Select
              value={newBillingType}
              onChange={(value) => {
                setNewBillingType(value as TransactionType);
                if (value !== 'revenue_milestone') {
                  setNewBillingLinkedProjectId('');
                }
              }}
              options={TRANSACTION_TYPE_OPTIONS}
              className="w-full"
            />
          </div>

          {newBillingType === 'revenue_milestone' && newBillingCompanyId && (
            <div>
              <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
                Linked Project
              </label>
              <Select
                value={newBillingLinkedProjectId}
                onChange={setNewBillingLinkedProjectId}
                options={newBillingProjectOptions}
                placeholder="Select project..."
                className="w-full"
              />
            </div>
          )}
        </form>
      </Modal>

      {/* Add Transaction Modal - simplified, no type or linkedProject */}
      <Modal
        isOpen={isAddTransactionOpen}
        onClose={() => setIsAddTransactionOpen(false)}
        title="Add Transaction"
        maxWidth="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsAddTransactionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveTransaction}
              disabled={isSavingTransaction}
            >
              {isSavingTransaction ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  Saving...
                </span>
              ) : (
                'Add Transaction'
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); handleSaveTransaction(); }} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
              Date
            </label>
            <DatePicker
              value={newTransactionDate}
              onChange={setNewTransactionDate}
              placeholder="Select date"
              error={!!transactionErrors.date}
            />
            {transactionErrors.date && (
              <p className="mt-1 text-xs text-bteam-brand" role="alert">
                {transactionErrors.date}
              </p>
            )}
          </div>

          <Input
            label="Description"
            value={newTransactionDescription}
            onChange={(e) => setNewTransactionDescription(e.target.value)}
            placeholder="e.g., January payment"
            error={transactionErrors.description}
          />

          <Input
            label="Amount"
            value={newTransactionAmount}
            onChange={(e) => setNewTransactionAmount(e.target.value)}
            placeholder="1234.56"
            error={transactionErrors.amount}
          />
        </form>
      </Modal>

      {/* Edit Billing Modal - includes type and linkedProject */}
      <Modal
        isOpen={isEditBillingOpen}
        onClose={() => setIsEditBillingOpen(false)}
        title="Edit Billing"
        maxWidth="sm"
        footer={
          <>
            <Button variant="danger" onClick={handleDeleteBilling} disabled={isUpdatingBilling}>
              Delete
            </Button>
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => setIsEditBillingOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleUpdateBilling}
              disabled={isUpdatingBilling}
            >
              {isUpdatingBilling ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  Saving...
                </span>
              ) : (
                'Save'
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); handleUpdateBilling(); }} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
              Company
            </label>
            <Select
              value={editBillingCompanyId}
              onChange={(value) => {
                setEditBillingCompanyId(value);
                setEditBillingLinkedProjectId(''); // Clear project when company changes
                if (editBillingErrors.company) {
                  setEditBillingErrors((prev) => ({ ...prev, company: undefined }));
                }
              }}
              options={companyOptions}
              placeholder="Select company..."
              className="w-full"
            />
            {editBillingErrors.company && (
              <p className="mt-1 text-xs text-bteam-brand" role="alert">
                {editBillingErrors.company}
              </p>
            )}
          </div>

          <Input
            label="Billing Name"
            value={editBillingName}
            onChange={(e) => {
              setEditBillingName(e.target.value);
              if (editBillingErrors.name) {
                setEditBillingErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            error={editBillingErrors.name}
          />

          <div>
            <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
              Type
            </label>
            <Select
              value={editBillingType}
              onChange={(value) => {
                setEditBillingType(value as TransactionType);
                if (value !== 'revenue_milestone') {
                  setEditBillingLinkedProjectId('');
                }
              }}
              options={TRANSACTION_TYPE_OPTIONS}
              className="w-full"
            />
          </div>

          {editBillingType === 'revenue_milestone' && editBillingCompanyId && (
            <div>
              <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
                Linked Project
              </label>
              <Select
                value={editBillingLinkedProjectId}
                onChange={setEditBillingLinkedProjectId}
                options={editBillingProjectOptions}
                placeholder="Select project..."
                className="w-full"
              />
            </div>
          )}
        </form>
      </Modal>

      {/* Edit Transaction Modal - simplified, no type or linkedProject */}
      <Modal
        isOpen={isEditTransactionOpen}
        onClose={() => setIsEditTransactionOpen(false)}
        title="Edit Transaction"
        maxWidth="sm"
        footer={
          <>
            <Button variant="danger" onClick={handleDeleteTransaction} disabled={isUpdatingTransaction}>
              Delete
            </Button>
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => setIsEditTransactionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleUpdateTransaction}
              disabled={isUpdatingTransaction}
            >
              {isUpdatingTransaction ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  Saving...
                </span>
              ) : (
                'Save'
              )}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); handleUpdateTransaction(); }} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
              Date
            </label>
            <DatePicker
              value={editTransactionDate}
              onChange={setEditTransactionDate}
              placeholder="Select date"
              error={!!editTransactionErrors.date}
            />
            {editTransactionErrors.date && (
              <p className="mt-1 text-xs text-bteam-brand" role="alert">
                {editTransactionErrors.date}
              </p>
            )}
          </div>

          <Input
            label="Description"
            value={editTransactionDescription}
            onChange={(e) => setEditTransactionDescription(e.target.value)}
            placeholder="e.g., January payment"
            error={editTransactionErrors.description}
          />

          <Input
            label="Amount"
            value={editTransactionAmount}
            onChange={(e) => setEditTransactionAmount(e.target.value)}
            placeholder="1234.56"
            error={editTransactionErrors.amount}
          />
        </form>
      </Modal>
    </div>
  );
}
