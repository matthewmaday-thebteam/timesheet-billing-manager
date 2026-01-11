/**
 * Input - Official Design System Atom
 *
 * Promoted from ProposedInput (Task 015)
 * Consolidates 17 raw input patterns found in audit.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Colors: vercel-gray-*, error, error-text
 * - Border: vercel-gray-100, vercel-gray-600 (focus)
 * - Radius: rounded-md
 *
 * Accessibility:
 * - Label associated via htmlFor/id
 * - Error/helper text linked via aria-describedby
 * - Error state indicated via aria-invalid
 */

import { forwardRef, useId, type InputHTMLAttributes } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Label text displayed above the input */
  label?: string;
  /** Error message displayed below the input */
  error?: string;
  /** Helper text displayed below the input (hidden when error is shown) */
  helperText?: string;
  /** Input size variant */
  size?: 'sm' | 'md' | 'lg';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, helperText, size = 'md', disabled, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const sizeClasses = {
      sm: 'px-2 py-1 text-xs',
      md: 'px-3 py-2 text-sm',
      lg: 'px-4 py-3 text-base',
    };

    const baseClasses = 'w-full bg-white rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0';

    const stateClasses = error
      ? 'border-error focus:border-error focus:ring-error'
      : 'border-vercel-gray-100 focus:border-vercel-gray-600 focus:ring-vercel-gray-600';

    const disabledClasses = 'disabled:bg-vercel-gray-50 disabled:text-vercel-gray-200 disabled:cursor-not-allowed';
    const placeholderClasses = 'placeholder:text-vercel-gray-200';

    const inputClasses = `${baseClasses} ${stateClasses} ${disabledClasses} ${placeholderClasses} ${sizeClasses[size]} ${className}`;

    // Build aria-describedby based on what's present
    const describedBy = error ? errorId : helperText ? helperId : undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-vercel-gray-600 mb-1"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={inputClasses}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1 text-xs font-mono text-bteam-brand" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="mt-1 text-xs text-vercel-gray-400">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
