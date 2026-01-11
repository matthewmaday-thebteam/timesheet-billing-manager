/**
 * AccordionListTable - Official Design System Atom
 *
 * A list of expandable accordion items, each with table content.
 * Used for patterns like Resources Under Target where multiple items
 * can be expanded to show detailed table data.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (header, hover)
 * - Border: vercel-gray-100
 * - Text: vercel-gray-600, vercel-gray-400
 * - Radius: rounded-lg
 */

import { useState, type ReactNode } from 'react';

export interface AccordionListTableColumn {
  /** Unique key for the column */
  key: string;
  /** Column header label */
  label: string;
  /** Text alignment */
  align?: 'left' | 'right' | 'center';
}

export interface AccordionListTableRow {
  /** Unique key for the row */
  id: string;
  /** Cell values keyed by column key */
  cells: Record<string, ReactNode>;
}

export interface AccordionListTableItem {
  /** Unique identifier for the item */
  id: string;
  /** Content displayed on the left side of the header */
  headerLeft: ReactNode;
  /** Content displayed on the right side of the header */
  headerRight?: ReactNode;
  /** Optional status indicator color (renders as a dot) */
  statusColor?: 'error' | 'warning' | 'success';
  /** Table rows for this item */
  rows: AccordionListTableRow[];
  /** Empty state message when no rows */
  emptyMessage?: string;
}

export interface AccordionListTableProps {
  /** The accordion items */
  items: AccordionListTableItem[];
  /** Table column definitions (shared across all items) */
  columns: AccordionListTableColumn[];
  /** Optional className for the container */
  className?: string;
}

export function AccordionListTable({
  items,
  columns,
  className = '',
}: AccordionListTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleItem = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const statusColors = {
    error: 'bg-error',
    warning: 'bg-warning',
    success: 'bg-success',
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {items.map((item) => {
        const isExpanded = expandedId === item.id;

        return (
          <div
            key={item.id}
            className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden"
          >
            {/* Item Header */}
            <button
              onClick={() => toggleItem(item.id)}
              className="w-full flex items-center justify-between p-6 bg-white hover:bg-vercel-gray-50 transition-colors text-left focus:outline-none"
            >
              <div className="flex items-center gap-3">
                {/* Chevron */}
                <svg
                  className={`w-4 h-4 text-vercel-gray-400 transition-transform ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                {/* Status indicator */}
                {item.statusColor && (
                  <div className={`w-2 h-2 rounded-full ${statusColors[item.statusColor]}`} />
                )}
                {/* Header left content */}
                <div>{item.headerLeft}</div>
              </div>
              {/* Header right content */}
              {item.headerRight && <div>{item.headerRight}</div>}
            </button>

            {/* Expanded Table Content */}
            {isExpanded && (
              <div className="border-t border-vercel-gray-100">
                {item.rows.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-vercel-gray-300">
                      {item.emptyMessage || 'No data available'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-vercel-gray-50">
                      <tr>
                        {columns.map((column) => (
                          <th
                            key={column.key}
                            className={`px-6 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider ${
                              column.align === 'right'
                                ? 'text-right'
                                : column.align === 'center'
                                ? 'text-center'
                                : 'text-left'
                            }`}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-vercel-gray-100">
                      {item.rows.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-vercel-gray-50 transition-colors"
                        >
                          {columns.map((column) => (
                            <td
                              key={column.key}
                              className={`px-6 py-4 text-sm ${
                                column.align === 'right'
                                  ? 'text-right'
                                  : column.align === 'center'
                                  ? 'text-center'
                                  : 'text-left'
                              }`}
                            >
                              {row.cells[column.key]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default AccordionListTable;
