/**
 * ChevronIcon - Official Design System Atom
 *
 * Reusable expand/collapse chevron icon with rotation animation.
 * Consolidates 10+ duplicate SVG patterns found in audit.
 *
 * @official 2026-01-24
 * @category Atom
 *
 * Token Usage:
 * - Colors: vercel-gray-300, vercel-gray-400
 * - Transition: transition-transform
 */

interface ChevronIconProps {
  /** Whether the chevron is in expanded state (rotated 90°) */
  expanded?: boolean;
  /** Icon size */
  size?: 'xs' | 'sm' | 'md';
  /** Additional CSS classes */
  className?: string;
}

export function ChevronIcon({ expanded = false, size = 'sm', className = '' }: ChevronIconProps) {
  const sizeClasses = {
    xs: 'w-2.5 h-2.5',
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
  };

  return (
    <svg
      className={`${sizeClasses[size]} transition-transform ${expanded ? 'rotate-90' : ''} ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default ChevronIcon;
