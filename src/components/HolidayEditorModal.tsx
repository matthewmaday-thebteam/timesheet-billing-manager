import { useEffect, useState } from 'react';
import { Modal } from './Modal';
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

export function HolidayEditorModal({
  isOpen,
  onClose,
  holiday,
  onSave,
  onUpdate,
  isSaving,
  defaultYear,
}: HolidayEditorModalProps) {
  const [formData, setFormData] = useState<HolidayFormData>({
    holiday_name: '',
    holiday_date: '',
  });
  const [errors, setErrors] = useState<{ holiday_name?: string; holiday_date?: string }>({});

  const isEditing = !!holiday;

  // Reset form when holiday changes
  useEffect(() => {
    if (holiday) {
      setFormData({
        holiday_name: holiday.holiday_name,
        holiday_date: holiday.holiday_date,
      });
    } else {
      // Default to January 1st of the selected year for new holidays
      setFormData({
        holiday_name: '',
        holiday_date: `${defaultYear}-01-01`,
      });
    }
    setErrors({});
  }, [holiday, defaultYear, isOpen]);

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
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 text-sm font-medium text-[#666666] bg-[#FFFFFF] border border-[#EAEAEA] rounded-md hover:bg-[#FAFAFA] transition-colors duration-200 ease-out focus:outline-none focus:ring-1 focus:ring-black"
      >
        Cancel
      </button>
      <button
        onClick={() => handleSubmit()}
        disabled={isSaving}
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
        ) : isEditing ? (
          'Update Holiday'
        ) : (
          'Add Holiday'
        )}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Holiday' : 'Add Holiday'}
      maxWidth="sm"
      centerTitle
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Holiday Name */}
        <div>
          <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
            Holiday Name
          </label>
          <input
            type="text"
            value={formData.holiday_name}
            onChange={(e) => handleInputChange('holiday_name', e.target.value)}
            className={`w-full px-3 py-2 bg-[#FFFFFF] border rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:outline-none transition-colors duration-200 ease-out ${
              errors.holiday_name
                ? 'border-[#EE0000] focus:border-[#EE0000]'
                : 'border-[#EAEAEA] focus:border-[#000000]'
            }`}
            placeholder="e.g., Liberation Day"
          />
          {errors.holiday_name && (
            <p className="mt-1 text-[12px] text-[#EE0000]">{errors.holiday_name}</p>
          )}
        </div>

        {/* Holiday Date */}
        <div>
          <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
            Date
          </label>
          <DatePicker
            value={formData.holiday_date}
            onChange={(date) => handleInputChange('holiday_date', date)}
            placeholder="Select a date"
            error={!!errors.holiday_date}
          />
          {errors.holiday_date && (
            <p className="mt-1 text-[12px] text-[#EE0000]">{errors.holiday_date}</p>
          )}
        </div>

        {/* System Generated Notice */}
        {isEditing && holiday?.is_system_generated && (
          <div className="p-3 bg-[#FAFAFA] border border-[#EAEAEA] rounded-md">
            <p className="text-[12px] text-[#666666]">
              This holiday was auto-generated. Editing will mark it as manually modified.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}
