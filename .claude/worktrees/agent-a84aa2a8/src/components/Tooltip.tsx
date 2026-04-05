import type { ReactNode } from 'react';

interface TooltipProps {
  /** Text content to display in the tooltip */
  content: string;
  /** Position relative to the trigger element */
  position?: 'top' | 'bottom';
  /** Trigger element */
  children: ReactNode;
}

/**
 * Tooltip - Official Design System Atom
 *
 * CSS-only hover tooltip using Tailwind group/tooltip.
 * Dark background, white text, compact sizing.
 *
 * @official 2026-02-26
 * @category Atom
 */
export function Tooltip({ content, position = 'top', children }: TooltipProps) {
  return (
    <span className="relative inline-flex group/tooltip">
      {children}
      <span
        className={`
          pointer-events-none absolute left-1/2 -translate-x-1/2 z-50
          whitespace-nowrap px-2 py-1 text-xs text-white
          bg-vercel-gray-600 rounded-md shadow-lg
          opacity-0 group-hover/tooltip:opacity-100
          transition-opacity duration-150
          ${position === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}
        `}
      >
        {content}
      </span>
    </span>
  );
}
