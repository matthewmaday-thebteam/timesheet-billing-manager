import { useState, useCallback } from 'react';
import { format } from 'date-fns';
import { Spinner } from '../Spinner';
import { DropdownMenu } from '../DropdownMenu';
import { RangeSelector } from '../molecules/RangeSelector';
import { CompanyEditorModal } from '../CompanyEditorModal';
import { useCompanies } from '../../hooks/useCompanies';
import type { CompanyWithGrouping, CompanyFormData } from '../../types';

export function CompaniesPage() {
  const {
    companies,
    loading: isLoading,
    error,
    refetch,
    updateCompany,
    isUpdating,
  } = useCompanies();

  const [selectedCompany, setSelectedCompany] = useState<CompanyWithGrouping | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // Export to CSV - just company names (primary only for grouped companies)
  const handleExportCSV = useCallback(() => {
    const csvRows: string[] = [];

    // Header row
    csvRows.push('Client Roster');

    // Data rows - use display_name if set, otherwise client_name
    for (const company of companies) {
      const name = company.display_name || company.client_name;
      csvRows.push(`"${name.replace(/"/g, '""')}"`);
    }

    // Convert to CSV string
    const csvContent = csvRows.join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `companies-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [companies]);

  const handleEditClick = (company: CompanyWithGrouping) => {
    setSelectedCompany(company);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedCompany(null);
  };

  const handleSaveCompany = async (id: string, data: CompanyFormData): Promise<boolean> => {
    const success = await updateCompany(id, data);
    return success;
  };

  const handleGroupChange = () => {
    refetch();
  };

  // Get display name for a company
  const getDisplayName = (company: CompanyWithGrouping): string => {
    return company.display_name || company.client_name;
  };

  // Get total ID count for a company (itself + members)
  const getIdCount = (company: CompanyWithGrouping): number => {
    // Primary companies count themselves + their members
    if (company.grouping_role === 'primary') {
      return 1 + company.member_count;
    }
    // Unassociated companies count as 1
    return 1;
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">Company Management</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage company information and associations
          </p>
        </div>
      </div>

      {/* Export Button */}
      <RangeSelector
        variant="exportOnly"
        onExport={handleExportCSV}
        exportDisabled={isLoading || companies.length === 0}
      />

      {/* Error State */}
      {error && (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-error">{error}</span>
          </div>
        </div>
      )}

      {/* Companies Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading companies...</span>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-vercel-gray-50">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-left w-28">
                  System ID
                </th>
                <th className="px-4 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-left">
                  Company
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vercel-gray-100">
              {companies.map((company) => {
                const idCount = getIdCount(company);
                const menuItems = [
                  {
                    label: 'Edit',
                    onClick: () => handleEditClick(company),
                    icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    ),
                  },
                ];

                return (
                  <tr
                    key={company.id}
                    className="hover:bg-vercel-gray-50 transition-colors"
                  >
                    {/* System ID column */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-vercel-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span className="text-sm text-vercel-gray-400 font-mono">
                          {idCount} {idCount === 1 ? 'ID' : 'IDs'}
                        </span>
                      </div>
                    </td>
                    {/* Company column with 3-dot menu */}
                    <td className="px-4 py-3 text-sm text-vercel-gray-600">
                      <div className="flex items-center justify-between">
                        <span>{getDisplayName(company)}</span>
                        <div className="flex-shrink-0">
                          <DropdownMenu items={menuItems} />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor Modal */}
      <CompanyEditorModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        company={selectedCompany}
        onSave={handleSaveCompany}
        isSaving={isUpdating}
        onGroupChange={handleGroupChange}
      />
    </div>
  );
}
