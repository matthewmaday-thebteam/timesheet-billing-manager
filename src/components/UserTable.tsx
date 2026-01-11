import { format } from 'date-fns';
import { DropdownMenu, type DropdownMenuItem } from './DropdownMenu';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import type { AppUser } from '../types';

interface UserTableProps {
  users: AppUser[];
  loading: boolean;
  adminCount: number;
  onEdit: (user: AppUser) => void;
  onDelete: (user: AppUser) => void;
  onResetPassword: (user: AppUser) => void;
}

export function UserTable({
  users,
  loading,
  adminCount,
  onEdit,
  onDelete,
  onResetPassword,
}: UserTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-vercel-gray-400">
            <Spinner size="md" />
            <span className="text-sm">Loading users...</span>
          </div>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-vercel-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="mt-4 text-sm text-vercel-gray-400">No users found</p>
          <p className="mt-1 text-xs text-vercel-gray-300">Click "Add User" to create an admin user</p>
        </div>
      </div>
    );
  }

  const getMenuItems = (user: AppUser): DropdownMenuItem[] => {
    const isLastAdmin = user.role === 'admin' && adminCount === 1;

    const items: DropdownMenuItem[] = [
      {
        label: 'Edit',
        onClick: () => onEdit(user),
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        ),
      },
      {
        label: 'Reset Password',
        onClick: () => onResetPassword(user),
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        ),
      },
    ];

    // Only show delete option if not the last admin
    if (!isLastAdmin) {
      items.push({
        label: 'Delete',
        onClick: () => onDelete(user),
        variant: 'danger' as const,
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        ),
      });
    }

    return items;
  };

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-vercel-gray-50 border-b border-vercel-gray-100">
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Role
              </th>
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Created
              </th>
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Last Sign In
              </th>
              <th className="px-4 py-3 text-right text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {users.map((user) => (
              <tr
                key={user.id}
                className="hover:bg-vercel-gray-50 transition-colors duration-200 ease-out"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-vercel-gray-50 flex items-center justify-center text-sm font-medium text-vercel-gray-400">
                      {user.display_name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-vercel-gray-600">
                        {user.display_name || user.email.split('@')[0]}
                      </div>
                      <div className="text-xs text-vercel-gray-400">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {user.role === 'admin' ? (
                    <Badge variant="info" size="sm">Admin</Badge>
                  ) : (
                    <Badge variant="default" size="sm">User</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  {user.is_verified ? (
                    <Badge variant="success" size="sm">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Verified
                    </Badge>
                  ) : (
                    <Badge variant="warning" size="sm">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Pending
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-vercel-gray-400">
                    {format(new Date(user.created_at), 'MMM d, yyyy')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-vercel-gray-400">
                    {user.last_sign_in_at
                      ? format(new Date(user.last_sign_in_at), 'MMM d, yyyy h:mm a')
                      : 'Never'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end">
                    <DropdownMenu items={getMenuItems(user)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
