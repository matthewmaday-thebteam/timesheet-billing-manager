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

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Spinner } from './Spinner';
import { Toggle } from './Toggle';
import { Select } from './Select';
import { Input } from './Input';
import { Alert } from './Alert';
import { Checkbox } from './Checkbox';
import { DateCycle } from './molecules/DateCycle';
import { useSingleProjectRate } from '../hooks/useSingleProjectRate';
import type { MonthSelection, ProjectRateDisplayWithBilling, RoundingIncrement, RoundingMode, ProjectBillingLimits } from '../types';

interface RateEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Initial project data (for the initial month) */
  project: ProjectRateDisplayWithBilling | null;
  /** Initial month from the Rates page selection */
  initialMonth: MonthSelection;
  onSave: (projectId: string, month: MonthSelection, rate: number) => Promise<boolean>;
  onSaveRounding: (projectId: string, month: MonthSelection, increment: RoundingIncrement, roundingMode?: RoundingMode) => Promise<boolean>;
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

const ROUNDING_MODE_OPTIONS = [
  { value: 'task', label: 'Per task (legacy)' },
  { value: 'entry', label: 'Per entry' },
];

interface PendingChange {
  field: string;
  oldValue: string;
  newValue: string;
}

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
  const [roundingModeValue, setRoundingModeValue] = useState<RoundingMode>('task');

  // Billing limits state
  const [minHoursValue, setMinHoursValue] = useState<string>('');
  const [maxHoursValue, setMaxHoursValue] = useState<string>('');
  const [carryoverEnabled, setCarryoverEnabled] = useState(false);

  // Active status state
  const [isActiveValue, setIsActiveValue] = useState(true);

  // Confirmation dialog state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [zeroRateAcknowledged, setZeroRateAcknowledged] = useState(false);

  // Track the last key used for form reset to avoid redundant resets
  const [lastResetKey, setLastResetKey] = useState<string>('');

  // Reset currentMonth and confirmation state when modal opens with a new project or the initialMonth changes
  useEffect(() => {
    if (isOpen) {
      setCurrentMonth(initialMonth);
      setShowConfirmation(false);
      setZeroRateAcknowledged(false);
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
      setRoundingModeValue(displayProject?.effectiveRoundingMode ?? 'task');
      // Billing limits
      setMinHoursValue(displayProject?.minimumHours != null ? displayProject.minimumHours.toString() : '');
      setMaxHoursValue(displayProject?.maximumHours != null ? displayProject.maximumHours.toString() : '');
      setCarryoverEnabled(displayProject?.carryoverEnabled ?? false);
      // Active status
      setIsActiveValue(displayProject?.isActive ?? true);
    }
  }, [resetKey, lastResetKey, displayProject, isLoadingRate]);

  const handleMonthChange = (newDate: Date) => {
    const newMonth = dateToMonth(newDate);
    setCurrentMonth(newMonth);
    setShowConfirmation(false);
    setZeroRateAcknowledged(false);
  };

  // Compute pending changes for confirmation display
  const pendingChanges = useMemo((): PendingChange[] => {
    if (!displayProject) return [];

    const changes: PendingChange[] = [];
    const rate = parseFloat(rateValue);

    if (!isNaN(rate) && rate !== displayProject.effectiveRate) {
      changes.push({
        field: 'Hourly Rate',
        oldValue: `$${displayProject.effectiveRate.toFixed(2)}`,
        newValue: `$${rate.toFixed(2)}`,
      });
    }

    if (roundingValue !== displayProject.effectiveRounding) {
      const formatRounding = (v: number) => v === 0 ? 'Actual' : `${v} minutes`;
      changes.push({
        field: 'Rounding Increment',
        oldValue: formatRounding(displayProject.effectiveRounding),
        newValue: formatRounding(roundingValue),
      });
    }

    if (roundingModeValue !== displayProject.effectiveRoundingMode) {
      const formatMode = (v: string) => v === 'task' ? 'Per task' : 'Per entry';
      changes.push({
        field: 'Rounding Mode',
        oldValue: formatMode(displayProject.effectiveRoundingMode),
        newValue: formatMode(roundingModeValue),
      });
    }

    const minHours = minHoursValue === '' ? null : parseFloat(minHoursValue);
    const maxHours = maxHoursValue === '' ? null : parseFloat(maxHoursValue);

    if (minHours !== displayProject.minimumHours) {
      changes.push({
        field: 'Minimum Hours',
        oldValue: displayProject.minimumHours !== null ? String(displayProject.minimumHours) : 'None',
        newValue: minHours !== null ? String(minHours) : 'None',
      });
    }

    if (maxHours !== displayProject.maximumHours) {
      changes.push({
        field: 'Maximum Hours',
        oldValue: displayProject.maximumHours !== null ? String(displayProject.maximumHours) : 'None',
        newValue: maxHours !== null ? String(maxHours) : 'None',
      });
    }

    if (carryoverEnabled !== displayProject.carryoverEnabled) {
      changes.push({
        field: 'Carry-over',
        oldValue: displayProject.carryoverEnabled ? 'Enabled' : 'Disabled',
        newValue: carryoverEnabled ? 'Enabled' : 'Disabled',
      });
    }

    if (isActiveValue !== displayProject.isActive) {
      changes.push({
        field: 'Minimum Billing',
        oldValue: displayProject.isActive ? 'Active' : 'Inactive',
        newValue: isActiveValue ? 'Active' : 'Inactive',
      });
    }

    return changes;
  }, [displayProject, rateValue, roundingValue, roundingModeValue, minHoursValue, maxHoursValue, carryoverEnabled, isActiveValue]);

  const isZeroRate = parseFloat(rateValue) === 0;
  const hasChanges = pendingChanges.length > 0;

  // Step 1: User clicks Save -> show confirmation dialog (with $0 warning if applicable)
  const handleRequestSave = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!project) return;

    const rate = parseFloat(rateValue);
    if (isNaN(rate) || rate < 0) return;

    // Parse billing limits for validation
    const minHours = minHoursValue === '' ? null : parseFloat(minHoursValue);
    const maxHours = maxHoursValue === '' ? null : parseFloat(maxHoursValue);

    // Validate min <= max
    if (minHours !== null && maxHours !== null && minHours > maxHours) return;

    // If nothing changed, just close
    if (!hasChanges) {
      onClose();
      return;
    }

    // Reset zero-rate acknowledgment when entering confirmation
    setZeroRateAcknowledged(false);
    setShowConfirmation(true);
  }, [project, rateValue, minHoursValue, maxHoursValue, hasChanges, onClose]);

  // Step 2: User confirms in the confirmation dialog -> execute save
  const handleConfirmedSave = useCallback(async () => {
    if (!project || !displayProject) return;

    // If rate is $0 and user hasn't acknowledged, block save
    if (isZeroRate && !zeroRateAcknowledged) return;

    const rate = parseFloat(rateValue);
    const minHours = minHoursValue === '' ? null : parseFloat(minHoursValue);
    const maxHours = maxHoursValue === '' ? null : parseFloat(maxHoursValue);

    const rateChanged = rate !== displayProject.effectiveRate;
    const roundingChanged = roundingValue !== displayProject.effectiveRounding || roundingModeValue !== displayProject.effectiveRoundingMode;
    const limitsChanged = minHours !== displayProject.minimumHours ||
      maxHours !== displayProject.maximumHours ||
      carryoverEnabled !== displayProject.carryoverEnabled;
    const activeChanged = isActiveValue !== displayProject.isActive;

    let success = true;

    if (rateChanged) {
      success = await onSave(project.projectId, currentMonth, rate);
    }

    if (success && roundingChanged) {
      success = await onSaveRounding(project.projectId, currentMonth, roundingValue, roundingModeValue);
    }

    if (success && limitsChanged) {
      success = await onSaveBillingLimits(project.projectId, currentMonth, {
        minimumHours: minHours,
        maximumHours: maxHours,
        carryoverEnabled,
      });
    }

    if (success && activeChanged) {
      success = await onSaveActiveStatus(project.projectId, currentMonth, isActiveValue);
    }

    if (success) {
      setShowConfirmation(false);
      onClose();
    }
  }, [project, displayProject, rateValue, roundingValue, roundingModeValue, minHoursValue, maxHoursValue, carryoverEnabled, isActiveValue, isZeroRate, zeroRateAcknowledged, currentMonth, onSave, onSaveRounding, onSaveBillingLimits, onSaveActiveStatus, onClose]);

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

  // Confirmation dialog content
  if (showConfirmation) {
    const confirmFooter = (
      <>
        <Button variant="secondary" onClick={() => setShowConfirmation(false)}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirmedSave}
          disabled={isSaving || (isZeroRate && !zeroRateAcknowledged)}
        >
          {isSaving ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              Saving...
            </span>
          ) : (
            'Confirm'
          )}
        </Button>
      </>
    );

    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Confirm Changes"
        maxWidth="xl"
        footer={confirmFooter}
      >
        <div className="space-y-6">
          {/* Project context */}
          <div className="text-sm text-vercel-gray-400">
            {project.projectName} — {new Date(currentMonth.year, currentMonth.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
          </div>

          {/* Zero rate warning */}
          {isZeroRate && (
            <div className="space-y-3">
              <Alert
                message="You are setting the hourly rate to $0.00. This project will generate no revenue for this month and all future months until a new rate is set."
                icon="warning"
                variant="warning"
              />
              <Checkbox
                checked={zeroRateAcknowledged}
                onChange={setZeroRateAcknowledged}
                label="I confirm this rate should be $0.00"
              />
            </div>
          )}

          {/* Changes table */}
          <div className="border border-vercel-gray-100 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-vercel-gray-50">
                  <th className="text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider px-4 py-2">Field</th>
                  <th className="text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider px-4 py-2">Old Value</th>
                  <th className="text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider px-4 py-2">New Value</th>
                </tr>
              </thead>
              <tbody>
                {pendingChanges.map((change, idx) => (
                  <tr key={change.field} className={idx !== pendingChanges.length - 1 ? 'border-b border-vercel-gray-100' : ''}>
                    <td className="px-4 py-2 text-sm font-medium text-vercel-gray-600">{change.field}</td>
                    <td className="px-4 py-2 text-sm text-vercel-gray-400">{change.oldValue}</td>
                    <td className="px-4 py-2 text-sm text-vercel-gray-600 font-medium">{change.newValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    );
  }

  const footerContent = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={() => handleRequestSave()}
        disabled={isSaving || isLoadingRate || rateValue === '' || showMinMaxError}
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
        {/* Month Navigation */}
        <DateCycle
          selectedDate={monthToDate(currentMonth)}
          onDateChange={handleMonthChange}
          size="md"
          variant="boxed"
          fullWidth
          disabled={isSaving}
        />

        {/* Company Name */}
        <div>
          <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
            Company
          </label>
          <div className="text-sm text-vercel-gray-400">
            {project.canonicalClientName || project.clientName || 'Unassigned'}
          </div>
        </div>

        {/* Project Name */}
        <div>
          <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
            Project
          </label>
          <div className="text-sm text-vercel-gray-400">
            {project.projectName}
          </div>
        </div>

        {/* Form content with loading overlay */}
        <div className="relative">
          {/* Loading overlay */}
          {isLoadingRate && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 rounded-lg">
              <Spinner size="md" />
            </div>
          )}

          <div className={`space-y-6 ${isLoadingRate ? 'pointer-events-none' : ''}`}>
            {/* Rate Input */}
            <Input
              label="Hourly Rate (USD)"
              type="text"
              inputMode="decimal"
              value={rateValue}
              onChange={handleRateChange}
              placeholder="45.00"
              startAddon="$"
              disabled={isLoadingRate}
            />

            {/* Divider */}
            <div className="border-t border-vercel-gray-100" />

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
                disabled={isLoadingRate}
              />
            </div>

            {/* Rounding Mode Select */}
            <div>
              <label className="block text-sm font-medium text-vercel-gray-600 mb-1">
                Rounding Mode
              </label>
              <Select
                value={roundingModeValue}
                onChange={(value) => setRoundingModeValue(value as RoundingMode)}
                options={ROUNDING_MODE_OPTIONS}
                className="w-full"
                disabled={isLoadingRate}
              />
              <p className="text-xs text-vercel-gray-400 mt-1">
                Per task rounds the monthly total per task. Per entry rounds each time entry individually.
              </p>
            </div>

            {/* Divider */}
            <div className="border-t border-vercel-gray-100" />

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
                disabled={isLoadingRate}
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
                  disabled={isLoadingRate}
                />
                <Input
                  label="Maximum Hours"
                  type="text"
                  inputMode="decimal"
                  value={maxHoursValue}
                  onChange={(e) => handleHoursChange(e, setMaxHoursValue)}
                  placeholder="0"
                  disabled={isLoadingRate}
                />
              </div>

              {/* Carryover Toggle */}
              <Toggle
                label="Enable carry-over"
                description="Excess hours roll to next month when maximum is set"
                checked={carryoverEnabled}
                onChange={setCarryoverEnabled}
                disabled={isLoadingRate || maxHoursValue === ''}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default RateEditModal;
