/**
 * MonthPicker - Month selection component for the Rates page
 *
 * Features:
 * - Previous/Next month navigation arrows
 * - "Today" button to jump to current month
 * - Future month indicator badge
 * - Display format: "January 2026"
 *
 * @category Component
 */

import { Button } from './Button';
import type { MonthSelection } from '../types';
import {
  getCurrentMonth,
  formatMonthDisplay,
  getPreviousMonth,
  getNextMonth,
  isFutureMonth,
} from '../hooks/useMonthlyRates';

interface MonthPickerProps {
  selectedMonth: MonthSelection;
  onChange: (month: MonthSelection) => void;
  /** Whether to show the "Today" button */
  showTodayButton?: boolean;
  /** Custom class name */
  className?: string;
}

export function MonthPicker({
  selectedMonth,
  onChange,
  showTodayButton = true,
  className = '',
}: MonthPickerProps) {
  const isCurrentMonth =
    selectedMonth.year === getCurrentMonth().year &&
    selectedMonth.month === getCurrentMonth().month;
  const isFuture = isFutureMonth(selectedMonth);

  const handlePrevious = () => {
    onChange(getPreviousMonth(selectedMonth));
  };

  const handleNext = () => {
    onChange(getNextMonth(selectedMonth));
  };

  const handleToday = () => {
    onChange(getCurrentMonth());
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Navigation */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePrevious}
          aria-label="Previous month"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>

        <span className="text-sm font-medium text-vercel-gray-600 min-w-[140px] text-center">
          {formatMonthDisplay(selectedMonth)}
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleNext}
          aria-label="Next month"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>

      {/* Today button */}
      {showTodayButton && !isCurrentMonth && (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleToday}
        >
          Today
        </Button>
      )}

      {/* Future indicator */}
      {isFuture && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-vercel-gray-50 text-vercel-gray-400 border border-vercel-gray-100">
          Future
        </span>
      )}
    </div>
  );
}

export default MonthPicker;
