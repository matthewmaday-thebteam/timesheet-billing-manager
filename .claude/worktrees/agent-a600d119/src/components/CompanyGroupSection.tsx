import { useState, useEffect, useMemo } from 'react';
import { Button } from './Button';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import { useUnassociatedCompanies } from '../hooks/useCompanyGroup';
import type {
  CompanyGroupMemberDisplay,
  StagedCompanyGroupChanges,
  StagedCompanyMemberAdd,
} from '../types';

interface CompanyGroupSectionProps {
  /** The company ID being edited (the potential/actual primary) */
  companyId: string;
  /** Currently persisted member companies (from server) */
  persistedMembers: CompanyGroupMemberDisplay[];
  /** Staged changes (local state managed by parent) */
  stagedChanges: StagedCompanyGroupChanges;
  /** Callback when staged changes update */
  onStagedChangesUpdate: (changes: StagedCompanyGroupChanges) => void;
  /** Whether the section is disabled (during save) */
  disabled?: boolean;
}

type MemberStatus = 'persisted' | 'pending_addition' | 'pending_removal';

interface DisplayMember {
  company_id: string;
  display_name: string;
  client_id: string;
  client_name: string;
  status: MemberStatus;
}

/**
 * CompanyGroupSection - Manages company entity grouping
 *
 * This component allows admins to associate multiple company entities
 * (from different time tracking systems) that represent the same real-world company.
 */
