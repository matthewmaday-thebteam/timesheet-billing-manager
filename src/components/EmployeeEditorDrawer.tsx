import { useEffect, useCallback, useState } from 'react';
import type { Resource, ResourceFormData, EmploymentType } from '../types';

interface EmployeeEditorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  resource: Resource | null;
  onSave: (id: string, data: ResourceFormData) => Promise<boolean>;
  isSaving: boolean;
  employmentTypes: EmploymentType[];
}

interface FormErrors {
  email?: string;
  first_name?: string;
  last_name?: string;
}

export function EmployeeEditorDrawer({
  isOpen,
  onClose,
  resource,
  onSave,
  isSaving,
  employmentTypes,
}: EmployeeEditorDrawerProps) {
  const [formData, setFormData] = useState<ResourceFormData>({
    first_name: '',
    last_name: '',
    email: '',
    teams_account: '',
    employment_type_id: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Reset form when resource changes
  useEffect(() => {
    if (resource) {
      setFormData({
        first_name: resource.first_name || '',
        last_name: resource.last_name || '',
        email: resource.email || '',
        teams_account: resource.teams_account || '',
        employment_type_id: resource.employment_type_id || '',
      });
      setErrors({});
      setTouched({});
    }
  }, [resource]);

  // Handle escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  // Validate email format
  const validateEmail = (email: string): boolean => {
    if (!email) return true; // Allow empty
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (formData.email && !validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof ResourceFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear error when user starts typing
    if (errors[field as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    validateForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm() || !resource) return;

    const success = await onSave(resource.id, formData);
    if (success) {
      onClose();
    }
  };

  if (!isOpen || !resource) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ease-out"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 flex max-w-full">
        <div
          className="w-screen max-w-md transform transition-transform duration-300 ease-out"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-full flex-col bg-[#FFFFFF] border-l border-[#EAEAEA] shadow-xl">
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#EAEAEA]">
              <div>
                <h2 className="text-lg font-semibold text-[#000000]">Edit Employee</h2>
                <p className="text-[12px] text-[#666666] mt-1">Update employee information</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-md hover:bg-[#FAFAFA] transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
              >
                <svg className="w-5 h-5 text-[#666666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 scrollbar-thin">
              <div className="space-y-6">
                {/* External Label (Read-only) */}
                <div>
                  <label className="flex items-center gap-2 text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    System ID (Read-only)
                  </label>
                  <div className="px-3 py-2 bg-[#FAFAFA] border border-[#EAEAEA] rounded-md text-sm text-[#666666]">
                    {resource.external_label}
                  </div>
                </div>

                {/* First Name */}
                <div>
                  <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => handleInputChange('first_name', e.target.value)}
                    onBlur={() => handleBlur('first_name')}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                    placeholder="Enter first name"
                  />
                </div>

                {/* Last Name */}
                <div>
                  <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => handleInputChange('last_name', e.target.value)}
                    onBlur={() => handleBlur('last_name')}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                    placeholder="Enter last name"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    onBlur={() => handleBlur('email')}
                    className={`w-full px-3 py-2 bg-[#FFFFFF] border rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:outline-none transition-colors duration-200 ease-out ${
                      errors.email && touched.email
                        ? 'border-[#EE0000] focus:border-[#EE0000]'
                        : 'border-[#EAEAEA] focus:border-[#000000]'
                    }`}
                    placeholder="email@example.com"
                  />
                  {errors.email && touched.email && (
                    <p className="mt-1 text-[12px] text-[#EE0000]">{errors.email}</p>
                  )}
                </div>

                {/* Teams Account */}
                <div>
                  <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                    Teams Account
                  </label>
                  <input
                    type="text"
                    value={formData.teams_account}
                    onChange={(e) => handleInputChange('teams_account', e.target.value)}
                    onBlur={() => handleBlur('teams_account')}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                    placeholder="teams@account.com"
                  />
                </div>

                {/* Employment Type */}
                <div>
                  <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
                    Employment Type
                  </label>
                  <select
                    value={formData.employment_type_id}
                    onChange={(e) => handleInputChange('employment_type_id', e.target.value)}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
                  >
                    <option value="">Select employment type</option>
                    {employmentTypes.map((et) => (
                      <option key={et.id} value={et.id}>
                        {et.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </form>

            {/* Footer */}
            <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-[#EAEAEA] bg-[#FAFAFA]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-[#666666] bg-[#FFFFFF] border border-[#EAEAEA] rounded-md hover:bg-[#FAFAFA] transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSaving || Object.keys(errors).length > 0}
                className="px-4 py-2 text-sm font-medium text-[#FFFFFF] bg-[#000000] border border-[#000000] rounded-md hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
              >
                {isSaving ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Saving...
                  </span>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
