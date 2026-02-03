/**
 * ChevronIcon - Official Design System Atom
 *
 * Reusable chevron icon with direction and animation support.
 * Consolidates 10+ duplicate SVG patterns found in audit.
 *
 * @official 2026-01-24
 * @category Atom
 *
 * Token Usage:
 * - Colors: vercel-gray-300, vercel-gray-400
 * - Transition: transition-transform
 */

/** Direction the chevron points */
export type ChevronDirection = 'left' | 'right' | 'up' | 'down';

interface ChevronIconProps {
  /** Direction the chevron points (default: 'right') */
  direction?: ChevronDirection;
  /** Whether the chevron is in expanded state (rotated 90° clockwise from direction) */
  expanded?: boolean;
  /** Icon size */
  size?: 'xs' | 'sm' | 'md';
  /** Additional CSS classes */
  className?: string;
}

/** Rotation classes for each direction */
const directionClasses: Record<ChevronDirection, string> = {
  right: '',           // Default SVG points right
  down: 'rotate-90',
  left: 'rotate-180',
  up: '-rotate-90',
};

export function ChevronIcon({
  direction = 'right',
  expanded = false,
  size = 'sm',
  className = ''
}: ChevronIconProps) {
  const sizeClasses = {
    xs: 'w-2.5 h-2.5',
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
  };

  // When expanded is true, rotate 90° clockwise from the current direction
  const baseRotation = directionClasses[direction];
  const expandedRotation = expanded ? 'rotate-90' : '';

  // Combine rotations - expanded takes precedence for expand/collapse use case
  const rotationClass = expanded ? expandedRotation : baseRotation;

  return (
    <svg
      className={`${sizeClasses[size]} transition-transform ${rotationClass} ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default ChevronIcon;
