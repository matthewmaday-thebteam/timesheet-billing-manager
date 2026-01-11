/**
 * Button - Official Design System Atom
 *
 * Promoted from ProposedButton (Task 014)
 * Consolidates 61 raw button patterns found in audit.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Colors: vercel-gray-*, error, error-hover
 * - Shadows: Uses focus ring utilities
 * - Radius: rounded-md (--radius-md)
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button style variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', children, disabled, ...props }, ref) => {
    const baseClasses = 'inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed';

    const variantClasses = {
      primary: [
        'bg-vercel-gray-600 text-white',
        'hover:bg-vercel-gray-500',
        'focus:ring-vercel-gray-600',
        'disabled:bg-vercel-gray-100 disabled:text-vercel-gray-200',
      ].join(' '),
      secondary: [
        'bg-white text-vercel-gray-600',
        'border border-vercel-gray-100',
        'hover:border-vercel-gray-200',
        'focus:ring-vercel-gray-600',
        'disabled:bg-vercel-gray-50 disabled:text-vercel-gray-200',
      ].join(' '),
      ghost: [
        'bg-transparent text-vercel-gray-400',
        'hover:bg-vercel-gray-50 hover:text-vercel-gray-600',
        'focus:ring-vercel-gray-600',
        'disabled:text-vercel-gray-200 disabled:hover:bg-transparent',
      ].join(' '),
      danger: [
        'bg-error text-white',
        'hover:bg-error-hover',
        'focus:ring-error',
        'disabled:bg-error-border disabled:text-vercel-gray-200',
      ].join(' '),
    };

    const sizeClasses = {
      sm: 'px-2 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    };

    return (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
