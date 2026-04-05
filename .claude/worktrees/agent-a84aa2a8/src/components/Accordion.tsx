/**
 * Accordion - Official Design System Atom
 *
 * A collapsible content container with a clickable header.
 * Extracted from ProjectCard and BillingRatesTable patterns.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (hover)
 * - Border: vercel-gray-100
 * - Text: vercel-gray-600, vercel-gray-400
 * - Radius: rounded-lg
 */

import { useState, type ReactNode } from 'react';

export interface AccordionProps {
  /** Content displayed on the left side of the header */
  header: ReactNode;
  /** Optional content displayed on the right side of the header */
  headerRight?: ReactNode;
  /** Content displayed when expanded */
  children: ReactNode;
  /** Whether the accordion starts expanded */
  defaultExpanded?: boolean;
  /** Optional className for the container */
  className?: string;
}

export function Accordion({
  header,
  headerRight,
  children,
  defaultExpanded = false,
  className = '',
}: AccordionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`bg-white rounded-lg border border-vercel-gray-100 overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-vercel-gray-50 transition-colors focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-vercel-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>{header}</div>
        </div>
        {headerRight && <div>{headerRight}</div>}
      </button>

      {expanded && (
        <div className="border-t border-vercel-gray-100">
          {children}
        </div>
      )}
    </div>
  );
}

export default Accordion;
