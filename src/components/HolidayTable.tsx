import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import type { BulgarianHoliday } from '../types';

interface HolidayTableProps {
  holidays: BulgarianHoliday[];
  loading: boolean;
  onEdit: (holiday: BulgarianHoliday) => void;
  onDelete: (holiday: BulgarianHoliday) => void;
}

export function HolidayTable({ holidays, loading, onEdit, onDelete }: HolidayTableProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openMenuId]);

  // Close menu on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuId(null);
      }
    };

    if (openMenuId) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openMenuId]);

  const handleMenuToggle = (id: string) => {
    setOpenMenuId(openMenuId === id ? null : id);
  };

  const handleEdit = (holiday: BulgarianHoliday) => {
    setOpenMenuId(null);
    onEdit(holiday);
  };

  const handleDelete = (holiday: BulgarianHoliday) => {
    setOpenMenuId(null);
    onDelete(holiday);
  };
  if (loading) {
    return (
      <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <div className="p-8 text-center">
          <div className="inline-flex items-center gap-2 text-[#666666]">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm">Loading holidays...</span>
          </div>
        </div>
      </div>
    );
  }

  if (holidays.length === 0) {
    return (
      <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA]">
        <div className="p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-[#EAEAEA]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-4 text-sm text-[#666666]">No holidays found for this year</p>
          <p className="mt-1 text-[12px] text-[#888888]">Click "Sync Year" to add standard holidays</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[#FAFAFA] border-b border-[#EAEAEA]">
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Date
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Holiday Name
              </th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Source
              </th>
              <th className="px-4 py-3 text-right text-[10px] font-bold text-[#888888] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAEAEA]">
            {holidays.map((holiday) => (
              <tr
                key={holiday.id}
                className="hover:bg-[#FAFAFA] transition-colors duration-200 ease-out"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#000000]">
                      {format(new Date(holiday.holiday_date), 'MMM d')}
                    </span>
                    <span className="text-[12px] text-[#666666]">
                      {format(new Date(holiday.holiday_date), 'EEEE')}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-[#000000]">{holiday.holiday_name}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                    holiday.is_system_generated
                      ? 'bg-[#F5F5F5] text-[#666666]'
                      : 'bg-[#000000] text-[#FFFFFF]'
                  }`}>
                    {holiday.is_system_generated ? 'Auto' : 'Manual'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="relative" ref={openMenuId === holiday.id ? menuRef : null}>
                    <button
                      onClick={() => handleMenuToggle(holiday.id)}
                      className="p-1.5 rounded-md hover:bg-[#EAEAEA] transition-colors focus:outline-none"
                      title="More actions"
                    >
                      <svg className="w-4 h-4 text-[#666666]" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>

                    {openMenuId === holiday.id && (
                      <div
                        className="absolute right-0 mt-1 w-36 bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] overflow-hidden z-50"
                        style={{
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
                        }}
                      >
                        <button
                          onClick={() => handleEdit(holiday)}
                          className="w-full px-3 py-2 text-left text-sm text-[#000000] hover:bg-[#FAFAFA] transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4 text-[#666666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(holiday)}
                          className="w-full px-3 py-2 text-left text-sm text-[#EE0000] hover:bg-[#FEF2F2] transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
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
