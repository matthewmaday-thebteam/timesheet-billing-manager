/**
 * AccordionFlat - Official Design System Atom
 *
 * A 2-level collapsible accordion with table content.
 * Used for Billing Rates & Revenue pattern.
 *
 * @official 2026-01-11
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (header/footer)
 * - Border: vercel-gray-100
 * - Text: vercel-gray-600, vercel-gray-400
 * - Radius: rounded-lg
 */

import { useState, Fragment, type ReactNode } from 'react';

export interface AccordionFlatColumn {
  /** Unique key for the column */
  key: string;
  /** Column header label */
  label: string;
  /** Text alignment */
  align?: 'left' | 'right' | 'center';
}

export interface AccordionFlatRow {
  /** Unique key for the row */
  id: string;
  /** Cell values keyed by column key */
  cells: Record<string, ReactNode>;
}

export interface AccordionFlatFooterCell {
  /** Column key this cell belongs to */
  columnKey: string;
  /** Cell content */
  content: ReactNode;
}

export interface AccordionFlatGroup {
  /** Unique key for the group */
  id: string;
  /** Group header label */
  label: string;
  /** Optional content displayed on the right side of group header */
  labelRight?: ReactNode;
  /** Rows belonging to this group */
  rows: AccordionFlatRow[];
}

export interface AccordionFlatProps {
  /** Content displayed on the left side of the header (optional) */
  header?: ReactNode;
  /** Optional content displayed on the right side of the header */
  headerRight?: ReactNode;
  /** Table column definitions */
  columns: AccordionFlatColumn[];
  /** Table row data (use this OR groups, not both) */
  rows?: AccordionFlatRow[];
  /** Grouped row data (use this OR rows, not both) */
  groups?: AccordionFlatGroup[];
  /** Optional footer cells */
  footer?: AccordionFlatFooterCell[];
  /** Whether the accordion starts expanded */
  defaultExpanded?: boolean;
  /** Whether group sections start expanded (only applies when using groups) */
  groupsDefaultExpanded?: boolean;
  /** When true, removes expand/collapse functionality and keeps content always visible */
  alwaysExpanded?: boolean;
  /** Optional className for the container */
  className?: string;
}

export function AccordionFlat({
  header,
  headerRight,
  columns,
  rows,
  groups,
  footer,
  defaultExpanded = false,
  groupsDefaultExpanded = true,
  alwaysExpanded = false,
  className = '',
}: AccordionFlatProps) {
  const [expanded, setExpanded] = useState(alwaysExpanded || defaultExpanded);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groupsDefaultExpanded && groups ? groups.map(g => g.id) : [])
  );

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Determine if we're in grouped mode
  const isGrouped = groups && groups.length > 0;
  const displayRows = isGrouped ? [] : (rows || []);

  const hasHeader = header || headerRight;

  return (
    <div className={`bg-white rounded-lg border border-vercel-gray-100 overflow-hidden ${className}`}>
      {/* Header - only render if header content exists */}
      {hasHeader && (
        alwaysExpanded ? (
          <div className="w-full flex items-center justify-between p-6">
            {header && <div>{header}</div>}
            {headerRight && <div>{headerRight}</div>}
          </div>
        ) : (
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
              {header && <div>{header}</div>}
            </div>
            {headerRight && <div>{headerRight}</div>}
          </button>
        )
      )}

      {/* Table content */}
      {(alwaysExpanded || expanded) && (
        <div className="border-t border-vercel-gray-100">
          <table className="w-full">
            <thead className="bg-vercel-gray-50">
              <tr>
                {columns.map((column, colIndex) => {
                  const isLastColumn = colIndex === columns.length - 1;

                  // Last column (Revenue) needs spacer to align with Financial Line
                  if (isLastColumn && column.align === 'right') {
                    return (
                      <th
                        key={column.key}
                        className="px-6 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider text-right"
                      >
                        <div className="flex items-center justify-end">
                          <span>{column.label}</span>
                          {/* Spacer: 16px gap + 24px icon width */}
                          <div className="ml-4 w-6 shrink-0" />
                        </div>
                      </th>
                    );
                  }

                  return (
                    <th
                      key={column.key}
                      className={`px-6 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider ${
                        column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {column.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-vercel-gray-100">
              {isGrouped ? (
                // Grouped mode: render group headers with collapsible rows
                groups!.map((group) => {
                  const isGroupExpanded = expandedGroups.has(group.id);
                  return (
                    <Fragment key={group.id}>
                      {/* Group header row */}
                      <tr
                        className="bg-vercel-gray-50 cursor-pointer hover:bg-vercel-gray-100 transition-colors"
                        onClick={() => toggleGroup(group.id)}
                      >
                        <td colSpan={columns.length} className="px-6 py-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <svg
                                className={`w-3 h-3 text-vercel-gray-400 transition-transform ${isGroupExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="text-sm font-semibold text-black">{group.label}</span>
                            </div>
                            {group.labelRight && (
                              <div className="text-sm font-medium text-vercel-gray-500">{group.labelRight}</div>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Group rows (only shown when expanded) */}
                      {isGroupExpanded && group.rows.map((row) => (
                        <tr key={row.id} className="hover:bg-vercel-gray-50 transition-colors">
                          {columns.map((column, colIndex) => {
                            const isFirstCol = colIndex === 0;

                            // First column: indented for hierarchy
                            if (isFirstCol) {
                              return (
                                <td
                                  key={column.key}
                                  className="pl-10 pr-6 py-4 text-sm text-left"
                                >
                                  {row.cells[column.key]}
                                </td>
                              );
                            }

                            // Other columns: consistent 24px padding
                            return (
                              <td
                                key={column.key}
                                className={`px-6 py-4 text-sm ${
                                  column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                                }`}
                              >
                                {row.cells[column.key]}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })
              ) : (
                // Ungrouped mode: render rows directly
                displayRows.map((row) => (
                  <tr key={row.id} className="hover:bg-vercel-gray-50 transition-colors">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-6 py-4 text-sm ${
                          column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                        }`}
                      >
                        {row.cells[column.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {footer && footer.length > 0 && (
              <tfoot className="bg-vercel-gray-50">
                <tr>
                  {columns.map((column) => {
                    const footerCell = footer.find((f) => f.columnKey === column.key);
                    return (
                      <td
                        key={column.key}
                        className={`px-6 py-4 text-sm font-semibold text-vercel-gray-600 ${
                          column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                        }`}
                      >
                        {footerCell?.content}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

export default AccordionFlat;
