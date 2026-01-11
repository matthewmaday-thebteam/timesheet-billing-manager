import { useState, useMemo } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns';
import type { BulgarianHoliday } from '../types';

interface HolidayCalendarProps {
  holidays: BulgarianHoliday[];
  year: number;
  onDateClick?: (date: Date, holiday?: BulgarianHoliday) => void;
}

export function HolidayCalendar({ holidays, year, onDateClick }: HolidayCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date(year, 0, 1));
  const [lastYear, setLastYear] = useState<number>(year);

  // Update currentMonth when year changes (React-recommended pattern)
  if (year !== lastYear) {
    setLastYear(year);
    setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
  }

  const holidayMap = useMemo(() => {
    const map = new Map<string, BulgarianHoliday>();
    holidays.forEach((h) => {
      map.set(h.holiday_date, h);
    });
    return map;
  }, [holidays]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const handlePrevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 p-4">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handlePrevMonth}
          className="p-1.5 rounded-md hover:bg-vercel-gray-50 transition-colors focus:outline-none"
        >
          <svg className="w-5 h-5 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-sm font-semibold text-vercel-gray-600">
          {format(currentMonth, 'MMMM yyyy')}
        </h3>
        <button
          onClick={handleNextMonth}
          className="p-1.5 rounded-md hover:bg-vercel-gray-50 transition-colors focus:outline-none"
        >
          <svg className="w-5 h-5 text-vercel-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Week Day Headers */}
      <div className="grid grid-cols-7 mb-2">
        {weekDays.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-vercel-gray-400 uppercase tracking-wider py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const holiday = holidayMap.get(dateKey);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <button
              key={dateKey}
              onClick={() => onDateClick?.(day, holiday)}
              className={`
                relative aspect-square flex flex-col items-center justify-center rounded-full
                text-sm transition-colors duration-200 ease-out
                ${isToday && !holiday ? 'border border-vercel-gray-100' : ''}
                ${!isCurrentMonth ? 'text-vercel-gray-200' : ''}
                ${isCurrentMonth && !holiday && !isWeekend ? 'text-vercel-gray-600' : ''}
                ${isCurrentMonth && isWeekend && !holiday ? 'text-vercel-gray-400' : ''}
                ${holiday ? 'bg-bteam-brand text-white' : ''}
                ${!holiday && !isToday ? 'hover:bg-vercel-gray-50' : ''}
                focus:outline-none
              `}
              title={holiday?.holiday_name}
            >
              <span className={`${holiday ? 'font-semibold' : ''}`}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
