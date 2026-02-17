import { useState } from 'react';
import { useAdminUsers } from '../../hooks/useAdminUsers';
import { UserTable } from '../UserTable';
import { UserEditorModal } from '../UserEditorModal';
import { MetricCard } from '../MetricCard';
import { Modal } from '../Modal';
import { Button } from '../Button';
import type { AppUser, CreateUserParams, UserRole } from '../../types';

export function UsersPage() {
  const {
    users,
    loading,
    error,
    adminCount,
    createUser,
    updateUserRole,
    deleteUser,
    sendPasswordResetEmail,
    clearError,
    isOperating,
  } = useAdminUsers();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AppUser | null>(null);
  const [isResetPasswordConfirmOpen, setIsResetPasswordConfirmOpen] = useState(false);
  const [userToResetPassword, setUserToResetPassword] = useState<AppUser | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleAddClick = () => {
    clearError();
    setSelectedUser(null);
    setIsEditorOpen(true);
  };

  const handleEditClick = (user: AppUser) => {
    clearError();
    setSelectedUser(user);
    setIsEditorOpen(true);
  };

  const handleDeleteClick = (user: AppUser) => {
    setUserToDelete(user);
    setIsDeleteConfirmOpen(true);
  };

  const handleResetPasswordClick = (user: AppUser) => {
    setUserToResetPassword(user);
    setIsResetPasswordConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    try {
      await deleteUser(userToDelete.id);
      setSuccessMessage(`User "${userToDelete.email}" has been deleted`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch {
      // Error handled by hook
    }
    setIsDeleteConfirmOpen(false);
    setUserToDelete(null);
  };

  const handleConfirmResetPassword = async () => {
    if (!userToResetPassword) return;
    const success = await sendPasswordResetEmail(userToResetPassword.email);
    if (success) {
      setSuccessMessage(`Password reset email sent to ${userToResetPassword.email}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    }
    setIsResetPasswordConfirmOpen(false);
    setUserToResetPassword(null);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setSelectedUser(null);
  };

  const handleSaveUser = async (params: CreateUserParams) => {
    await createUser(params);
    setSuccessMessage(`User "${params.email}" has been created`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleUpdateRole = async (userId: string, role: UserRole) => {
    await updateUserRole(userId, role);
    setSuccessMessage('User role has been updated');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-vercel-gray-600">User Management</h1>
          <p className="text-sm text-vercel-gray-400 mt-1">
            Manage admin users with access to the application
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={handleAddClick}>
            Add User
          </Button>
        </div>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="p-3 bg-success-light border border-success rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-success">{successMessage}</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-error-light border border-error rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-error">{error}</span>
            </div>
            <button
              onClick={clearError}
              aria-label="Dismiss error"
              className="text-error hover:opacity-80 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="Total Users" value={users.length} loading={loading} />
        <MetricCard title="Admins" value={adminCount} loading={loading} />
        <MetricCard title="Verified" value={users.filter((u) => u.is_verified).length} loading={loading} />
        <MetricCard title="Pending" value={users.filter((u) => !u.is_verified).length} loading={loading} />
      </div>

      {/* Users Table */}
      <UserTable
        users={users}
        loading={loading}
        adminCount={adminCount}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
        onResetPassword={handleResetPasswordClick}
      />

      {/* Editor Modal */}
      <UserEditorModal
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
        user={selectedUser}
        onSave={handleSaveUser}
        onUpdateRole={handleUpdateRole}
        isSaving={isOperating}
        adminCount={adminCount}
        apiError={error}
        onClearApiError={clearError}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        title="Delete User"
        maxWidth="sm"
        centerTitle
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} disabled={isOperating}>
              {isOperating ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <div className="text-center py-4">
          <svg className="mx-auto h-12 w-12 text-error mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-vercel-gray-600">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{userToDelete?.email}</span>?
          </p>
          <p className="text-xs text-vercel-gray-400 mt-2">
            This will permanently remove the user and they will no longer be able to sign in.
          </p>
        </div>
      </Modal>

      {/* Reset Password Confirmation Modal */}
      <Modal
        isOpen={isResetPasswordConfirmOpen}
        onClose={() => setIsResetPasswordConfirmOpen(false)}
        title="Reset Password"
        maxWidth="sm"
        centerTitle
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsResetPasswordConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmResetPassword} disabled={isOperating}>
              {isOperating ? 'Sending...' : 'Send Reset Email'}
            </Button>
          </>
        }
      >
        <div className="text-center py-4">
          <svg className="mx-auto h-12 w-12 text-vercel-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <p className="text-sm text-vercel-gray-600">
            Send a password reset email to{' '}
            <span className="font-semibold">{userToResetPassword?.email}</span>?
          </p>
          <p className="text-xs text-vercel-gray-400 mt-2">
            The user will receive an email with a link to set a new password.
          </p>
        </div>
      </Modal>
    </div>
  );
}
