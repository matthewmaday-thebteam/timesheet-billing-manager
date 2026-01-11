import { useState, useMemo } from 'react';
import { Modal } from './Modal';
import { Select } from './Select';
import { Button } from './Button';
import { Input } from './Input';
import { Spinner } from './Spinner';
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

function getFormDataFromResource(resource: Resource | null): ResourceFormData {
  return {
    first_name: resource?.first_name || '',
    last_name: resource?.last_name || '',
    email: resource?.email || '',
    teams_account: resource?.teams_account || '',
    employment_type_id: resource?.employment_type_id || '',
    monthly_cost: resource?.monthly_cost ?? null,
  };
}

export function EmployeeEditorModal({
  isOpen,
  onClose,
  resource,
  onSave,
  isSaving,
  employmentTypes,
}: EmployeeEditorModalProps) {
  const [formData, setFormData] = useState<ResourceFormData>(() => getFormDataFromResource(resource));
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [lastResourceId, setLastResourceId] = useState<string | null>(resource?.id ?? null);

  // Reset form when resource changes (React-recommended pattern)
  const currentResourceId = resource?.id ?? null;
  if (currentResourceId !== lastResourceId) {
    setLastResourceId(currentResourceId);
    setFormData(getFormDataFromResource(resource));
    setErrors({});
    setTouched({});
  }

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
        disabled={isSaving || Object.keys(errors).length > 0}
      >
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" color="white" />
            Saving...
          </span>
        ) : (
          'Save Changes'
        )}
      </Button>
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
          <Input
            type="text"
            value={formData.first_name}
            onChange={(e) => handleInputChange('first_name', e.target.value)}
            onBlur={() => handleBlur('first_name')}
            placeholder="Enter first name"
          />
        </div>

        {/* Last Name */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Last Name
          </label>
          <Input
            type="text"
            value={formData.last_name}
            onChange={(e) => handleInputChange('last_name', e.target.value)}
            onBlur={() => handleBlur('last_name')}
            placeholder="Enter last name"
          />
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Email
          </label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            onBlur={() => handleBlur('email')}
            placeholder="email@example.com"
            error={errors.email && touched.email ? errors.email : undefined}
          />
        </div>

        {/* Teams Account */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Teams Account
          </label>
          <Input
            type="text"
            value={formData.teams_account}
            onChange={(e) => handleInputChange('teams_account', e.target.value)}
            onBlur={() => handleBlur('teams_account')}
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

        {/* Monthly Cost */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Monthly Cost
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-vercel-gray-400 text-sm">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.monthly_cost ?? ''}
              onChange={(e) => {
                const value = e.target.value === '' ? null : parseFloat(e.target.value);
                setFormData(prev => ({ ...prev, monthly_cost: value }));
              }}
              onBlur={() => handleBlur('monthly_cost')}
              className="w-full pl-7 pr-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
              placeholder="0.00"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
