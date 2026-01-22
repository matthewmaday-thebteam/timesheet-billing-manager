import { useState } from 'react';
import { format, startOfMonth, endOfMonth, subMonths, addMonths, parse } from 'date-fns';
import { Button } from './Button';
import { DatePicker } from './DatePicker';
import type { DateRange, DateFilterMode } from '../types';

interface DateRangeFilterProps {
  dateRange: DateRange;
  onChange: (range: DateRange) => void;
  hideCustomRange?: boolean;
}

export function DateRangeFilter({ dateRange, onChange, hideCustomRange = false }: DateRangeFilterProps) {
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

  const handleCustomDateChange = (field: 'start' | 'end', value: string) => {
    if (!value) return;
    const date = parse(value, 'yyyy-MM-dd', new Date());
    onChange({
      ...dateRange,
      [field]: date,
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
        {!hideCustomRange && (
          <Button
            variant={mode === 'custom' ? 'primary' : 'secondary'}
            onClick={() => handleModeChange('custom')}
          >
            Custom Range
          </Button>
        )}
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

      {mode === 'custom' && (
        <div className="flex items-center gap-2">
          <div className="w-40">
            <DatePicker
              value={format(dateRange.start, 'yyyy-MM-dd')}
              onChange={(value) => handleCustomDateChange('start', value)}
              placeholder="Start date"
            />
          </div>
          <span className="text-vercel-gray-400">/</span>
          <div className="w-40">
            <DatePicker
              value={format(dateRange.end, 'yyyy-MM-dd')}
              onChange={(value) => handleCustomDateChange('end', value)}
              placeholder="End date"
            />
          </div>
        </div>
      )}

      <div className="ml-auto text-sm text-vercel-gray-400">
        {format(dateRange.start, 'MMM d')} - {format(dateRange.end, 'MMM d, yyyy')}
      </div>
    </div>
  );
}
