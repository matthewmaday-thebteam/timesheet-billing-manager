/**
 * Badge - Official Design System Atom
 *
 * Promoted from ProposedBadge (Task 015)
 * Consolidates 20+ status indicator patterns found in audit.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Colors: success-*, warning-*, error-*, info-*
 * - Background: vercel-gray-50
 * - Text: vercel-gray-400
 * - Radius: rounded
 */

import { forwardRef, type HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Badge style variant */
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  /** Badge size */
  size?: 'sm' | 'md';
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', size = 'md', children, ...props }, ref) => {
    const variantClasses = {
      default: 'bg-vercel-gray-50 text-vercel-gray-400',
      success: 'bg-success-light text-success-text',
      warning: 'bg-warning-light text-warning-text',
      error: 'bg-error-light text-error-text',
      info: 'bg-info-light text-info-text',
    };

    const sizeClasses = {
      sm: 'px-1.5 py-0.5 text-2xs',
      md: 'px-2 py-1 text-xs',
    };

    return (
      <span
        ref={ref}
        className={`inline-flex items-center font-medium rounded ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

export default Badge;
