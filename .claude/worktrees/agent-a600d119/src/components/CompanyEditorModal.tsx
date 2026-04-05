import { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import type { SelectOption } from './Select';
import { Spinner } from './Spinner';
import { CompanyGroupSection } from './CompanyGroupSection';
import { useCompanyGroup } from '../hooks/useCompanyGroup';
import { useCompanyGroupMutations } from '../hooks/useCompanyGroupMutations';
import { useQBOConnection } from '../hooks/useQBOConnection';
import { useQBOCustomerMappings } from '../hooks/useQBOCustomerMappings';
import type {
  Company,
  CompanyFormData,
  StagedCompanyGroupChanges,
  QBOCustomer,
} from '../types';

interface CompanyEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  company: Company | null;
  onSave: (id: string, data: CompanyFormData) => Promise<boolean>;
  isSaving: boolean;
  /** Callback when group changes are saved (to trigger refetch) */
  onGroupChange?: () => void;
}

function getFormDataFromCompany(company: Company | null): CompanyFormData {
  return {
    display_name: company?.display_name || company?.client_name || '',
  };
}

// Initial empty staged changes
const EMPTY_STAGED_CHANGES: StagedCompanyGroupChanges = {
  additions: [],
  removals: new Set<string>(),
};

export function CompanyEditorModal({
  isOpen,
  onClose,
  company,
  onSave,
  isSaving,
  onGroupChange,
}: CompanyEditorModalProps) {
  const [formData, setFormData] = useState<CompanyFormData>(() => getFormDataFromCompany(company));
  const [lastCompanyId, setLastCompanyId] = useState<string | null>(company?.id ?? null);
  const [stagedGroupChanges, setStagedGroupChanges] = useState<StagedCompanyGroupChanges>(EMPTY_STAGED_CHANGES);

  // QBO state
  const [qboCustomers, setQboCustomers] = useState<QBOCustomer[]>([]);
  const [isLoadingQBOCustomers, setIsLoadingQBOCustomers] = useState(false);
  const [selectedQBOCustomerId, setSelectedQBOCustomerId] = useState('');
  const [originalQBOCustomerId, setOriginalQBOCustomerId] = useState('');

  // Fetch company group data
  const {
    role: companyRole,
    members: persistedMembers,
    loading: loadingGroup,
  } = useCompanyGroup(company?.id ?? null);

  // Group mutation hook
  const { saveChanges: saveGroupChanges, isSaving: isSavingGroup, saveError: groupSaveError } = useCompanyGroupMutations();

  // QBO hooks
  const { isConnected } = useQBOConnection();
  const { fetchQBOCustomers, saveMapping, removeMapping, getMappingForCompany, error: qboMappingError } = useQBOCustomerMappings();

  // Reset form when company changes
  const currentCompanyId = company?.id ?? null;
  if (currentCompanyId !== lastCompanyId) {
    setLastCompanyId(currentCompanyId);
    setFormData(getFormDataFromCompany(company));
    setStagedGroupChanges(EMPTY_STAGED_CHANGES);
    // Reset QBO state
    setQboCustomers([]);
    setSelectedQBOCustomerId('');
    setOriginalQBOCustomerId('');
  }

  // Load QBO customers and current mapping when modal opens with a connected QBO account
  useEffect(() => {
    if (!isOpen || !isConnected || !company) return;

    let cancelled = false;

    async function loadQBOData() {
      setIsLoadingQBOCustomers(true);
      try {
        const customers = await fetchQBOCustomers();
        if (cancelled) return;
        setQboCustomers(customers);

        // Load existing mapping for this company
        const mapping = getMappingForCompany(company!.id);
        const mappedId = mapping?.qbo_customer_id ?? '';
        setSelectedQBOCustomerId(mappedId);
        setOriginalQBOCustomerId(mappedId);
      } finally {
        if (!cancelled) setIsLoadingQBOCustomers(false);
      }
    }

    loadQBOData();

    return () => { cancelled = true; };
  }, [isOpen, isConnected, company, fetchQBOCustomers, getMappingForCompany]);

  const handleStagedChangesUpdate = useCallback((changes: StagedCompanyGroupChanges) => {
    setStagedGroupChanges(changes);
  }, []);

  const handleInputChange = (field: keyof CompanyFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Check if there are group changes to save
  const hasGroupChanges = stagedGroupChanges.additions.length > 0 || stagedGroupChanges.removals.size > 0;
  const hasExistingGroup = companyRole === 'primary';

  // Build QBO customer select options
  const qboCustomerOptions: SelectOption[] = [
    { value: '', label: 'Not mapped' },
    ...qboCustomers.map((c) => ({
      value: c.id,
      label: c.displayName,
    })),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    // Save form data
    const formSuccess = await onSave(company.id, formData);

    // If form saved successfully and there are group changes, save them
    if (formSuccess && hasGroupChanges) {
      const groupResult = await saveGroupChanges({
        primaryCompanyId: company.id,
        hasExistingGroup,
        additions: stagedGroupChanges.additions,
        removals: Array.from(stagedGroupChanges.removals),
      });

      if (groupResult.success) {
        setStagedGroupChanges(EMPTY_STAGED_CHANGES);
        onGroupChange?.();
      }
    }

    // Save QBO mapping changes if the mapping changed
    let mappingSuccess = true;
    if (formSuccess && selectedQBOCustomerId !== originalQBOCustomerId) {
      if (selectedQBOCustomerId === '') {
        mappingSuccess = await removeMapping(company.id);
      } else {
        const selectedCustomer = qboCustomers.find(c => c.id === selectedQBOCustomerId);
        if (selectedCustomer) {
          mappingSuccess = await saveMapping(company.id, selectedCustomer.id, selectedCustomer.displayName);
        }
      }
    }

    if (formSuccess && mappingSuccess) {
      onClose();
    }
  };

  const isLoading = isSaving || isSavingGroup;

  if (!company) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Company"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Company Info Section */}
        <div className="space-y-4">
          {/* Read-only Original Name */}
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-1">
              Original Name (from time tracking)
            </label>
            <div className="px-3 py-2 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-400">
              {company.client_name}
            </div>
          </div>

          {/* Display Name */}
          <Input
            label="Display Name"
            value={formData.display_name}
            onChange={(e) => handleInputChange('display_name', e.target.value)}
            placeholder={company.client_name}
            disabled={isLoading}
          />

          {/* QuickBooks Customer Mapping */}
          {isConnected && (
            <div>
              <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-1">
                QuickBooks Customer
              </label>
              {isLoadingQBOCustomers ? (
                <div className="flex items-center py-2">
                  <Spinner size="sm" />
                  <span className="ml-2 text-sm text-vercel-gray-400">Loading customers...</span>
                </div>
              ) : (
                <Select
                  value={selectedQBOCustomerId}
                  onChange={setSelectedQBOCustomerId}
                  options={qboCustomerOptions}
                  placeholder="Not mapped"
                  disabled={isLoading}
                />
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-vercel-gray-100" />

        {/* Company Associations Section */}
        {loadingGroup ? (
          <div className="flex items-center justify-center py-4">
            <Spinner size="sm" />
            <span className="ml-2 text-sm text-vercel-gray-400">Loading associations...</span>
          </div>
        ) : (
          <CompanyGroupSection
            companyId={company.id}
            persistedMembers={persistedMembers}
            stagedChanges={stagedGroupChanges}
            onStagedChangesUpdate={handleStagedChangesUpdate}
            disabled={isLoading}
          />
        )}

        {/* Error display */}
        {(groupSaveError || qboMappingError) && (
          <div className="p-3 bg-error-light border border-error rounded-md">
            <p className="text-sm text-error">{groupSaveError || qboMappingError}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
