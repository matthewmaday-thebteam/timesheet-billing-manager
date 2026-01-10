import { useState } from 'react';
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import type { DateRange, DateFilterMode } from '../types';

interface DateRangeFilterProps {
  dateRange: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeFilter({ dateRange, onChange }: DateRangeFilterProps) {
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
    const date = new Date(value);
    onChange({
      ...dateRange,
      [field]: date,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex gap-2">
        <button
          onClick={() => handleModeChange('current')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            mode === 'current'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Current Month
        </button>
        <button
          onClick={() => handleModeChange('month')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            mode === 'month'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Select Month
        </button>
        <button
          onClick={() => handleModeChange('custom')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            mode === 'custom'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Custom Range
        </button>
      </div>

      {mode === 'month' && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleMonthChange('prev')}
            className="p-1.5 rounded hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium min-w-[120px] text-center">
            {format(selectedMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => handleMonthChange('next')}
            className="p-1.5 rounded hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {mode === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={format(dateRange.start, 'yyyy-MM-dd')}
            onChange={(e) => handleCustomDateChange('start', e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-md"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={format(dateRange.end, 'yyyy-MM-dd')}
            onChange={(e) => handleCustomDateChange('end', e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-md"
          />
        </div>
      )}

      <div className="ml-auto text-sm text-gray-500">
        {format(dateRange.start, 'MMM d')} - {format(dateRange.end, 'MMM d, yyyy')}
      </div>
    </div>
  );
}
