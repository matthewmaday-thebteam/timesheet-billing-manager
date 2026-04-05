/**
 * BurnGrid - Employee Daily Hours Grid
 *
 * Displays a matrix of employees vs days showing hours worked per day.
 * Used on the Burn page to show resource utilization details.
 *
 * Follows the same pattern as ProjectHierarchyTable.
 *
 * @official 2026-02-05
 * @category Atom
 *
 * Token Usage:
 * - Background: white, vercel-gray-50 (header)
 * - Border: vercel-gray-100
 * - Text: vercel-gray-600 (data), vercel-gray-400 (header)
 * - Radius: rounded-lg
 */

export interface BurnGridProps {
  /** Employee hours data sorted alphabetically */
  data: Array<{
    name: string;
    hoursByDate: Map<string, number>;
  }>;
  /** Start date of the range */
  startDate: Date;
  /** End date of the range */
  endDate: Date;
  /** Set of "name|YYYY-MM-DD" keys for cells that are under expected hours */
  underHoursCells?: Set<string>;
}

/**
 * Format hours to 1 decimal place, or return '—' for zero
 */
function formatHours(hours: number): string {
  if (hours === 0) return '—';
  return hours.toFixed(1);
}

/**
 * Generate array of day numbers and date strings for the range
 */
function getDaysInRange(startDate: Date, endDate: Date): Array<{ dayNum: number; dateStr: string }> {
  const days: Array<{ dayNum: number; dateStr: string }> = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    days.push({
      dayNum: current.getDate(),
      dateStr: `${year}-${month}-${day}`,
    });
    current.setDate(current.getDate() + 1);
  }

  return days;
}

export function BurnGrid({ data, startDate, endDate, underHoursCells }: BurnGridProps) {
  const days = getDaysInRange(startDate, endDate);

  if (data.length === 0) {
    return (
      <div className="text-sm text-vercel-gray-400 text-center py-8">
        No employee data for the selected period.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-vercel-gray-50">
            <tr>
              <th className="sticky left-0 bg-vercel-gray-50 px-6 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Employee
              </th>
              {days.map(({ dayNum, dateStr }) => (
                <th
                  key={dateStr}
                  className="px-3 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider min-w-[48px]"
                >
                  {dayNum}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {data.map((employee) => (
              <tr key={employee.name} className="hover:bg-vercel-gray-50 transition-colors">
                <td className="sticky left-0 bg-white px-6 py-3 text-sm font-medium text-vercel-gray-600 whitespace-nowrap">
                  {employee.name}
                </td>
                {days.map(({ dateStr }) => {
                  const hours = employee.hoursByDate.get(dateStr) || 0;
                  const isUnder = underHoursCells?.has(`${employee.name}|${dateStr}`);
                  return (
                    <td
                      key={dateStr}
                      className={`px-3 py-3 text-sm tabular-nums text-right ${
                        isUnder ? 'text-bteam-brand font-semibold' : 'text-vercel-gray-600'
                      }`}
                    >
                      {formatHours(hours)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default BurnGrid;
