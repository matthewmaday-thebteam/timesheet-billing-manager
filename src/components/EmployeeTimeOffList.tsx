import { useMemo } from 'react';
import { Card } from './Card';
import { Spinner } from './Spinner';
import type { EmployeeTimeOff } from '../types';

interface EmployeeTimeOffListProps {
  timeOff: EmployeeTimeOff[];
  loading: boolean;
  year: number;
}

interface GroupedTimeOff {
  date: string;
  employees: {
    name: string;
    type: string;
    totalDays: number;
    isLinked: boolean;
  }[];
}

/**
 * Format a date string to display format
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get all dates between start and end (inclusive)
 */
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export function EmployeeTimeOffList({ timeOff, loading, year }: EmployeeTimeOffListProps) {
  // Group time-off by date, expanding multi-day ranges
  const groupedByDate = useMemo(() => {
    const dateMap = new Map<string, { name: string; type: string; totalDays: number; isLinked: boolean }[]>();

    for (const to of timeOff) {
      // Only include records for the selected year
      const startYear = new Date(to.start_date + 'T00:00:00').getFullYear();
      const endYear = new Date(to.end_date + 'T00:00:00').getFullYear();
      if (startYear !== year && endYear !== year) continue;

      const dates = getDateRange(to.start_date, to.end_date);

      for (const date of dates) {
        // Only include dates in the selected year
        if (!date.startsWith(String(year))) continue;

        const existing = dateMap.get(date) || [];
        existing.push({
          name: to.employee_name,
          type: to.time_off_type,
          totalDays: to.total_days,
          isLinked: to.resource_id !== null,
        });
        dateMap.set(date, existing);
      }
    }

    // Convert to sorted array
    const result: GroupedTimeOff[] = [];
    for (const [date, employees] of dateMap) {
      result.push({ date, employees });
    }

    // Sort by date
    result.sort((a, b) => a.date.localeCompare(b.date));

    return result;
  }, [timeOff, year]);

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-8">
          <Spinner size="md" />
          <span className="ml-3 text-sm text-vercel-gray-400">Loading time-off data...</span>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-4 py-3 border-b border-vercel-gray-100">
        <h3 className="text-sm font-semibold text-vercel-gray-600">
          Employee Time Off ({year})
        </h3>
        <p className="text-xs text-vercel-gray-400 mt-0.5">
          Synced from BambooHR
        </p>
      </div>

      {groupedByDate.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-vercel-gray-400">No time-off records for {year}</p>
        </div>
      ) : (
        <div className="divide-y divide-vercel-gray-100">
          {groupedByDate.map(({ date, employees }) => (
            <div key={date} className="px-4 py-3">
              <div className="flex items-start gap-4">
                <div className="w-24 flex-shrink-0">
                  <span className="text-sm font-medium text-vercel-gray-600">
                    {formatDate(date)}
                  </span>
                </div>
                <div className="flex-1">
                  {employees.map((emp, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className={`text-sm ${emp.isLinked ? 'text-vercel-gray-600' : 'text-vercel-gray-400'}`}>
                        {emp.name}
                      </span>
                      <span className="text-xs text-vercel-gray-400">({emp.type})</span>
                      {!emp.isLinked && (
                        <span className="text-xs text-warning">(not linked)</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
