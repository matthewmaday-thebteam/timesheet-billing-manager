/**
 * RateEditModal - Edit project rate, rounding, billing limits, and active status
 *
 * Features:
 * - Month navigation via DateCycle to view/edit different months
 * - Rate input field
 * - Rounding increment select
 * - Billing limits (minimum/maximum hours, carryover)
 * - Active status toggle (controls minimum billing)
 * - Save/Cancel buttons
 *
 * @category Component
 */

import { useState, useEffect, useMemo } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { Toggle } from './Toggle';
import { Select } from './Select';
import { Input } from './Input';
import { DateCycle } from './molecules/DateCycle';
import { useSingleProjectRate } from '../hooks/useSingleProjectRate';
import type { MonthSelection, ProjectRateDisplayWithBilling, RoundingIncrement, ProjectBillingLimits } from '../types';

interface RateEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Initial project data (for the initial month) */
  project: ProjectRateDisplayWithBilling | null;
  /** Initial month from the Rates page selection */
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

/**
 * Convert MonthSelection to Date (first of month)
 */
function monthToDate(month: MonthSelection): Date {
  return new Date(month.year, month.month - 1, 1);
}

/**
 * Convert Date to MonthSelection
 */
function dateToMonth(date: Date): MonthSelection {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
  };
}

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
  // Current month being viewed/edited (can differ from initialMonth via DateCycle)
  const [currentMonth, setCurrentMonth] = useState<MonthSelection>(initialMonth);

  // Fetch rate data for currentMonth when it differs from initialMonth
  const isInitialMonth = currentMonth.year === initialMonth.year && currentMonth.month === initialMonth.month;
  const { projectRate: fetchedProjectRate, isLoading: isLoadingRate } = useSingleProjectRate({
    projectId: project?.projectId ?? null,
    month: currentMonth,
    enabled: isOpen && !isInitialMonth,
  });

  // Use fetched data when viewing a different month, otherwise use the passed project prop
  const displayProject = useMemo(() => {
    if (isInitialMonth) {
      return project;
    }
    return fetchedProjectRate;
  }, [isInitialMonth, project, fetchedProjectRate]);

  // Rate and rounding state
  const [rateValue, setRateValue] = useState<string>('');
  const [roundingValue, setRoundingValue] = useState<RoundingIncrement>(15);

  // Billing limits state
  const [minHoursValue, setMinHoursValue] = useState<string>('');
  const [maxHoursValue, setMaxHoursValue] = useState<string>('');
  const [carryoverEnabled, setCarryoverEnabled] = useState(false);

  // Active status state
  const [isActiveValue, setIsActiveValue] = useState(true);

  // Track the last key used for form reset to avoid redundant resets
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Reset currentMonth when modal opens with a new project or the initialMonth changes
  useEffect(() => {
    if (isOpen) {
      setCurrentMonth(initialMonth);
    }
  }, [isOpen, initialMonth.year, initialMonth.month, project?.projectId]);

  // Reset form when displayProject changes (different month or different project)
  const resetKey = `${displayProject?.projectId ?? 'none'}-${currentMonth.year}-${currentMonth.month}-${isOpen}`;
  useEffect(() => {
    if (resetKey !== lastResetKey && !isLoadingRate) {
      setLastResetKey(resetKey);
      // Rate and rounding
      setRateValue(displayProject?.effectiveRate?.toString() || '');
      setRoundingValue(displayProject?.effectiveRounding ?? 15);
      // Billing limits
      setMinHoursValue(displayProject?.minimumHours?.toString() || '');
      setMaxHoursValue(displayProject?.maximumHours?.toString() || '');
      setCarryoverEnabled(displayProject?.carryoverEnabled ?? false);
      // Active status
      setIsActiveValue(displayProject?.isActive ?? true);
    }
  }, [resetKey, lastResetKey, displayProject, isLoadingRate]);

  const handleMonthChange = (newDate: Date) => {
    const newMonth = dateToMonth(newDate);
    setCurrentMonth(newMonth);
  };

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

    // Compare against displayProject (the data for currentMonth)
    const rateChanged = displayProject ? rate !== displayProject.effectiveRate : true;
    const roundingChanged = displayProject ? roundingValue !== displayProject.effectiveRounding : true;
    const limitsChanged = displayProject
      ? minHours !== displayProject.minimumHours ||
        maxHours !== displayProject.maximumHours ||
        carryoverEnabled !== displayProject.carryoverEnabled
      : true;
    const activeChanged = displayProject ? isActiveValue !== displayProject.isActive : true;

    let success = true;

    // Save rate if changed - use currentMonth, not initialMonth
    if (rateChanged) {
      success = await onSave(project.projectId, currentMonth, rate);
    }

    // Save rounding if changed
    if (success && roundingChanged) {
      success = await onSaveRounding(project.projectId, currentMonth, roundingValue);
    }

    // Save billing limits if changed
    if (success && limitsChanged) {
      success = await onSaveBillingLimits(project.projectId, currentMonth, {
        minimumHours: minHours,
        maximumHours: maxHours,
        carryoverEnabled,
      });
    }

    // Save active status if changed
    if (success && activeChanged) {
      success = await onSaveActiveStatus(project.projectId, currentMonth, isActiveValue);
    }

    if (success) {
      onClose();
    }
  };

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow empty string, numbers, and decimal
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setRateValue(value);
    }
  };

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
    const value = e.target.value;
    // Allow empty string, numbers, and decimal
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setter(value);
    }
  };

  // Validation for min/max hours
  const showMinMaxError = (() => {
    if (minHoursValue.trim() === '' || maxHoursValue.trim() === '') return false;
    const min = parseFloat(minHoursValue);
    const max = parseFloat(maxHoursValue);
    if (isNaN(min) || isNaN(max)) return false;
    return min > max;
  })();

  if (!project) return null;

  const footerContent = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={() => handleSubmit()}
        disabled={isSaving || isLoadingRate || rateValue === ''}
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

        {/* Month Navigation */}
        <div className="flex items-center justify-center py-2">
          <DateCycle
            selectedDate={monthToDate(currentMonth)}
            onDateChange={handleMonthChange}
            size="sm"
            disabled={isSaving}
          />
        </div>

        {/* Loading state when fetching different month's data */}
        {isLoadingRate ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : (
          <>
            {/* Rate Input */}
            <Input
              label="Hourly Rate (USD)"
              type="text"
              inputMode="decimal"
              value={rateValue}
              onChange={handleRateChange}
              placeholder="45.00"
              startAddon="$"
            />

            {/* Divider */}
            <div className="border-t border-vercel-gray-200" />

            {/* Rounding Select */}
            <div>
              <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
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
            <div className="border-t border-vercel-gray-200" />

            {/* Active Status Section */}
            <div>
              <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
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
              <label className="block text-sm font-medium text-vercel-gray-600">
                Billing Limits
              </label>

              {/* Min/Max Hours Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Minimum Hours"
                  type="text"
                  inputMode="decimal"
                  value={minHoursValue}
                  onChange={(e) => handleHoursChange(e, setMinHoursValue)}
                  placeholder="0"
                  error={showMinMaxError ? 'Must be less than maximum' : undefined}
                />
                <Input
                  label="Maximum Hours"
                  type="text"
                  inputMode="decimal"
                  value={maxHoursValue}
                  onChange={(e) => handleHoursChange(e, setMaxHoursValue)}
                  placeholder="0"
                />
              </div>

              {/* Carryover Toggle */}
              <Toggle
                label="Enable carry-over"
                description="Excess hours roll to next month when maximum is set"
                checked={carryoverEnabled}
                onChange={setCarryoverEnabled}
                disabled={maxHoursValue === ''}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default RateEditModal;
