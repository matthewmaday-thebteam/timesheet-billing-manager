/**
 * Spinner - Official Design System Atom
 *
 * Promoted from ProposedSpinner (Task 014)
 * Consolidates 12+ inline spinner patterns found in audit.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Colors: vercel-gray-100 (track), vercel-gray-600 (spinner)
 * - For white variant: white with opacity
 */

import { forwardRef, type HTMLAttributes } from 'react';

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  /** Spinner size */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant for different backgrounds */
  color?: 'default' | 'white';
}

export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className = '', size = 'md', color = 'default', ...props }, ref) => {
    const sizeClasses = {
      sm: 'h-4 w-4 border-2',
      md: 'h-6 w-6 border-2',
      lg: 'h-8 w-8 border-[3px]',
    };

    const colorClasses = {
      default: 'border-vercel-gray-100 border-t-vercel-gray-600',
      white: 'border-white/30 border-t-white',
    };

    return (
      <div
        ref={ref}
        className={`animate-spin rounded-full ${sizeClasses[size]} ${colorClasses[color]} ${className}`}
        role="status"
        aria-label="Loading"
        {...props}
      />
    );
  }
);

Spinner.displayName = 'Spinner';

export default Spinner;
