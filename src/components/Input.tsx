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
 * - Colors: vercel-gray-*, bteam-brand (error)
 * - Border: vercel-gray-200, vercel-gray-400 (focus), bteam-brand (error)
 * - Radius: rounded-md
 *
 * Accessibility:
 * - Label associated via htmlFor/id
 * - Error/helper text linked via aria-describedby
 * - Error state indicated via aria-invalid
 */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Label text displayed above the input */
  label?: string;
  /** Error message displayed below the input */
  error?: string;
  /** Helper text displayed below the input (hidden when error is shown) */
  helperText?: string;
  /** Input size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Content to display before the input (e.g., "$" for currency) */
  prefix?: ReactNode;
  /** Content to display after the input (e.g., "USD" or an icon) */
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, helperText, size = 'md', disabled, id, prefix, suffix, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const sizeClasses = {
      sm: 'py-1 text-xs',
      md: 'py-2 text-sm',
      lg: 'py-3 text-base',
    };

    // Padding classes depend on whether prefix/suffix are present
    const paddingClasses = {
      sm: { left: prefix ? 'pl-7' : 'pl-2', right: suffix ? 'pr-7' : 'pr-2' },
      md: { left: prefix ? 'pl-8' : 'pl-3', right: suffix ? 'pr-8' : 'pr-3' },
      lg: { left: prefix ? 'pl-10' : 'pl-4', right: suffix ? 'pr-10' : 'pr-4' },
    };

    const baseClasses = 'w-full !bg-white rounded-md border transition-colors focus:outline-none focus:ring-1 focus:ring-offset-0 text-vercel-gray-600';

    const stateClasses = error
      ? 'border-bteam-brand focus:border-bteam-brand focus:ring-bteam-brand'
      : 'border-vercel-gray-200 focus:border-vercel-gray-400 focus:ring-vercel-gray-400';

    const disabledClasses = 'disabled:bg-vercel-gray-50 disabled:text-vercel-gray-200 disabled:cursor-not-allowed';
    const placeholderClasses = 'placeholder:text-vercel-gray-200';

    // Override browser autofill styles to keep white background
    const autofillClasses = 'autofill:!bg-white autofill:shadow-[inset_0_0_0px_1000px_white]';

    const inputClasses = `${baseClasses} ${stateClasses} ${disabledClasses} ${placeholderClasses} ${autofillClasses} ${sizeClasses[size]} ${paddingClasses[size].left} ${paddingClasses[size].right} ${className}`;

    // Build aria-describedby based on what's present
    const describedBy = error ? errorId : helperText ? helperId : undefined;

    // Addon position classes
    const addonSizeClasses = {
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-base',
    };

    const hasAddons = prefix || suffix;

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
        {hasAddons ? (
          <div className="relative">
            {prefix && (
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-vercel-gray-400 ${addonSizeClasses[size]} pointer-events-none`}>
                {prefix}
              </span>
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
            {suffix && (
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-vercel-gray-400 ${addonSizeClasses[size]} pointer-events-none`}>
                {suffix}
              </span>
            )}
          </div>
        ) : (
          <input
            ref={ref}
            id={inputId}
            className={inputClasses}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy}
            {...props}
          />
        )}
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
