/**
 * RangeSelector - Month/date range selection component
 *
 * A reusable component for selecting time ranges with four variants:
 * - 'dateRange': Current Month / Select Month buttons + date range text
 * - 'export': Current Month / Select Month buttons + Export CSV button
 * - 'exportOnly': Just the Export CSV button (no month selection)
 * - 'billings': Current Month / Select Month buttons + Export CSV + Add Billing buttons
 *
 * @category Atom
 */

import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { Button } from '../Button';
import type { DateRange } from '../../types';

export type RangeSelectorMode = 'current' | 'month';
export type RangeSelectorVariant = 'export' | 'dateRange' | 'exportOnly' | 'billings';

interface RangeSelectorProps {
  /** Variant determines the component layout and right-side content */
  variant: RangeSelectorVariant;
  /** Current date range value (not required for 'exportOnly' variant) */
  dateRange?: DateRange;
  /** Callback when date range changes (not required for 'exportOnly' variant) */
  onChange?: (range: DateRange) => void;
  /** Callback when Export CSV is clicked (required when variant='export', 'exportOnly', or 'billings') */
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
}

export function RangeSelector({
  variant,
  dateRange,
  onChange,
  onExport,
  exportDisabled = false,
  onAddBilling,
  labels = {},
}: RangeSelectorProps) {
  const [mode, setMode] = useState<RangeSelectorMode>('current');
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  // Sync selectedMonth with dateRange when it changes externally
  useEffect(() => {
    if (dateRange) {
      setSelectedMonth(dateRange.start);
    }
  }, [dateRange?.start]);

  const handleModeChange = (newMode: RangeSelectorMode) => {
    setMode(newMode);
    if (newMode === 'current' && onChange) {
      const now = new Date();
      onChange({
        start: startOfMonth(now),
        end: endOfMonth(now),
      });
    }
  };

  const handleMonthChange = (direction: 'prev' | 'next') => {
    const newMonth = direction === 'prev'
      ? subMonths(selectedMonth, 1)
      : addMonths(selectedMonth, 1);
    setSelectedMonth(newMonth);
    if (onChange) {
      onChange({
        start: startOfMonth(newMonth),
        end: endOfMonth(newMonth),
      });
    }
  };

  const currentLabel = labels.current || 'Current Month';
  const monthLabel = labels.month || 'Select Month';

  // Export-only variant: just the container with Export CSV button
  if (variant === 'exportOnly') {
    return (
      <div className="flex flex-wrap items-center gap-4 p-6 bg-white rounded-lg border border-vercel-gray-100">
        <div className="ml-auto">
          <Button
            variant="secondary"
            onClick={onExport}
            disabled={exportDisabled}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </Button>
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
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => handleMonthChange('prev')}
            aria-label="Previous month"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Button>
          <span className="text-sm font-medium text-vercel-gray-600 min-w-[120px] text-center">
            {format(selectedMonth, 'MMMM yyyy')}
          </span>
          <Button
            variant="ghost"
            onClick={() => handleMonthChange('next')}
            aria-label="Next month"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </div>
      )}

      {/* Right Content */}
      <div className="ml-auto flex items-center gap-3">
        {variant === 'export' && (
          <Button
            variant="secondary"
            onClick={onExport}
            disabled={exportDisabled}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </Button>
        )}
        {variant === 'billings' && (
          <>
            <Button
              variant="secondary"
              onClick={onExport}
              disabled={exportDisabled}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </Button>
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
