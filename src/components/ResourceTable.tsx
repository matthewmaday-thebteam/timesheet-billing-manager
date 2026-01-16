import { Spinner } from './Spinner';
import { Badge } from './Badge';
import type { Resource, ResourceWithGrouping } from '../types';
import { DEFAULT_EXPECTED_HOURS, formatCurrency, getEffectiveHourlyRate, formatHours } from '../utils/billing';

// Helper to format ID for display
const formatSystemId = (id: string) => {
  const truncatedId = id.length > 8
    ? `${id.substring(0, 8)}...`
    : id;
  return { truncatedId, fullId: id };
};

// Type guard to check if resource has grouping info
function hasGroupingInfo(resource: Resource | ResourceWithGrouping): resource is ResourceWithGrouping {
  return 'all_system_ids' in resource && Array.isArray((resource as ResourceWithGrouping).all_system_ids);
}

interface ResourceTableProps {
  resources: (Resource | ResourceWithGrouping)[];
  loading: boolean;
  onRowClick: (resource: Resource | ResourceWithGrouping) => void;
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
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-vercel-gray-400">
            <Spinner size="md" />
            <span className="text-sm">Loading resources...</span>
          </div>
        </div>
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-vercel-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="mt-4 text-sm text-vercel-gray-400">No resources found</p>
          <p className="mt-1 text-xs text-vercel-gray-300">Resources will appear here once synced from Clockify</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-vercel-gray-50 border-b border-vercel-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                System ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Expected Hours
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Monthly Cost
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Hourly Rate
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {resources.map((resource) => (
              <tr
                key={resource.id}
                onClick={() => onRowClick(resource)}
                className="hover:bg-vercel-gray-50 cursor-pointer transition-colors duration-200 ease-out"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <svg className="w-3.5 h-3.5 text-vercel-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {/* Use all_system_ids if available (includes grouped member IDs) */}
                    {hasGroupingInfo(resource) && resource.all_system_ids.length > 0 ? (
                      <>
                        <span className="text-sm text-vercel-gray-400 font-mono">
                          {resource.all_system_ids.map((id, idx) => {
                            const { truncatedId, fullId } = formatSystemId(id);
                            return (
                              <span key={id} title={fullId}>
                                {truncatedId}{idx < resource.all_system_ids.length - 1 ? ', ' : ''}
                              </span>
                            );
                          })}
                        </span>
                        {/* Show badge if this is a grouped entity */}
                        {resource.grouping_role === 'primary' && resource.member_count > 0 && (
                          <Badge variant="info" size="sm">
                            {resource.member_count + 1} IDs
                          </Badge>
                        )}
                      </>
                    ) : resource.associations && resource.associations.length > 0 ? (
                      // Fallback to associations if no grouping info
                      <span className="text-sm text-vercel-gray-400 font-mono">
                        {resource.associations.map((assoc, idx) => {
                          const { truncatedId, fullId } = formatSystemId(assoc.user_id);
                          return (
                            <span key={assoc.id} title={fullId}>
                              {truncatedId}{idx < resource.associations!.length - 1 ? ', ' : ''}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      // Fallback to external_label if no associations
                      <span className="text-sm text-vercel-gray-400 font-mono">{resource.external_label}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-vercel-gray-600">{getDisplayName(resource)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-mono text-vercel-gray-400">{resource.email || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="default">
                    {resource.employment_type?.name || 'Unknown'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-mono text-vercel-gray-400">
                    {resource.billing_mode === 'hourly'
                      ? '—'
                      : formatHours(resource.expected_hours ?? DEFAULT_EXPECTED_HOURS)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-mono text-vercel-gray-400">
                    {resource.billing_mode === 'hourly'
                      ? '—'
                      : formatCurrency(resource.monthly_cost)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {resource.billing_mode === 'hourly' ? (
                    <span className="text-sm font-mono text-vercel-gray-600">
                      {formatCurrency(resource.hourly_rate)}
                    </span>
                  ) : (
                    <span className="text-sm font-mono text-vercel-gray-300">
                      {formatCurrency(getEffectiveHourlyRate(
                        resource.billing_mode,
                        resource.hourly_rate,
                        resource.monthly_cost,
                        resource.expected_hours
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {isIncomplete(resource) ? (
                    <Badge variant="warning">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Incomplete
                    </Badge>
                  ) : (
                    <Badge variant="success">Complete</Badge>
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
