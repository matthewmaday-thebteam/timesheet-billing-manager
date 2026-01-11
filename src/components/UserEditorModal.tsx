import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import type { AppUser, CreateUserParams, UserRole } from '../types';

interface UserEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AppUser | null;
  onSave: (params: CreateUserParams) => Promise<void>;
  onUpdateRole: (userId: string, role: UserRole) => Promise<void>;
  isSaving: boolean;
  adminCount: number;
}

interface FormData {
  email: string;
  password: string;
  display_name: string;
  role: UserRole;
  send_invite: boolean;
}

export function UserEditorModal({
  isOpen,
  onClose,
  user,
  onSave,
  onUpdateRole,
  isSaving,
  adminCount,
}: UserEditorModalProps) {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    display_name: '',
    role: 'admin',
    send_invite: true,
  });
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [showPassword, setShowPassword] = useState(false);

  const isEditing = !!user;
  const isLastAdmin = user?.role === 'admin' && adminCount === 1;

  // Reset form when user changes
  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email,
        password: '',
        display_name: user.display_name || '',
        role: user.role,
        send_invite: false,
      });
    } else {
      setFormData({
        email: '',
        password: '',
        display_name: '',
        role: 'admin',
        send_invite: true,
      });
    }
    setErrors({});
    setShowPassword(false);
  }, [user, isOpen]);

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
  };

  const footerContent = (
    <>
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-sm font-medium text-vercel-gray-400 bg-white border border-vercel-gray-100 rounded-md hover:bg-vercel-gray-50 transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
      >
        Cancel
      </button>
      <button
        onClick={() => handleSubmit()}
        disabled={isSaving}
        className="px-4 py-2 text-sm font-medium text-white bg-vercel-gray-600 border border-vercel-gray-600 rounded-md hover:bg-vercel-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
      >
        {isSaving ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Saving...
          </span>
        ) : isEditing ? (
          'Update User'
        ) : (
          'Create User'
        )}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit User' : 'Create User'}
      maxWidth="sm"
      centerTitle
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Email Address
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            disabled={isEditing}
            className={`w-full px-3 py-2 bg-white border rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:outline-none transition-colors duration-200 ease-out disabled:bg-vercel-gray-50 disabled:text-vercel-gray-300 ${
              errors.email
                ? 'border-error focus:border-error'
                : 'border-vercel-gray-100 focus:border-vercel-gray-600'
            }`}
            placeholder="user@example.com"
          />
          {errors.email && <p className="mt-1 text-xs text-error">{errors.email}</p>}
        </div>

        {/* Display Name */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Display Name
            <span className="ml-1 text-vercel-gray-300 normal-case tracking-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={formData.display_name}
            onChange={(e) => handleInputChange('display_name', e.target.value)}
            disabled={isEditing}
            className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out disabled:bg-vercel-gray-50 disabled:text-vercel-gray-300"
            placeholder="John Doe"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Role
          </label>
          <select
            value={formData.role}
            onChange={(e) => handleInputChange('role', e.target.value as UserRole)}
            disabled={isLastAdmin}
            className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out disabled:bg-vercel-gray-50 disabled:text-vercel-gray-300"
          >
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
          {isLastAdmin && (
            <p className="mt-1 text-xs text-vercel-gray-300">
              Cannot change role of the last admin user
            </p>
          )}
        </div>

        {/* Password (only for new users) */}
        {!isEditing && (
          <>
            <div>
              <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
                Password
                {formData.send_invite && (
                  <span className="ml-1 text-vercel-gray-300 normal-case tracking-normal">(optional)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  className={`w-full px-3 py-2 pr-10 bg-white border rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:outline-none transition-colors duration-200 ease-out ${
                    errors.password
                      ? 'border-error focus:border-error'
                      : 'border-vercel-gray-100 focus:border-vercel-gray-600'
                  }`}
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-vercel-gray-400 hover:text-vercel-gray-600 transition-colors"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-error">{errors.password}</p>}
            </div>

            {/* Send Invite Toggle */}
            <div className="flex items-center justify-between p-3 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md">
              <div>
                <p className="text-sm font-medium text-vercel-gray-600">Send Invite Email</p>
                <p className="text-xs text-vercel-gray-400">
                  {formData.send_invite
                    ? 'User will receive an email to set their password'
                    : 'User will use the password you set above'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleInputChange('send_invite', !formData.send_invite)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black ${
                  formData.send_invite ? 'bg-vercel-gray-600' : 'bg-vercel-gray-100'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-out ${
                    formData.send_invite ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </>
        )}

        {/* Edit Mode Notice */}
        {isEditing && (
          <div className="p-3 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md">
            <p className="text-xs text-vercel-gray-400">
              To change the password, use the "Reset Password" option from the user's action menu.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}
