/**
 * Checkbox - Official Design System Atom
 *
 * MUI-inspired checkbox with clean filled box and SVG check/indeterminate marks.
 * Supports label, description, and right-aligned endContent slot.
 *
 * @official 2026-02-12
 * @category Atom
 *
 * Token Usage:
 * - Border: vercel-gray-200 (unchecked), vercel-gray-400 (hover)
 * - Fill: vercel-gray-600 (checked/indeterminate)
 * - Text: vercel-gray-600 (label), vercel-gray-400 (description)
 * - Focus: ring-1 ring-black
 */

import { useId, useCallback, type ReactNode } from 'react';

export interface CheckboxProps {
  /** Whether the checkbox is checked */
  checked: boolean;
  /** Callback when checkbox state changes */
  onChange: (checked: boolean) => void;
  /** Label text displayed next to the checkbox */
  label?: string;
  /** Secondary text below label */
  description?: string;
  /** Show indeterminate dash instead of checkmark */
  indeterminate?: boolean;
  /** Whether the checkbox is disabled */
  disabled?: boolean;
  /** Additional CSS classes on the wrapper */
  className?: string;
  /** Right-side content (e.g. revenue amount) */
  endContent?: ReactNode;
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate = false,
  disabled = false,
  className = '',
  endContent,
}: CheckboxProps) {
  const id = useId();

  const handleChange = useCallback(() => {
    if (!disabled) onChange(!checked);
  }, [disabled, onChange, checked]);

  const setIndeterminate = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = indeterminate;
    },
    [indeterminate],
  );

  const isActive = checked || indeterminate;

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-center gap-3 select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      {/* Hidden native input for accessibility */}
      <input
        ref={setIndeterminate}
        id={id}
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        className="sr-only peer"
      />

      {/* Visual checkbox box */}
      <span
        className={`relative flex-shrink-0 inline-flex items-center justify-center w-[18px] h-[18px] rounded-[3px] border-2 transition-[background-color,border-color] duration-150 ease-out ${
          isActive
            ? 'bg-vercel-gray-600 border-vercel-gray-600'
            : 'bg-white border-vercel-gray-200'
        } ${
          !disabled && !isActive ? 'group-hover:border-vercel-gray-400 peer-hover:border-vercel-gray-400' : ''
        } peer-focus-visible:ring-1 peer-focus-visible:ring-black peer-focus-visible:ring-offset-1`}
      >
        {/* Checkmark SVG */}
        {checked && !indeterminate && (
          <svg
            className="w-3 h-3 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 12 9 17 20 7" />
          </svg>
        )}

        {/* Indeterminate dash SVG */}
        {indeterminate && (
          <svg
            className="w-3 h-3 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="6" y1="12" x2="18" y2="12" />
          </svg>
        )}
      </span>

      {/* Label + description + endContent */}
      {(label || description || endContent) && (
        <span className="flex flex-1 items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0">
            {label && (
              <span className="text-sm text-vercel-gray-600 leading-tight">
                {label}
              </span>
            )}
            {description && (
              <span className="block text-xs text-vercel-gray-400 leading-tight mt-0.5">
                {description}
              </span>
            )}
          </span>
          {endContent && (
            <span className="flex-shrink-0">{endContent}</span>
          )}
        </span>
      )}
    </label>
  );
}

export default Checkbox;
