import { format } from 'date-fns';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import { Button } from './Button';
import type { ApiKey } from '../types';

interface ApiKeysTableProps {
  apiKeys: ApiKey[];
  loading: boolean;
  onRevoke: (apiKey: ApiKey) => void;
}

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return format(new Date(value), 'MMM d, yyyy');
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  return format(new Date(value), 'MMM d, yyyy h:mm a');
}

export function ApiKeysTable({ apiKeys, loading, onRevoke }: ApiKeysTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-vercel-gray-400">
            <Spinner size="md" />
            <span className="text-sm">Loading API keys...</span>
          </div>
        </div>
      </div>
    );
  }

  if (apiKeys.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <svg
            className="mx-auto h-12 w-12 text-vercel-gray-100"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <p className="mt-4 text-sm text-vercel-gray-400">No API keys yet</p>
          <p className="mt-1 text-xs text-vercel-gray-300">
            Click "Create API Key" to issue your first key
          </p>
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
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Prefix
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Last Used
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {apiKeys.map((apiKey) => {
              const isRevoked = apiKey.status === 'revoked';
              return (
                <tr
                  key={apiKey.id}
                  className="hover:bg-vercel-gray-50 transition-colors duration-200 ease-out"
                >
                  <td className="px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-vercel-gray-600">
                        {apiKey.name}
                      </div>
                      {apiKey.description && (
                        <div className="text-xs text-vercel-gray-400 mt-0.5">
                          {apiKey.description}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-vercel-gray-400">
                      {apiKey.prefix}…
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-vercel-gray-400">
                      {formatDateTime(apiKey.last_used_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-vercel-gray-400">
                      {formatDate(apiKey.created_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isRevoked ? (
                      <Badge variant="default">Revoked</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end">
                      {!isRevoked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRevoke(apiKey)}
                          className="text-error hover:text-error-hover"
                        >
                          <svg
                            className="w-4 h-4 mr-1"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                            />
                          </svg>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
