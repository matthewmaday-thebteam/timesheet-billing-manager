import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import type { Project, ProjectFormData } from '../types';

interface ProjectEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onSave: (id: string, data: ProjectFormData) => Promise<boolean>;
  isSaving: boolean;
}

export function ProjectEditorModal({
  isOpen,
  onClose,
  project,
  onSave,
  isSaving,
}: ProjectEditorModalProps) {
  const [rateValue, setRateValue] = useState<string>('');
  const [hasRate, setHasRate] = useState(false);

  // Reset form when project changes
  useEffect(() => {
    if (project) {
      if (project.rate !== null) {
        setRateValue(String(project.rate));
        setHasRate(true);
      } else {
        setRateValue('');
        setHasRate(false);
      }
    }
  }, [project, isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!project) return;

    // Parse the rate value - empty string means null (use fallback)
    const rate = hasRate && rateValue !== '' ? parseFloat(rateValue) : null;

    const success = await onSave(project.id, { rate });
    if (success) {
      onClose();
    }
  };

  const handleRateChange = (value: string) => {
    // Allow empty string, numbers, and decimal
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setRateValue(value);
      setHasRate(value !== '');
    }
  };

  const handleClearRate = () => {
    setRateValue('');
    setHasRate(false);
  };

  if (!project) return null;

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
        ) : (
          'Save Rate'
        )}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Project Rate"
      maxWidth="sm"
      centerTitle
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Project Name (Read-only) */}
        <div>
          <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
            Project Name
          </label>
          <div className="px-3 py-2 bg-[#FAFAFA] border border-[#EAEAEA] rounded-md text-sm text-[#000000]">
            {project.project_name}
          </div>
        </div>

        {/* Project ID (Read-only) */}
        <div>
          <label className="flex items-center gap-2 text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            </svg>
            Project ID
          </label>
          <div className="px-3 py-2 bg-[#FAFAFA] border border-[#EAEAEA] rounded-md text-sm text-[#666666] font-mono">
            {project.project_id}
          </div>
        </div>

        {/* Rate Input */}
        <div>
          <label className="block text-[12px] font-medium text-[#666666] uppercase tracking-wider mb-2">
            Hourly Rate (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666666]">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={rateValue}
              onChange={(e) => handleRateChange(e.target.value)}
              className="w-full pl-7 pr-3 py-2 bg-[#FFFFFF] border border-[#EAEAEA] rounded-md text-sm text-[#000000] placeholder-[#888888] focus:ring-1 focus:ring-black focus:border-[#000000] focus:outline-none transition-colors duration-200 ease-out"
              placeholder="45.00"
            />
          </div>
          <p className="mt-2 text-[11px] text-[#888888]">
            Leave empty to use the default rate of $45.00. Enter 0 for unbillable projects.
          </p>
        </div>

        {/* Clear Rate Button */}
        {hasRate && (
          <button
            type="button"
            onClick={handleClearRate}
            className="text-sm text-[#666666] hover:text-[#000000] transition-colors"
          >
            Clear rate (use default $45.00)
          </button>
        )}

        {/* Current Status */}
        <div className="p-3 bg-[#FAFAFA] border border-[#EAEAEA] rounded-md">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[#666666]">Effective Rate:</span>
            <span className="text-sm font-semibold text-[#000000]">
              ${hasRate && rateValue !== '' ? parseFloat(rateValue || '0').toFixed(2) : '45.00'}
              {!hasRate && <span className="text-[11px] font-normal text-[#888888] ml-1">(default)</span>}
            </span>
          </div>
        </div>
      </form>
    </Modal>
  );
}
