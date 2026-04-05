import { useState, useMemo, useRef, useCallback } from 'react';
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
import type { BulgarianHoliday, EmployeeTimeOff } from '../types';

interface HolidayCalendarProps {
  holidays: BulgarianHoliday[];
  timeOff?: EmployeeTimeOff[];
  year: number;
  onDateClick?: (date: Date, holiday?: BulgarianHoliday) => void;
}

export function HolidayCalendar({ holidays, timeOff = [], year, onDateClick }: HolidayCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date(year, 0, 1));
  const [lastYear, setLastYear] = useState<number>(year);

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    dateKey: string;
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

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

  // Build map of dates → employees off that day
  const timeOffMap = useMemo(() => {
    const map = new Map<string, { name: string; type: string }[]>();
    for (const to of timeOff) {
      const start = new Date(to.start_date + 'T00:00:00');
      const end = new Date(to.end_date + 'T00:00:00');
      const current = new Date(start);
      while (current <= end) {
        const key = format(current, 'yyyy-MM-dd');
        const existing = map.get(key) || [];
        existing.push({ name: to.employee_name, type: to.time_off_type });
        map.set(key, existing);
        current.setDate(current.getDate() + 1);
      }
    }
    return map;
  }, [timeOff]);

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

  const handleMouseEnter = useCallback((dateKey: string, e: React.MouseEvent) => {
    const holiday = holidayMap.get(dateKey);
    const employees = timeOffMap.get(dateKey);
    if (!holiday && !employees) return;

    // Get position relative to the calendar container
    const calendarRect = calendarRef.current?.getBoundingClientRect();
    const targetRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!calendarRect) return;

    const x = targetRect.left - calendarRect.left + targetRect.width / 2;
    const y = targetRect.top - calendarRect.top;

    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setTooltip({ dateKey, x, y, visible: true });
    }, 1000);
  }, [holidayMap, timeOffMap]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setTooltip((prev) => prev ? { ...prev, visible: false } : null);
    // Remove from DOM after fade
    setTimeout(() => setTooltip(null), 200);
  }, []);

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Build tooltip content
  const tooltipContent = useMemo(() => {
    if (!tooltip) return null;
    const holiday = holidayMap.get(tooltip.dateKey);
    const employees = timeOffMap.get(tooltip.dateKey);
    return { holiday, employees };
  }, [tooltip, holidayMap, timeOffMap]);

  return (
    <div ref={calendarRef} className="bg-white rounded-lg border border-vercel-gray-100 p-4 relative">
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
          const hasTimeOff = timeOffMap.has(dateKey);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <button
              key={dateKey}
              onClick={() => onDateClick?.(day, holiday)}
              onMouseEnter={(e) => handleMouseEnter(dateKey, e)}
              onMouseLeave={handleMouseLeave}
              className={`
                relative aspect-square flex flex-col items-center justify-center rounded-full
                text-sm transition-colors duration-200 ease-out
                ${isToday && !holiday && !hasTimeOff ? 'border border-vercel-gray-100' : ''}
                ${!isCurrentMonth ? 'text-vercel-gray-200' : ''}
                ${isCurrentMonth && !holiday && !hasTimeOff && !isWeekend ? 'text-vercel-gray-600' : ''}
                ${isCurrentMonth && isWeekend && !holiday && !hasTimeOff ? 'text-vercel-gray-400' : ''}
                ${holiday ? 'bg-bteam-brand text-white' : ''}
                ${hasTimeOff && !holiday ? 'bg-vercel-gray-50 text-vercel-gray-600' : ''}
                ${!holiday && !hasTimeOff && !isToday ? 'hover:bg-vercel-gray-50' : ''}
                focus:outline-none
              `}
            >
              <span className={`${holiday || hasTimeOff ? 'font-semibold' : ''}`}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && tooltipContent && (tooltipContent.holiday || tooltipContent.employees) && (
        <div
          className={`absolute z-10 pointer-events-none transition-opacity duration-200 ease-out ${
            tooltip.visible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-vercel-gray-600 text-white rounded-md px-3 py-2 text-xs shadow-lg whitespace-nowrap">
            {tooltipContent.holiday && (
              <div className="font-semibold">{tooltipContent.holiday.holiday_name}</div>
            )}
            {tooltipContent.employees && (
              <div className={tooltipContent.holiday ? 'mt-1.5 pt-1.5 border-t border-white/20' : ''}>
                {tooltipContent.employees.map((emp, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span>{emp.name}</span>
                    <span className="text-white/60">{emp.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Arrow */}
          <div
            className="w-2 h-2 bg-vercel-gray-600 rotate-45 mx-auto -mt-1"
          />
        </div>
      )}
    </div>
  );
}
