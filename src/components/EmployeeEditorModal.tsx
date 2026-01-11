import { useEffect, useState, useMemo } from 'react';
import { Modal } from './Modal';
import { Select } from './Select';
import type { Resource, ResourceFormData, EmploymentType } from '../types';

interface EmployeeEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  resource: Resource | null;
  onSave: (id: string, data: ResourceFormData) => Promise<boolean>;
  isSaving: boolean;
  employmentTypes: EmploymentType[];
}

interface FormErrors {
  email?: string;
}

export function EmployeeEditorModal({
  isOpen,
  onClose,
  resource,
  onSave,
  isSaving,
  employmentTypes,
}: EmployeeEditorModalProps) {
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

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!validateForm() || !resource) return;

    const success = await onSave(resource.id, formData);
    if (success) {
      onClose();
    }
  };

  const employmentTypeOptions = useMemo(() =>
    employmentTypes.map(et => ({ value: et.id, label: et.name })),
    [employmentTypes]
  );

  if (!resource) return null;

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
        disabled={isSaving || Object.keys(errors).length > 0}
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
        ) : (
          'Save Changes'
        )}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Employee"
      maxWidth="md"
      centerTitle
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* System ID (Read-only) */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            System ID (Read-only)
          </label>
          <div className="px-3 py-2 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-400">
            {resource.external_label}
          </div>
        </div>

        {/* First Name */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            First Name
          </label>
          <input
            type="text"
            value={formData.first_name}
            onChange={(e) => handleInputChange('first_name', e.target.value)}
            onBlur={() => handleBlur('first_name')}
            className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
            placeholder="Enter first name"
          />
        </div>

        {/* Last Name */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Last Name
          </label>
          <input
            type="text"
            value={formData.last_name}
            onChange={(e) => handleInputChange('last_name', e.target.value)}
            onBlur={() => handleBlur('last_name')}
            className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
            placeholder="Enter last name"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Email
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            onBlur={() => handleBlur('email')}
            className={`w-full px-3 py-2 bg-white border rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:outline-none transition-colors duration-200 ease-out ${
              errors.email && touched.email
                ? 'border-error focus:border-error'
                : 'border-vercel-gray-100 focus:border-vercel-gray-600'
            }`}
            placeholder="email@example.com"
          />
          {errors.email && touched.email && (
            <p className="mt-1 text-xs text-error">{errors.email}</p>
          )}
        </div>

        {/* Teams Account */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Teams Account
          </label>
          <input
            type="text"
            value={formData.teams_account}
            onChange={(e) => handleInputChange('teams_account', e.target.value)}
            onBlur={() => handleBlur('teams_account')}
            className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
            placeholder="teams@account.com"
          />
        </div>

        {/* Employment Type */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Employment Type
          </label>
          <Select
            value={formData.employment_type_id}
            onChange={(value) => handleInputChange('employment_type_id', value)}
            options={employmentTypeOptions}
            placeholder="Select employment type"
            className="w-full"
          />
        </div>
      </form>
    </Modal>
  );
}
