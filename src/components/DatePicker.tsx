import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  parse,
  isValid,
} from 'date-fns';

interface DatePickerProps {
  value: string; // ISO date string (yyyy-MM-dd)
  onChange: (date: string) => void;
  placeholder?: string;
  error?: boolean;
}

export function DatePicker({ value, onChange, placeholder = 'Select date', error }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) {
      const parsed = parse(value, 'yyyy-MM-dd', new Date());
      return isValid(parsed) ? parsed : new Date();
    }
    return new Date();
  });
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate dropdown position when opening
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, 288), // min 288px (w-72)
      });
    }
  }, []);

  // Parse the value to a Date object
  const selectedDate = useMemo(() => {
    if (!value) return null;
    const parsed = parse(value, 'yyyy-MM-dd', new Date());
    return isValid(parsed) ? parsed : null;
  }, [value]);

  // Update currentMonth when value changes
  useEffect(() => {
    if (selectedDate) {
      setCurrentMonth(selectedDate);
    }
  }, [selectedDate]);

  // Update position when opening and on scroll/resize
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
    }
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target);
      const clickedDropdown = containerRef.current?.contains(target);

      if (!clickedTrigger && !clickedDropdown) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

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

  const handleDateSelect = (date: Date) => {
    onChange(format(date, 'yyyy-MM-dd'));
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const handleToday = () => {
    const today = new Date();
    onChange(format(today, 'yyyy-MM-dd'));
    setCurrentMonth(today);
    setIsOpen(false);
  };

  const weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  const displayValue = selectedDate ? format(selectedDate, 'MMM d, yyyy') : '';

  const dropdownContent = (
    <div
      ref={containerRef}
      className="bg-[#FFFFFF] rounded-xl border border-[#E5E7EB] overflow-hidden"
      style={{
        position: 'fixed',
        top: dropdownPosition.top - window.scrollY,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
        zIndex: 9999,
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="p-1 rounded-md hover:bg-[#F3F4F6] transition-colors focus:outline-none"
        >
          <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-[#111827]">
          {format(currentMonth, 'MMMM yyyy')}
        </span>
        <button
          type="button"
          onClick={handleNextMonth}
          className="p-1 rounded-md hover:bg-[#F3F4F6] transition-colors focus:outline-none"
        >
          <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Week Day Headers */}
      <div className="grid grid-cols-7 px-3 pt-3">
        {weekDays.map((day) => (
          <div
            key={day}
            className="text-center text-[11px] font-medium text-[#9CA3AF] py-1"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-0.5 p-3">
        {calendarDays.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => handleDateSelect(day)}
              className={`
                aspect-square flex items-center justify-center rounded-full
                text-sm transition-all duration-150 ease-out
                ${!isCurrentMonth ? 'text-[#D1D5DB]' : 'text-[#111827]'}
                ${isSelected ? 'bg-[#000000] text-[#FFFFFF] font-medium' : ''}
                ${!isSelected && isCurrentMonth ? 'hover:bg-[#F3F4F6]' : ''}
                ${isToday && !isSelected ? 'font-semibold text-[#000000]' : ''}
                focus:outline-none
              `}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E7EB] bg-[#FAFAFA]">
        <button
          type="button"
          onClick={handleClear}
          className="text-sm text-[#6B7280] hover:text-[#111827] transition-colors focus:outline-none"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleToday}
          className="text-sm font-medium text-[#000000] hover:text-[#333333] transition-colors focus:outline-none"
        >
          Today
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative">
      {/* Input Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 bg-[#FFFFFF] border rounded-md text-sm text-left flex items-center justify-between transition-colors duration-200 ease-out focus:ring-1 focus:ring-black focus:outline-none ${
          error
            ? 'border-[#EE0000] focus:border-[#EE0000]'
            : 'border-[#EAEAEA] focus:border-[#000000]'
        }`}
      >
        <span className={displayValue ? 'text-[#000000]' : 'text-[#888888]'}>
          {displayValue || placeholder}
        </span>
        <svg
          className="w-4 h-4 text-[#666666]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </button>

      {/* Dropdown Calendar via Portal */}
      {isOpen && createPortal(dropdownContent, document.body)}
    </div>
  );
}
