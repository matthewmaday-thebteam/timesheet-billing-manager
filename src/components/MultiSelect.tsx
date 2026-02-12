/**
 * MultiSelect - Official Design System Atom
 *
 * A dropdown that allows toggling multiple options on/off.
 * Visually matches the Select atom (same trigger, portal dropdown, focus ring).
 *
 * @official 2026-02-12
 * @category Atom
 *
 * Token Usage:
 * - Border: vercel-gray-100 (default), vercel-gray-300 (hover), vercel-gray-600 (focus)
 * - Text: vercel-gray-600 (selected), vercel-gray-400 (unselected), vercel-gray-300 (placeholder)
 * - Background: white (trigger/dropdown), vercel-gray-50 (hover row)
 * - Check icon: vercel-gray-600
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  /** Currently selected values */
  values: string[];
  /** Callback when selection changes */
  onChange: (values: string[]) => void;
  /** Available options */
  options: MultiSelectOption[];
  /** Placeholder when nothing selected */
  placeholder?: string;
  /** Additional CSS classes on the trigger */
  className?: string;
  /** Disable the component */
  disabled?: boolean;
}

export function MultiSelect({
  values,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
  disabled = false,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedSet = new Set(values);

  // Build display label
  const displayLabel =
    values.length === 0
      ? placeholder
      : values.length === options.length
        ? 'All columns'
        : options
            .filter(o => selectedSet.has(o.value))
            .map(o => o.label)
            .join(', ');

  // Calculate dropdown position
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

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
      if (!triggerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleToggle = (optionValue: string) => {
    if (selectedSet.has(optionValue)) {
      onChange(values.filter(v => v !== optionValue));
    } else {
      onChange([...values, optionValue]);
    }
  };

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="bg-white rounded-lg overflow-hidden"
      style={{
        position: 'fixed',
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
        minWidth: 120,
        zIndex: 9999,
        boxShadow:
          '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="py-1 max-h-60 overflow-y-auto scrollbar-thin">
        {options.map(option => {
          const isSelected = selectedSet.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleToggle(option.value)}
              className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between transition-colors hover:bg-vercel-gray-50 ${
                isSelected ? 'text-vercel-gray-600 font-medium' : 'text-vercel-gray-400'
              }`}
            >
              <span>{option.label}</span>
              {isSelected && (
                <svg className="w-4 h-4 text-vercel-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-left flex items-center justify-between gap-2 transition-colors duration-200 ease-out focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none ${
          disabled ? 'bg-vercel-gray-50 cursor-not-allowed' : 'hover:border-vercel-gray-300'
        } ${className}`}
      >
        <span
          className={`truncate ${
            disabled
              ? 'text-vercel-gray-300'
              : values.length > 0
                ? 'text-vercel-gray-600'
                : 'text-vercel-gray-300'
          }`}
        >
          {displayLabel}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${
            disabled ? 'text-vercel-gray-200' : 'text-vercel-gray-400'
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && !disabled && createPortal(dropdownContent, document.body)}
    </>
  );
}

export default MultiSelect;
