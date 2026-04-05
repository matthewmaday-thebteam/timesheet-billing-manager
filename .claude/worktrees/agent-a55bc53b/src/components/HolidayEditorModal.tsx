import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { Input } from './Input';
import { DatePicker } from './DatePicker';
import type { BulgarianHoliday, HolidayFormData } from '../types';

interface HolidayEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  holiday: BulgarianHoliday | null;
  onSave: (data: HolidayFormData) => Promise<boolean>;
  onUpdate: (id: string, data: HolidayFormData) => Promise<boolean>;
  isSaving: boolean;
  defaultYear: number;
}

function getFormDataFromHoliday(holiday: BulgarianHoliday | null, defaultYear: number): HolidayFormData {
  if (holiday) {
    return {
      holiday_name: holiday.holiday_name,
      holiday_date: holiday.holiday_date,
    };
  }
  return {
    holiday_name: '',
    holiday_date: `${defaultYear}-01-01`,
  };
}

export function HolidayEditorModal({
  isOpen,
  onClose,
  holiday,
  onSave,
  onUpdate,
  isSaving,
  defaultYear,
}: HolidayEditorModalProps) {
  const [formData, setFormData] = useState<HolidayFormData>(() => getFormDataFromHoliday(holiday, defaultYear));
  const [errors, setErrors] = useState<{ holiday_name?: string; holiday_date?: string }>({});
  const [lastResetKey, setLastResetKey] = useState<string>('');

  const isEditing = !!holiday;

  // Reset form when holiday/defaultYear/isOpen changes (React-recommended pattern)
  const resetKey = `${holiday?.id ?? 'new'}-${defaultYear}-${isOpen}`;
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setFormData(getFormDataFromHoliday(holiday, defaultYear));
    setErrors({});
  }

  const validateForm = (): boolean => {
    const newErrors: { holiday_name?: string; holiday_date?: string } = {};

    if (!formData.holiday_name.trim()) {
      newErrors.holiday_name = 'Holiday name is required';
    }

    if (!formData.holiday_date) {
      newErrors.holiday_date = 'Date is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!validateForm()) return;

    let success: boolean;
    if (isEditing && holiday) {
      success = await onUpdate(holiday.id, formData);
    } else {
      success = await onSave(formData);
    }

    if (success) {
      onClose();
    }
  };

  const handleInputChange = (field: keyof HolidayFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const footerContent = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => handleSubmit()} disabled={isSaving}>
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" />
            Saving...
          </span>
        ) : isEditing ? (
          'Update Holiday'
        ) : (
          'Add Holiday'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Holiday' : 'Add Holiday'}
      maxWidth="sm"
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Holiday Name */}
        <Input
          label="Holiday Name"
          value={formData.holiday_name}
          onChange={(e) => handleInputChange('holiday_name', e.target.value)}
          placeholder="e.g., Liberation Day"
          error={errors.holiday_name}
        />

        {/* Holiday Date */}
        <div>
          <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
            Date
          </label>
          <DatePicker
            value={formData.holiday_date}
            onChange={(date) => handleInputChange('holiday_date', date)}
            placeholder="Select a date"
            error={!!errors.holiday_date}
          />
          {errors.holiday_date && (
            <p className="mt-1 text-xs text-error" role="alert">{errors.holiday_date}</p>
          )}
        </div>

        {/* System Generated Notice */}
        {isEditing && holiday?.is_system_generated && (
          <div className="p-3 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md">
            <p className="text-xs text-vercel-gray-400">
              This holiday was auto-generated. Editing will mark it as manually modified.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}
