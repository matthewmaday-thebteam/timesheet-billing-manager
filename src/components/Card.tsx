/**
 * Card - Official Design System Atom
 *
 * Promoted from ProposedCard (Task 015)
 * Consolidates 44+ card-like div patterns found in audit.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Colors: white, vercel-gray-50, vercel-gray-100
 * - Shadow: shadow-card (for elevated variant)
 * - Radius: rounded-lg
 */

import { HTMLAttributes, forwardRef } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Card style variant */
  variant?: 'default' | 'elevated' | 'bordered' | 'subtle';
  /** Card padding */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', variant = 'default', padding = 'md', children, ...props }, ref) => {
    const variantClasses = {
      default: 'bg-white rounded-lg border border-vercel-gray-100',
      elevated: 'bg-white rounded-lg shadow-card',
      bordered: 'bg-white rounded-lg border-2 border-vercel-gray-100',
      subtle: 'bg-vercel-gray-50 rounded-lg',
    };

    const paddingClasses = {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
    };

    return (
      <div
        ref={ref}
        className={`${variantClasses[variant]} ${paddingClasses[padding]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export default Card;