export function CompanyGroupSection({
  companyId,
  persistedMembers,
  stagedChanges,
  onStagedChangesUpdate,
  disabled = false,
}: CompanyGroupSectionProps) {
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  const {
    companies: unassociatedCompanies,
    loading: loadingCompanies,
    fetch: fetchUnassociatedCompanies,
  } = useUnassociatedCompanies();

  // Fetch unassociated companies when adding mode is opened
  useEffect(() => {
    if (isAddingNew) {
      fetchUnassociatedCompanies(companyId);
    }
  }, [isAddingNew, fetchUnassociatedCompanies, companyId]);

  // Compute display list with statuses
  const displayMembers = useMemo((): DisplayMember[] => {
    const members: DisplayMember[] = [];

    // Add persisted members
    for (const m of persistedMembers) {
      const isPendingRemoval = stagedChanges.removals.has(m.member_company_id);
      members.push({
        company_id: m.member_company_id,
        display_name: m.display_name || m.client_name,
        client_id: m.client_id,
        client_name: m.client_name,
        status: isPendingRemoval ? 'pending_removal' : 'persisted',
      });
    }

    // Add staged additions
    for (const add of stagedChanges.additions) {
      members.push({
        company_id: add.company_id,
        display_name: add.display_name,
        client_id: add.client_id,
        client_name: add.client_name,
        status: 'pending_addition',
      });
    }

    return members;
  }, [persistedMembers, stagedChanges]);

  // Filter dropdown options
  const dropdownOptions = useMemo(() => {
    const excludeIds = new Set<string>();
    excludeIds.add(companyId); // Exclude primary

    // Exclude persisted members (that aren't pending removal)
    for (const m of persistedMembers) {
      if (!stagedChanges.removals.has(m.member_company_id)) {
        excludeIds.add(m.member_company_id);
      }
    }

    // Exclude staged additions
    for (const add of stagedChanges.additions) {
      excludeIds.add(add.company_id);
    }

    return unassociatedCompanies
      .filter(c => !excludeIds.has(c.company_id))
      .map(c => ({
        value: c.company_id,
        label: c.display_name || c.client_name,
      }));
  }, [unassociatedCompanies, companyId, persistedMembers, stagedChanges]);

  // Handle adding a member (staging, not persisting)
  const handleAddMember = () => {
    if (!selectedCompanyId) return;

    const company = unassociatedCompanies.find(c => c.company_id === selectedCompanyId);
    if (!company) return;

    const newAddition: StagedCompanyMemberAdd = {
      company_id: company.company_id,
      display_name: company.display_name || company.client_name,
      client_id: company.client_id,
      client_name: company.client_name,
    };

    onStagedChangesUpdate({
      ...stagedChanges,
      additions: [...stagedChanges.additions, newAddition],
    });

    setSelectedCompanyId('');
    setIsAddingNew(false);
  };

  // Handle removing a member (staging, not persisting)
  const handleRemoveMember = (memberId: string) => {
    const isStaged = stagedChanges.additions.some(a => a.company_id === memberId);

    if (isStaged) {
      onStagedChangesUpdate({
        ...stagedChanges,
        additions: stagedChanges.additions.filter(a => a.company_id !== memberId),
      });
    } else {
      const newRemovals = new Set(stagedChanges.removals);
      newRemovals.add(memberId);
      onStagedChangesUpdate({
        ...stagedChanges,
        removals: newRemovals,
      });
    }
  };

  // Handle undoing a staged removal
  const handleUndoRemoval = (memberId: string) => {
    const newRemovals = new Set(stagedChanges.removals);
    newRemovals.delete(memberId);
    onStagedChangesUpdate({
      ...stagedChanges,
      removals: newRemovals,
    });
  };

  const hasPendingChanges = stagedChanges.additions.length > 0 || stagedChanges.removals.size > 0;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        Company Associations
        {hasPendingChanges && (
          <Badge variant="warning" size="sm">Pending</Badge>
        )}
      </label>

      {/* Current members list */}
      <div className="space-y-2">
        {displayMembers.length === 0 ? (
          <div className="text-sm text-vercel-gray-300 italic py-2">
            No associated companies
          </div>
        ) : (
          displayMembers.map((member) => (
            <div
              key={member.company_id}
              className={`flex items-center justify-between px-3 py-2 border rounded-md transition-colors ${
                member.status === 'pending_removal'
                  ? 'bg-error-light border-error-border opacity-60'
                  : member.status === 'pending_addition'
                  ? 'bg-success-light border-success-border'
                  : 'bg-vercel-gray-50 border-vercel-gray-100'
              }`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={`text-sm truncate ${
                  member.status === 'pending_removal'
                    ? 'text-vercel-gray-300 line-through'
                    : 'text-vercel-gray-600'
                }`}>
                  {member.display_name}
                </span>
                {member.status === 'pending_addition' && (
                  <Badge variant="success" size="sm">New</Badge>
                )}
                {member.status === 'pending_removal' && (
                  <Badge variant="error" size="sm">Removing</Badge>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {member.status === 'pending_removal' ? (
                  <button
                    type="button"
                    onClick={() => handleUndoRemoval(member.company_id)}
                    disabled={disabled}
                    className="text-xs text-info hover:text-info-text transition-colors disabled:opacity-50"
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member.company_id)}
                    disabled={disabled}
                    className="text-vercel-gray-300 hover:text-bteam-brand transition-colors disabled:opacity-50"
                    title="Remove from group"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add new member UI */}
      {isAddingNew ? (
        <div className="space-y-3 p-3 border border-vercel-gray-100 rounded-md bg-white">
          <div>
            <label className="block text-xs font-medium text-vercel-gray-400 mb-1">
              Select Company
            </label>
            {loadingCompanies ? (
              <div className="flex items-center justify-center py-2">
                <Spinner size="sm" />
              </div>
            ) : (
              <Select
                value={selectedCompanyId}
                onChange={(value) => setSelectedCompanyId(value)}
                options={dropdownOptions}
                placeholder={dropdownOptions.length === 0 ? 'No companies available' : 'Select company...'}
                className="w-full"
                disabled={dropdownOptions.length === 0}
              />
            )}
            {dropdownOptions.length === 0 && !loadingCompanies && (
              <p className="mt-1 text-xs text-vercel-gray-300">
                All companies are already associated with groups.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setIsAddingNew(false);
                setSelectedCompanyId('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAddMember}
              disabled={!selectedCompanyId}
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIsAddingNew(true)}
          disabled={disabled}
          className="w-full"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Company Association
        </Button>
      )}

      {/* Info about staging behavior */}
      {hasPendingChanges && (
        <p className="text-xs text-vercel-gray-300 italic">
          Changes will be saved when you click "Save Changes"
        </p>
      )}
    </div>
  );
}
