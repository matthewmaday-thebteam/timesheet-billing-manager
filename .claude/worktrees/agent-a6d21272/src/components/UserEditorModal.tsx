import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { Toggle } from './Toggle';
import { Alert } from './Alert';
import { Spinner } from './Spinner';
import type { AppUser, CreateUserParams, UserRole } from '../types';

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
];

interface UserEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AppUser | null;
  onSave: (params: CreateUserParams) => Promise<void>;
  onUpdateRole: (userId: string, role: UserRole) => Promise<void>;
  isSaving: boolean;
  adminCount: number;
  apiError?: string | null;
  onClearApiError?: () => void;
}

interface FormData {
  email: string;
  password: string;
  display_name: string;
  role: UserRole;
  send_invite: boolean;
}

function getFormDataFromUser(user: AppUser | null): FormData {
  if (user) {
    return {
      email: user.email,
      password: '',
      display_name: user.display_name || '',
      role: user.role,
      send_invite: false,
    };
  }
  return {
    email: '',
    password: '',
    display_name: '',
    role: 'admin',
    send_invite: true,
  };
}

export function UserEditorModal({
  isOpen,
  onClose,
  user,
  onSave,
  onUpdateRole,
  isSaving,
  adminCount,
  apiError,
  onClearApiError,
}: UserEditorModalProps) {
  const [formData, setFormData] = useState<FormData>(() => getFormDataFromUser(user));
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [lastResetKey, setLastResetKey] = useState<string>('');

  const isEditing = !!user;
  const isLastAdmin = user?.role === 'admin' && adminCount === 1;

  // Reset form when user/isOpen changes (React-recommended pattern)
  const resetKey = `${user?.id ?? 'new'}-${isOpen}`;
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setFormData(getFormDataFromUser(user));
    setErrors({});
    onClearApiError?.();
  }

  const validateForm = (): boolean => {
    const newErrors: { email?: string; password?: string } = {};

    if (!isEditing) {
      if (!formData.email.trim()) {
        newErrors.email = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        newErrors.email = 'Please enter a valid email address';
      }

      // Password required only if not sending invite
      if (!formData.send_invite && !formData.password) {
        newErrors.password = 'Password is required when not sending invite';
      } else if (formData.password && formData.password.length < 8) {
        newErrors.password = 'Password must be at least 8 characters';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!validateForm()) return;

    try {
      if (isEditing && user) {
        // Only update role if it changed
        if (formData.role !== user.role) {
          await onUpdateRole(user.id, formData.role);
        }
      } else {
        await onSave({
          email: formData.email,
          password: formData.password || null,
          display_name: formData.display_name || null,
          role: formData.role,
          send_invite: formData.send_invite,
        });
      }
      onClose();
    } catch {
      // Error is handled by the hook
    }
  };

  const handleInputChange = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === 'email' || field === 'password') {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    onClearApiError?.();
  };

  const footerContent = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="primary"
        onClick={() => handleSubmit()}
        disabled={isSaving}
      >
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" color="white" />
            Saving...
          </span>
        ) : isEditing ? (
          'Update User'
        ) : (
          'Create User'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit User' : 'Create User'}
      maxWidth="sm"
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Email */}
        <Input
          label="Email Address"
          type="email"
          value={formData.email}
          onChange={(e) => handleInputChange('email', e.target.value)}
          disabled={isEditing}
          placeholder="user@example.com"
          error={errors.email}
        />

        {/* Display Name */}
        <Input
          label="Display Name (optional)"
          type="text"
          value={formData.display_name}
          onChange={(e) => handleInputChange('display_name', e.target.value)}
          disabled={isEditing}
          placeholder="John Doe"
        />

        {/* Role */}
        <div>
          <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
            Role
          </label>
          <Select
            value={formData.role}
            onChange={(value) => handleInputChange('role', value as UserRole)}
            options={roleOptions}
            disabled={isLastAdmin}
            className="w-full"
          />
          {isLastAdmin && (
            <p className="mt-1 text-xs text-vercel-gray-400">
              Cannot change role of the last admin user
            </p>
          )}
        </div>

        {/* Password (only for new users) */}
        {!isEditing && (
          <>
            <Input
              label={formData.send_invite ? 'Password (optional)' : 'Password'}
              type="password"
              value={formData.password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              placeholder="Minimum 8 characters"
              error={errors.password}
            />

            {/* Send Invite Toggle */}
            <Toggle
              label="Send Invite Email"
              description={
                formData.send_invite
                  ? 'User will receive an email to set their password'
                  : 'User will use the password you set above'
              }
              checked={formData.send_invite}
              onChange={(checked) => handleInputChange('send_invite', checked)}
            />
          </>
        )}

        {/* Edit Mode Notice */}
        {isEditing && (
          <Alert
            message='To change the password, use the "Reset Password" option from the user action menu.'
            icon="info"
          />
        )}

        {/* API Error */}
        {apiError && (
          <div className="p-3 bg-error-light border border-error rounded-md">
            <p className="text-sm text-error">{apiError}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
