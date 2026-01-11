import { format } from 'date-fns';
import { DropdownMenu } from './DropdownMenu';
import { Spinner } from './Spinner';
import { Badge } from './Badge';
import type { BulgarianHoliday } from '../types';

interface HolidayTableProps {
  holidays: BulgarianHoliday[];
  loading: boolean;
  onEdit: (holiday: BulgarianHoliday) => void;
  onDelete: (holiday: BulgarianHoliday) => void;
}

export function HolidayTable({ holidays, loading, onEdit, onDelete }: HolidayTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-vercel-gray-400">
            <Spinner size="md" />
            <span className="text-sm">Loading holidays...</span>
          </div>
        </div>
      </div>
    );
  }

  if (holidays.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-vercel-gray-100">
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-vercel-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-4 text-sm text-vercel-gray-400">No holidays found for this year</p>
          <p className="mt-1 text-xs text-vercel-gray-300">Click "Sync Year" to add standard holidays</p>
        </div>
      </div>
    );
  }

  const getMenuItems = (holiday: BulgarianHoliday) => [
    {
      label: 'Edit',
      onClick: () => onEdit(holiday),
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
    },
    {
      label: 'Delete',
      onClick: () => onDelete(holiday),
      variant: 'danger' as const,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
    },
  ];

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-vercel-gray-50 border-b border-vercel-gray-100">
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Date
              </th>
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Holiday Name
              </th>
              <th className="px-4 py-3 text-left text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Source
              </th>
              <th className="px-4 py-3 text-right text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vercel-gray-100">
            {holidays.map((holiday) => (
              <tr
                key={holiday.id}
                className="hover:bg-vercel-gray-50 transition-colors duration-200 ease-out"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-vercel-gray-600">
                      {format(new Date(holiday.holiday_date), 'MMM d')}
                    </span>
                    <span className="text-xs text-vercel-gray-400">
                      {format(new Date(holiday.holiday_date), 'EEEE')}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-vercel-gray-600">{holiday.holiday_name}</span>
                </td>
                <td className="px-4 py-3">
                  {holiday.is_system_generated ? (
                    <Badge variant="default" size="sm">Auto</Badge>
                  ) : (
                    <Badge variant="info" size="sm">Manual</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end">
                    <DropdownMenu items={getMenuItems(holiday)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
