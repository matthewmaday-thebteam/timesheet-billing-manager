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

import { useState, type ReactNode } from 'react';

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

export interface AccordionFlatProps {
  /** Content displayed on the left side of the header */
  header: ReactNode;
  /** Optional content displayed on the right side of the header */
  headerRight?: ReactNode;
  /** Table column definitions */
  columns: AccordionFlatColumn[];
  /** Table row data */
  rows: AccordionFlatRow[];
  /** Optional footer cells */
  footer?: AccordionFlatFooterCell[];
  /** Whether the accordion starts expanded */
  defaultExpanded?: boolean;
  /** Optional className for the container */
  className?: string;
}

export function AccordionFlat({
  header,
  headerRight,
  columns,
  rows,
  footer,
  defaultExpanded = false,
  className = '',
}: AccordionFlatProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`bg-white rounded-lg border border-vercel-gray-100 overflow-hidden ${className}`}>
      {/* Header */}
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

      {/* Table content */}
      {expanded && (
        <div className="border-t border-vercel-gray-100">
          <table className="w-full">
            <thead className="bg-vercel-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-6 py-3 text-xs font-medium text-vercel-gray-400 uppercase tracking-wider ${
                      column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-vercel-gray-100">
              {rows.map((row) => (
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
              ))}
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
