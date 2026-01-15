import { useState, useMemo } from 'react';
import { Modal } from './Modal';
import { Select } from './Select';
import { Button } from './Button';
import { Input } from './Input';
import { Spinner } from './Spinner';
import { UserAssociationsSection } from './UserAssociationsSection';
import type { Resource, ResourceFormData, EmploymentType, BillingMode, ResourceUserAssociation } from '../types';
import { DEFAULT_EXPECTED_HOURS } from '../utils/billing';

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
  expected_hours?: string;
  monthly_cost?: string;
  hourly_rate?: string;
}

const billingModeOptions = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'hourly', label: 'Hourly' },
];

/**
 * Helper function to generate consistent number input classes
 * Matches design system Input component styling
 */
function getNumberInputClasses(disabled: boolean, hasError: boolean): string {
  const base = 'w-full px-3 py-2 border rounded-md text-sm transition-colors duration-200 ease-out focus:ring-2 focus:ring-offset-0 focus:outline-none';
  const enabled = 'bg-white text-vercel-gray-600 placeholder-vercel-gray-300 border-vercel-gray-100 focus:border-vercel-gray-600 focus:ring-vercel-gray-600';
  const disabledStyle = 'bg-vercel-gray-50 text-vercel-gray-200 cursor-not-allowed border-vercel-gray-100';
  const errorStyle = 'border-bteam-brand focus:border-bteam-brand focus:ring-bteam-brand';

  return `${base} ${disabled ? disabledStyle : enabled} ${hasError ? errorStyle : ''}`;
}

function getFormDataFromResource(resource: Resource | null): ResourceFormData {
  return {
    first_name: resource?.first_name || '',
    last_name: resource?.last_name || '',
    email: resource?.email || '',
    teams_account: resource?.teams_account || '',
    employment_type_id: resource?.employment_type_id || '',
    billing_mode: resource?.billing_mode || 'monthly',
    expected_hours: resource?.expected_hours ?? null,
    hourly_rate: resource?.hourly_rate ?? null,
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
  const [associations, setAssociations] = useState<ResourceUserAssociation[]>(resource?.associations || []);

  // Reset form when resource changes (React-recommended pattern)
  const currentResourceId = resource?.id ?? null;
  if (currentResourceId !== lastResourceId) {
    setLastResourceId(currentResourceId);
    setFormData(getFormDataFromResource(resource));
    setErrors({});
    setTouched({});
    setAssociations(resource?.associations || []);
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

    // Billing mode specific validation
    if (formData.billing_mode === 'monthly') {
      if (formData.expected_hours !== null && formData.expected_hours <= 0) {
        newErrors.expected_hours = 'Expected hours must be greater than 0';
      }
    } else {
      // Hourly mode
      if (formData.hourly_rate === null || formData.hourly_rate <= 0) {
        newErrors.hourly_rate = 'Hourly rate is required and must be greater than 0';
      }
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

  const handleBillingModeChange = (newMode: string) => {
    const mode = newMode as BillingMode;
    if (mode === 'hourly') {
      // Clear monthly-specific fields
      setFormData(prev => ({
        ...prev,
        billing_mode: 'hourly',
        monthly_cost: null,
        expected_hours: null,
      }));
    } else {
      // Clear hourly field, set default expected hours
      setFormData(prev => ({
        ...prev,
        billing_mode: 'monthly',
        hourly_rate: null,
        expected_hours: DEFAULT_EXPECTED_HOURS,
      }));
    }
    // Clear related errors
    setErrors(prev => ({
      ...prev,
      expected_hours: undefined,
      monthly_cost: undefined,
      hourly_rate: undefined,
    }));
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

  const isMonthlyBilling = formData.billing_mode === 'monthly';
  const isHourlyBilling = formData.billing_mode === 'hourly';

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

        {/* User Associations (Multi-system support) */}
        <UserAssociationsSection
          resourceId={resource.id}
          resourceUserId={resource.user_id}
          externalLabel={resource.external_label}
          associations={associations}
          onAssociationsChange={setAssociations}
          disabled={isSaving}
        />

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

        {/* Billing Mode */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Billing Mode
          </label>
          <Select
            value={formData.billing_mode}
            onChange={handleBillingModeChange}
            options={billingModeOptions}
            placeholder="Select billing mode"
            className="w-full"
          />
        </div>

        {/* Expected Hours */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Expected Hours
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.expected_hours ?? ''}
              onChange={(e) => {
                const value = e.target.value === '' ? null : parseFloat(e.target.value);
                setFormData(prev => ({ ...prev, expected_hours: value }));
                if (errors.expected_hours) {
                  setErrors(prev => ({ ...prev, expected_hours: undefined }));
                }
              }}
              onBlur={() => handleBlur('expected_hours')}
              disabled={isHourlyBilling}
              className={getNumberInputClasses(isHourlyBilling, !!(errors.expected_hours && touched.expected_hours))}
              placeholder={isHourlyBilling ? '—' : '160'}
            />
          </div>
          {errors.expected_hours && touched.expected_hours && (
            <p className="mt-1 text-xs font-mono text-bteam-brand" role="alert">
              {errors.expected_hours}
            </p>
          )}
        </div>

        {/* Monthly Cost */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Monthly Cost
          </label>
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${
              isHourlyBilling ? 'text-vercel-gray-200' : 'text-vercel-gray-400'
            }`}>$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.monthly_cost ?? ''}
              onChange={(e) => {
                const value = e.target.value === '' ? null : parseFloat(e.target.value);
                setFormData(prev => ({ ...prev, monthly_cost: value }));
                if (errors.monthly_cost) {
                  setErrors(prev => ({ ...prev, monthly_cost: undefined }));
                }
              }}
              onBlur={() => handleBlur('monthly_cost')}
              disabled={isHourlyBilling}
              className={`pl-7 pr-3 ${getNumberInputClasses(isHourlyBilling, !!(errors.monthly_cost && touched.monthly_cost))}`}
              placeholder={isHourlyBilling ? '—' : '0.00'}
            />
          </div>
          {errors.monthly_cost && touched.monthly_cost && (
            <p className="mt-1 text-xs font-mono text-bteam-brand" role="alert">
              {errors.monthly_cost}
            </p>
          )}
        </div>

        {/* Hourly Rate */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Hourly Rate
          </label>
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${
              isMonthlyBilling ? 'text-vercel-gray-200' : 'text-vercel-gray-400'
            }`}>$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.hourly_rate ?? ''}
              onChange={(e) => {
                const value = e.target.value === '' ? null : parseFloat(e.target.value);
                setFormData(prev => ({ ...prev, hourly_rate: value }));
                if (errors.hourly_rate) {
                  setErrors(prev => ({ ...prev, hourly_rate: undefined }));
                }
              }}
              onBlur={() => handleBlur('hourly_rate')}
              disabled={isMonthlyBilling}
              className={`pl-7 pr-3 ${getNumberInputClasses(isMonthlyBilling, !!(errors.hourly_rate && touched.hourly_rate))}`}
              placeholder={isMonthlyBilling ? '—' : '0.00'}
            />
          </div>
          {errors.hourly_rate && touched.hourly_rate && (
            <p className="mt-1 text-xs font-mono text-bteam-brand" role="alert">
              {errors.hourly_rate}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
