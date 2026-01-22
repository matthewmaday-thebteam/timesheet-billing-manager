import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import type { Project, ProjectFormData } from '../types';

interface ProjectEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onSave: (id: string, data: ProjectFormData) => Promise<boolean>;
  isSaving: boolean;
}

function getRateFromProject(project: Project | null): { rateValue: string; hasRate: boolean } {
  if (project && project.rate !== null) {
    return { rateValue: String(project.rate), hasRate: true };
  }
  return { rateValue: '', hasRate: false };
}

export function ProjectEditorModal({
  isOpen,
  onClose,
  project,
  onSave,
  isSaving,
}: ProjectEditorModalProps) {
  const initialRate = getRateFromProject(project);
  const [rateValue, setRateValue] = useState<string>(initialRate.rateValue);
  const [hasRate, setHasRate] = useState(initialRate.hasRate);
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Reset form when project/isOpen changes (React-recommended pattern)
  const resetKey = `${project?.id ?? 'none'}-${isOpen}`;
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    const rate = getRateFromProject(project);
    setRateValue(rate.rateValue);
    setHasRate(rate.hasRate);
  }

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
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => handleSubmit()} disabled={isSaving}>
        {isSaving ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" />
            Saving...
          </span>
        ) : (
          'Save Rate'
        )}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Project Rate"
      maxWidth="sm"
      footer={footerContent}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Project Name (Read-only) */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Project Name
          </label>
          <div className="px-3 py-2 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600">
            {project.project_name}
          </div>
        </div>

        {/* Rate Input */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Hourly Rate (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-vercel-gray-400">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={rateValue}
              onChange={(e) => handleRateChange(e.target.value)}
              className="w-full pl-7 pr-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
              placeholder="45.00"
            />
          </div>
          <p className="mt-2 text-2xs text-vercel-gray-300">
            Leave empty to use the default rate of $45.00. Enter 0 for unbillable projects.
          </p>
        </div>

        {/* Clear Rate Button */}
        {hasRate && (
          <Button variant="ghost" size="sm" onClick={handleClearRate}>
            Clear rate (use default $45.00)
          </Button>
        )}

        {/* Current Status */}
        <div className="p-3 bg-vercel-gray-50 border border-vercel-gray-100 rounded-md">
          <div className="flex items-center justify-between">
            <span className="text-xs text-vercel-gray-400">Effective Rate:</span>
            <span className="text-sm font-semibold text-vercel-gray-600">
              ${hasRate && rateValue !== '' ? parseFloat(rateValue || '0').toFixed(2) : '45.00'}
              {!hasRate && <span className="text-2xs font-normal text-vercel-gray-300 ml-1">(default)</span>}
            </span>
          </div>
        </div>
      </form>
    </Modal>
  );
}
