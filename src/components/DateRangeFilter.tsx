import { useState } from 'react';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { Button } from './Button';
import type { DateRange, DateFilterMode } from '../types';

interface DateRangeFilterProps {
  dateRange: DateRange;
  onChange: (range: DateRange) => void;
  /** Optional content to display on the right side (replaces date range text) */
  rightContent?: React.ReactNode;
}

export function DateRangeFilter({ dateRange, onChange, rightContent }: DateRangeFilterProps) {
  const [mode, setMode] = useState<DateFilterMode>('current');
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const handleModeChange = (newMode: DateFilterMode) => {
    setMode(newMode);
    if (newMode === 'current') {
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
    onChange({
      start: startOfMonth(newMonth),
      end: endOfMonth(newMonth),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-6 bg-white rounded-lg border border-vercel-gray-100">
      <div className="flex gap-2">
        <Button
          variant={mode === 'current' ? 'primary' : 'secondary'}
          onClick={() => handleModeChange('current')}
        >
          Current Month
        </Button>
        <Button
          variant={mode === 'month' ? 'primary' : 'secondary'}
          onClick={() => handleModeChange('month')}
        >
          Select Month
        </Button>
      </div>

      {mode === 'month' && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => handleMonthChange('prev')}
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
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Button>
        </div>
      )}

      <div className="ml-auto">
        {rightContent || (
          <span className="text-sm text-vercel-gray-400">
            {format(dateRange.start, 'MMM d')} - {format(dateRange.end, 'MMM d, yyyy')}
          </span>
        )}
      </div>
    </div>
  );
}
