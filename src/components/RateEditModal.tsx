/**
 * RateEditModal - Edit project rate, rounding, billing limits, and active status
 *
 * Features:
 * - Rate input field
 * - Rounding increment select
 * - Billing limits (minimum/maximum hours, carryover)
 * - Active status toggle (controls minimum billing)
 * - Save/Cancel buttons
 *
 * @category Component
 */

import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { Toggle } from './Toggle';
import { Select } from './Select';
import type { MonthSelection, ProjectRateDisplayWithBilling, RoundingIncrement, ProjectBillingLimits } from '../types';

interface RateEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectRateDisplayWithBilling | null;
  initialMonth: MonthSelection;
  onSave: (projectId: string, month: MonthSelection, rate: number) => Promise<boolean>;
  onSaveRounding: (projectId: string, month: MonthSelection, increment: RoundingIncrement) => Promise<boolean>;
  onSaveBillingLimits: (projectId: string, month: MonthSelection, limits: Partial<ProjectBillingLimits>) => Promise<boolean>;
  onSaveActiveStatus: (projectId: string, month: MonthSelection, isActive: boolean) => Promise<boolean>;
  isSaving: boolean;
}

const ROUNDING_OPTIONS = [
  { value: '0', label: 'Actual (no rounding)' },
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
];

export function RateEditModal({
  isOpen,
  onClose,
  project,
  initialMonth,
  onSave,
  onSaveRounding,
  onSaveBillingLimits,
  onSaveActiveStatus,
  isSaving,
}: RateEditModalProps) {
  // Rate and rounding state
  const [rateValue, setRateValue] = useState<string>('');
  const [roundingValue, setRoundingValue] = useState<RoundingIncrement>(15);

  // Billing limits state
  const [minHoursValue, setMinHoursValue] = useState<string>('');
  const [maxHoursValue, setMaxHoursValue] = useState<string>('');
  const [carryoverEnabled, setCarryoverEnabled] = useState(false);

  // Active status state
  const [isActiveValue, setIsActiveValue] = useState(true);

  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Reset form when project/isOpen changes
  const resetKey = `${project?.projectId ?? 'none'}-${isOpen}`;
  useEffect(() => {
    if (resetKey !== lastResetKey) {
      setLastResetKey(resetKey);
      // Rate and rounding
      setRateValue(project?.effectiveRate?.toString() || '');
      setRoundingValue(project?.effectiveRounding ?? 15);
      // Billing limits
      setMinHoursValue(project?.minimumHours?.toString() || '');
      setMaxHoursValue(project?.maximumHours?.toString() || '');
      setCarryoverEnabled(project?.carryoverEnabled ?? false);
      // Active status
      setIsActiveValue(project?.isActive ?? true);
    }
  }, [resetKey, lastResetKey, project]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!project) return;

    const rate = parseFloat(rateValue);
    if (isNaN(rate) || rate < 0) {
      return;
    }

    // Parse billing limits
    const minHours = minHoursValue === '' ? null : parseFloat(minHoursValue);
    const maxHours = maxHoursValue === '' ? null : parseFloat(maxHoursValue);

    // Validate min <= max
    if (minHours !== null && maxHours !== null && minHours > maxHours) {
      return; // Invalid configuration
    }

    // Check what changed
    const rateChanged = rate !== project.effectiveRate;
    const roundingChanged = roundingValue !== project.effectiveRounding;
    const limitsChanged =
      minHours !== project.minimumHours ||
      maxHours !== project.maximumHours ||
      carryoverEnabled !== project.carryoverEnabled;
    const activeChanged = isActiveValue !== project.isActive;

    let success = true;

    // Save rate if changed
    if (rateChanged) {
      success = await onSave(project.projectId, initialMonth, rate);
    }

    // Save rounding if changed
    if (success && roundingChanged) {
      success = await onSaveRounding(project.projectId, initialMonth, roundingValue);
    }

    // Save billing limits if changed
    if (success && limitsChanged) {
      success = await onSaveBillingLimits(project.projectId, initialMonth, {
        minimumHours: minHours,
        maximumHours: maxHours,
        carryoverEnabled,
      });
    }

    // Save active status if changed
    if (success && activeChanged) {
      success = await onSaveActiveStatus(project.projectId, initialMonth, isActiveValue);
    }

    if (success) {
      onClose();
    }
  };

  const handleRateChange = (value: string) => {
    // Allow empty string, numbers, and decimal
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setRateValue(value);
    }
  };

  const handleHoursChange = (value: string, setter: (v: string) => void) => {
    // Allow empty string, numbers, and decimal
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setter(value);
    }
  };

  if (!project) return null;

  const footerContent = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={() => handleSubmit()}
        disabled={isSaving || rateValue === ''}
      >
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
      title="Edit Rate"
      maxWidth="xl"
      footer={footerContent}
    >
      <div className="space-y-6">
        {/* Project Name */}
        <div className="text-sm font-medium text-vercel-gray-600">
          {project.projectName}
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
        </div>

        {/* Divider */}
        <div className="border-t border-vercel-gray-100" />

        {/* Rounding Select */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Time Rounding
          </label>
          <Select
            value={String(roundingValue)}
            onChange={(value) => setRoundingValue(Number(value) as RoundingIncrement)}
            options={ROUNDING_OPTIONS}
            className="w-full"
          />
        </div>

        {/* Divider */}
        <div className="border-t border-vercel-gray-100" />

        {/* Active Status Section */}
        <div>
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
            Minimum Billing Status
          </label>
          <Toggle
            label="Apply minimum billing"
            description="When off, only bill actual hours worked (no minimum padding)"
            checked={isActiveValue}
            onChange={setIsActiveValue}
          />
        </div>

        {/* Billing Limits Section (always visible) */}
        <div className="space-y-4">
          <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
            Billing Limits
          </label>

          {/* Min/Max Hours Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
                Minimum Hours
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={minHoursValue}
                onChange={(e) => handleHoursChange(e.target.value, setMinHoursValue)}
                className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-vercel-gray-400 uppercase tracking-wider mb-2">
                Maximum Hours
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={maxHoursValue}
                onChange={(e) => handleHoursChange(e.target.value, setMaxHoursValue)}
                className="w-full px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-vercel-gray-600 placeholder-vercel-gray-300 focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none transition-colors duration-200 ease-out"
                placeholder="0"
              />
            </div>
          </div>

          {/* Validation warning - only show if both values are non-empty valid numbers */}
          {(() => {
            if (minHoursValue.trim() === '' || maxHoursValue.trim() === '') return false;
            const min = parseFloat(minHoursValue);
            const max = parseFloat(maxHoursValue);
            if (isNaN(min) || isNaN(max)) return false;
            return min > max;
          })() && (
            <p className="text-xs text-error">
              Minimum hours cannot exceed maximum hours
            </p>
          )}

          {/* Carryover Toggle */}
          <Toggle
            label="Enable carry-over"
            description="Excess hours roll to next month when maximum is set"
            checked={carryoverEnabled}
            onChange={setCarryoverEnabled}
            disabled={maxHoursValue === ''}
          />
        </div>
      </div>
    </Modal>
  );
}

export default RateEditModal;
