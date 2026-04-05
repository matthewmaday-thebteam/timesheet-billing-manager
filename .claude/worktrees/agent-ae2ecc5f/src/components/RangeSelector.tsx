/**
 * RangeSelector - Month/date range selection component
 *
 * A reusable component for selecting time ranges with four variants:
 * - 'dateRange': Current Month / Select Month buttons + date range text
 * - 'export': Current Month / Select Month buttons + Export dropdown
 * - 'exportOnly': Just the Export dropdown (no month selection)
 * - 'billings': Current Month / Select Month buttons + Export dropdown + Add Billing buttons
 *
 * @category Atom
 */

import { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { Button } from './Button';
import { DropdownMenu } from './DropdownMenu';
import { ChevronIcon } from './ChevronIcon';
import { DateCycle } from './molecules/DateCycle';
import type { DropdownMenuItem } from './DropdownMenu';
import type { DateRange } from '../types';

export type RangeSelectorMode = 'current' | 'month';
export type RangeSelectorVariant = 'export' | 'dateRange' | 'exportOnly' | 'billings';

/** Export option for the dropdown */
export interface ExportOption {
  label: string;
  onClick: () => void;
}

interface RangeSelectorProps {
  /** Variant determines the component layout and right-side content */
  variant: RangeSelectorVariant;
  /** Current date range value (not required for 'exportOnly' variant) */
  dateRange?: DateRange;
  /** Callback when date range changes (not required for 'exportOnly' variant) */
  onChange?: (range: DateRange) => void;
  /** Export options for dropdown (preferred over onExport) */
  exportOptions?: ExportOption[];
  /** @deprecated Use exportOptions instead. Callback when Export CSV is clicked */
  onExport?: () => void;
  /** Disable the export button (only applies when variant='export', 'exportOnly', or 'billings') */
  exportDisabled?: boolean;
  /** Callback when Add Billing is clicked (only applies when variant='billings') */
  onAddBilling?: () => void;
  /** Custom labels for the mode buttons */
  labels?: {
    current?: string;
    month?: string;
  };
  /** Controlled mode — when provided, overrides internal state */
  controlledMode?: RangeSelectorMode;
  /** Controlled selectedMonth — when provided, overrides internal state */
  controlledSelectedMonth?: Date;
  /** Callback when mode/selectedMonth change (for controlled usage) */
  onFilterChange?: (mode: RangeSelectorMode, selectedMonth: Date, dateRange: DateRange) => void;
}

/** Download icon for export menu items and trigger */
const DownloadIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

/** Export CSV button trigger for dropdown (Select-style with icon) */
const ExportTrigger = (
  <span className="inline-flex items-center gap-2">
    <span className="text-vercel-gray-400">
      {DownloadIcon}
    </span>
    <span>Export CSV</span>
    <ChevronIcon direction="down" size="sm" />
  </span>
);

export function RangeSelector({
  variant,
  dateRange,
  onChange,
  exportOptions,
  onExport,
  exportDisabled = false,
  onAddBilling,
  labels = {},
  controlledMode,
  controlledSelectedMonth,
  onFilterChange,
}: RangeSelectorProps) {
  const [internalMode, setInternalMode] = useState<RangeSelectorMode>('current');
  const [internalSelectedMonth, setInternalSelectedMonth] = useState(new Date());

  const isControlled = controlledMode !== undefined;
  const mode = isControlled ? controlledMode : internalMode;
  const selectedMonth = isControlled ? controlledSelectedMonth! : internalSelectedMonth;

  // Sync internal selectedMonth with dateRange when it changes externally (uncontrolled only)
  useEffect(() => {
    if (!isControlled && dateRange) {
      setInternalSelectedMonth(dateRange.start);
    }
  }, [isControlled, dateRange?.start]);

  const handleModeChange = (newMode: RangeSelectorMode) => {
    if (!isControlled) {
      setInternalMode(newMode);
    }
    if (newMode === 'current') {
      const now = new Date();
      const newRange = { start: startOfMonth(now), end: endOfMonth(now) };
      onChange?.(newRange);
      onFilterChange?.(newMode, now, newRange);
    } else {
      // Switching to 'month' mode — keep current dateRange, just notify mode change
      if (dateRange) {
        onFilterChange?.(newMode, selectedMonth, dateRange);
      }
    }
  };

  const handleMonthChange = (direction: 'prev' | 'next') => {
    const newMonth = direction === 'prev'
      ? subMonths(selectedMonth, 1)
      : addMonths(selectedMonth, 1);
    if (!isControlled) {
      setInternalSelectedMonth(newMonth);
    }
    const newRange = { start: startOfMonth(newMonth), end: endOfMonth(newMonth) };
    onChange?.(newRange);
    onFilterChange?.('month', newMonth, newRange);
  };

  // Convert exportOptions to DropdownMenuItem format
  const dropdownItems: DropdownMenuItem[] = useMemo(() => {
    if (exportOptions) {
      return exportOptions.map(opt => ({
        label: opt.label,
        onClick: opt.onClick,
        icon: DownloadIcon,
      }));
    }
    // Legacy support: single onExport callback
    if (onExport) {
      return [{ label: 'Export CSV', onClick: onExport, icon: DownloadIcon }];
    }
    return [];
  }, [exportOptions, onExport]);

  const currentLabel = labels.current || 'Current Month';
  const monthLabel = labels.month || 'Select Month';

  // Export-only variant: just the container with Export dropdown
  if (variant === 'exportOnly') {
    return (
      <div className="flex flex-wrap items-center gap-4 p-6 bg-white rounded-lg border border-vercel-gray-100">
        <div className="ml-auto">
          <DropdownMenu
            items={dropdownItems}
            trigger={ExportTrigger}
            triggerVariant="select"
            menuWidth={220}
            disabled={exportDisabled}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 p-6 bg-white rounded-lg border border-vercel-gray-100">
      {/* Mode Buttons */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'current' ? 'primary' : 'secondary'}
          onClick={() => handleModeChange('current')}
        >
          {currentLabel}
        </Button>
        <Button
          variant={mode === 'month' ? 'primary' : 'secondary'}
          onClick={() => handleModeChange('month')}
        >
          {monthLabel}
        </Button>
      </div>

      {/* Month Navigation */}
      {mode === 'month' && (
        <DateCycle
          selectedDate={selectedMonth}
          onDateChange={(newDate) => {
            const direction = newDate > selectedMonth ? 'next' : 'prev';
            handleMonthChange(direction);
          }}
        />
      )}

      {/* Right Content */}
      <div className="ml-auto flex items-center gap-3">
        {variant === 'export' && (
          <DropdownMenu
            items={dropdownItems}
            trigger={ExportTrigger}
            triggerVariant="select"
            menuWidth={220}
            disabled={exportDisabled}
          />
        )}
        {variant === 'billings' && (
          <>
            <DropdownMenu
              items={dropdownItems}
              trigger={ExportTrigger}
              triggerVariant="select"
              menuWidth={220}
              disabled={exportDisabled}
            />
            <Button
              variant="primary"
              onClick={onAddBilling}
            >
              Add Billing
            </Button>
          </>
        )}
        {variant === 'dateRange' && dateRange && (
          <span className="text-sm text-vercel-gray-400">
            {format(dateRange.start, 'MMM d')} - {format(dateRange.end, 'MMM d, yyyy')}
          </span>
        )}
      </div>
    </div>
  );
}

export default RangeSelector;
