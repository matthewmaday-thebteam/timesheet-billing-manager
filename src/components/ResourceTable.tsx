import type { Resource } from '../types';

interface ResourceTableProps {
  resources: Resource[];
  loading: boolean;
  onRowClick: (resource: Resource) => void;
}

export function ResourceTable({ resources, loading, onRowClick }: ResourceTableProps) {
  const isIncomplete = (resource: Resource): boolean => {
    return !resource.email || !resource.first_name;
  };

  const getDisplayName = (resource: Resource): string => {
    if (resource.first_name && resource.last_name) {
      return `${resource.first_name} ${resource.last_name}`;
    }
    if (resource.first_name) return resource.first_name;
    if (resource.last_name) return resource.last_name;
    return '—';
  };

  if (loading) {
    return (
      <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-[#666666]">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm">Loading resources...</span>
          </div>
        </div>
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-[#EAEAEA]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="mt-4 text-sm text-[#666666]">No resources found</p>
          <p className="mt-1 text-[12px] text-[#888888]">Resources will appear here once synced from Clockify</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[#FAFAFA] border-b border-[#EAEAEA]">
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                System ID
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Email
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Teams Account
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAEAEA]">
            {resources.map((resource) => (
              <tr
                key={resource.id}
                onClick={() => onRowClick(resource)}
                className="hover:bg-[#FAFAFA] cursor-pointer transition-colors duration-200 ease-out"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-[#888888]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span className="text-sm text-[#666666] font-mono">{resource.external_label}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-[#000000]">{getDisplayName(resource)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-[#666666]">{resource.email || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-[#666666]">{resource.teams_account || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                    resource.employment_type?.name === 'Full-time'
                      ? 'bg-[#F5F5F5] text-[#000000]'
                      : 'bg-[#FAFAFA] text-[#666666]'
                  }`}>
                    {resource.employment_type?.name || 'Unknown'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {isIncomplete(resource) ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#FFF7ED] text-[#C2410C]">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Incomplete
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#F0FDF4] text-[#166534]">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Complete
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
