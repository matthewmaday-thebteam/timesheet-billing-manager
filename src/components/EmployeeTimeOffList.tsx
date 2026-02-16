import { useMemo } from 'react';
import { format } from 'date-fns';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import type { EmployeeTimeOff } from '../types';

interface EmployeeTimeOffListProps {
  timeOff: EmployeeTimeOff[];
  loading: boolean;
  year: number;
}

export function EmployeeTimeOffList({ timeOff, loading, year }: EmployeeTimeOffListProps) {
  // Filter and sort time-off records for the selected year
  const filteredTimeOff = useMemo(() => {
    return timeOff
      .filter(to => {
        const startYear = new Date(to.start_date + 'T00:00:00').getFullYear();
        const endYear = new Date(to.end_date + 'T00:00:00').getFullYear();
        return startYear === year || endYear === year;
      })
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [timeOff, year]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-vercel-gray-400">
            <Spinner size="md" />
            <span className="text-sm">Loading time-off data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (filteredTimeOff.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="px-4 py-3 border-b border-vercel-gray-100">
          <h3 className="text-sm font-semibold text-vercel-gray-600">
            Employee Time Off ({year})
          </h3>
          <p className="text-xs text-vercel-gray-400 mt-0.5">
            Synced from BambooHR
          </p>
        </div>
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-vercel-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-4 text-sm text-vercel-gray-400">No time-off records for {year}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-vercel-gray-100">
        <h3 className="text-sm font-semibold text-vercel-gray-600">
          Employee Time Off ({year})
        </h3>
        <p className="text-xs text-vercel-gray-400 mt-0.5">
          Synced from BambooHR
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-vercel-gray-50 border-b border-vercel-gray-100">
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Employee
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Linked
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-vercel-gray-400 uppercase tracking-wider">
                Days
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {filteredTimeOff.map((to) => {
              const startDate = new Date(to.start_date + 'T00:00:00');
              const endDate = new Date(to.end_date + 'T00:00:00');
              const isLinked = to.resource_id !== null;
              const isSameDay = to.start_date === to.end_date;

              return (
                <tr
                  key={to.id}
                  className="hover:bg-vercel-gray-50 transition-colors duration-200 ease-out"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-vercel-gray-600">
                        {format(startDate, 'MMM d')}
                        {!isSameDay && ` – ${format(endDate, 'MMM d')}`}
                      </span>
                      <span className="text-xs text-vercel-gray-400">
                        {isSameDay ? format(startDate, 'EEEE') : format(startDate, 'EEE') + ' – ' + format(endDate, 'EEE')}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-vercel-gray-600">{to.employee_name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={to.time_off_type === 'Sick Leave' ? 'warning' : 'info'}>
                      {to.time_off_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {isLinked ? (
                      <Badge variant="success">Linked</Badge>
                    ) : (
                      <Badge variant="warning">Not Linked</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-vercel-gray-600">{to.total_days}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
