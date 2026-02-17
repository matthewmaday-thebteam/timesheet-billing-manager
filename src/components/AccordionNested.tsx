/**
 * AccordionNested - Official Design System Atom
 *
 * A 3-level collapsible accordion with left border hierarchy indicator.
 * Used for Project → Resource → Task breakdown patterns.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (hover)
 * - Border: vercel-gray-100 (container, left line)
 * - Text: vercel-gray-600, vercel-gray-400, vercel-gray-300
 * - Radius: rounded-lg, rounded-md
 */

import { useState, type ReactNode } from 'react';

export interface AccordionNestedLevel3Item {
  /** Unique key for the item */
  id: string;
  /** Main label/title */
  label: string;
  /** Detail entries displayed as mono-xs (e.g., date/time breakdowns) */
  details: string[];
  /** Value displayed on the right (e.g., "8.5h") */
  value: string;
}

export interface AccordionNestedLevel2Item {
  /** Unique key for the item */
  id: string;
  /** Display name shown in the row */
  label: string;
  /** Value displayed on the right (e.g., "40.0h") */
  value: string;
  /** Level 3 children */
  children: AccordionNestedLevel3Item[];
}

export interface AccordionNestedProps {
  /** Content displayed on the left side of the header */
  header: ReactNode;
  /** Optional content displayed on the right side of the header */
  headerRight?: ReactNode;
  /** Level 2 items (each can expand to show Level 3) */
  items: AccordionNestedLevel2Item[];
  /** Whether the accordion starts expanded */
  defaultExpanded?: boolean;
  /** Optional className for the container */
  className?: string;
}

export function AccordionNested({
  header,
  headerRight,
  items,
  defaultExpanded = false,
  className = '',
}: AccordionNestedProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={`bg-white rounded-lg border border-vercel-gray-100 overflow-hidden ${className}`}>
      {/* Level 1: Main header */}
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

      {/* Level 1 expanded content */}
      {expanded && (
        <div className="border-t border-vercel-gray-100 py-2">
          {items.map((item) => {
            const isItemExpanded = expandedItems.has(item.id);

            return (
              <div key={item.id} className="border-l-2 border-vercel-gray-100 ml-[52px]">
                {/* Level 2: Item row */}
                <button
                  onClick={() => toggleItem(item.id)}
                  className="w-full flex items-center justify-between py-3 pl-3 pr-4 text-left focus:outline-none"
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`w-3 h-3 text-vercel-gray-400 transition-transform ${isItemExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-vercel-gray-600">{item.label}</span>
                  </div>
                  <span className="text-sm font-medium text-vercel-gray-600 mr-2.5">{item.value}</span>
                </button>

                {/* Level 3: Children */}
                {isItemExpanded && item.children.length > 0 && (
                  <div className="pl-8 pb-2 space-y-1">
                    {item.children.map((child) => (
                      <div
                        key={child.id}
                        className="flex items-center justify-between py-2 px-3 text-sm bg-white rounded-md"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-vercel-gray-600 truncate block">{child.label}</span>
                          {child.details.length > 0 && (
                            <div className="flex gap-2 mt-1 flex-wrap">
                              {child.details.map((detail, i) => (
                                <span key={i} className="text-xs font-mono text-vercel-gray-300">
                                  {detail}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="ml-4 mr-[10px] text-sm font-medium text-vercel-gray-200 whitespace-nowrap">
                          {child.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AccordionNested;
