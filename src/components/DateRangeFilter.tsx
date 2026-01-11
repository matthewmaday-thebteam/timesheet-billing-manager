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
    <div className="flex flex-wrap items-center gap-4 p-6 bg-white rounded-lg border border-vercel-gray-100">
      <div className="flex gap-2">
        <button
          onClick={() => handleModeChange('current')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors focus:ring-1 focus:ring-black focus:outline-none ${
            mode === 'current'
              ? 'bg-vercel-gray-600 text-white'
              : 'bg-vercel-gray-50 text-vercel-gray-600 border border-vercel-gray-100 hover:bg-vercel-gray-100'
          }`}
        >
          Current Month
        </button>
        <button
          onClick={() => handleModeChange('month')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors focus:ring-1 focus:ring-black focus:outline-none ${
            mode === 'month'
              ? 'bg-vercel-gray-600 text-white'
              : 'bg-vercel-gray-50 text-vercel-gray-600 border border-vercel-gray-100 hover:bg-vercel-gray-100'
          }`}
        >
          Select Month
        </button>
        <button
          onClick={() => handleModeChange('custom')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors focus:ring-1 focus:ring-black focus:outline-none ${
            mode === 'custom'
              ? 'bg-vercel-gray-600 text-white'
              : 'bg-vercel-gray-50 text-vercel-gray-600 border border-vercel-gray-100 hover:bg-vercel-gray-100'
          }`}
        >
          Custom Range
        </button>
      </div>

      {mode === 'month' && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleMonthChange('prev')}
            className="p-1.5 rounded-md border border-vercel-gray-100 hover:bg-vercel-gray-50 transition-colors focus:ring-1 focus:ring-black focus:outline-none"
          >
            <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-vercel-gray-600 min-w-[120px] text-center">
            {format(selectedMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => handleMonthChange('next')}
            className="p-1.5 rounded-md border border-vercel-gray-100 hover:bg-vercel-gray-50 transition-colors focus:ring-1 focus:ring-black focus:outline-none"
          >
            <svg className="w-4 h-4 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className="px-3 py-1.5 text-sm border border-vercel-gray-100 rounded-md bg-white text-vercel-gray-600 focus:ring-1 focus:ring-black focus:outline-none"
          />
          <span className="text-vercel-gray-400">/</span>
          <input
            type="date"
            value={format(dateRange.end, 'yyyy-MM-dd')}
            onChange={(e) => handleCustomDateChange('end', e.target.value)}
            className="px-3 py-1.5 text-sm border border-vercel-gray-100 rounded-md bg-white text-vercel-gray-600 focus:ring-1 focus:ring-black focus:outline-none"
          />
        </div>
      )}

      <div className="ml-auto text-sm text-vercel-gray-400">
        {format(dateRange.start, 'MMM d')} - {format(dateRange.end, 'MMM d, yyyy')}
      </div>
    </div>
  );
}
