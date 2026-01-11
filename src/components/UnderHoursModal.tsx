import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Modal } from './Modal';
import { minutesToHours } from '../utils/calculations';
import type { UnderHoursResource } from '../utils/calculations';
import type { TimesheetEntry } from '../types';

interface UnderHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: UnderHoursResource[];
  entries: TimesheetEntry[];
  expectedHours: number;
  workingDaysElapsed: number;
  workingDaysTotal: number;
}

interface TaskEntry {
  client: string;
  date: string;
  task: string;
  minutes: number;
}

export function UnderHoursModal({
  isOpen,
  onClose,
  items,
  entries,
  expectedHours,
  workingDaysElapsed,
  workingDaysTotal,
}: UnderHoursModalProps) {
  const [expandedResourceId, setExpandedResourceId] = useState<string | null>(null);

  // Get task entries for a specific user
  // Sorted by: Client (A-Z) -> Date (Desc) -> Task Name (A-Z)
  const getTasksForUser = useMemo(() => {
    return (userName: string): TaskEntry[] => {
      const userEntries = entries.filter(e => e.user_name === userName);

      return userEntries
        .map(entry => ({
          client: entry.project_name,
          date: entry.work_date,
          task: entry.task_name,
          minutes: entry.total_minutes,
        }))
        .sort((a, b) => {
          // 1. Sort by Client (A-Z)
          const clientCompare = a.client.localeCompare(b.client);
          if (clientCompare !== 0) return clientCompare;
          // 2. Then by Date (Descending)
          const dateCompare = b.date.localeCompare(a.date);
          if (dateCompare !== 0) return dateCompare;
          // 3. Then by Task Name (A-Z)
          return a.task.localeCompare(b.task);
        });
    };
  }, [entries]);

  const handleResourceClick = (userName: string) => {
    setExpandedResourceId(expandedResourceId === userName ? null : userName);
  };

  // Sticky header content (summary cards + info banner)
  const stickyHeaderContent = (
    <div className="space-y-4 pb-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-vercel-gray-50 rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Prorated Target</p>
          <p className="text-lg font-semibold text-vercel-gray-600">
            {expectedHours.toFixed(1)} hrs
          </p>
        </div>
        <div className="p-4 bg-vercel-gray-50 rounded-lg border border-vercel-gray-100">
          <p className="text-xs text-vercel-gray-400 mb-1">Working Days</p>
          <p className="text-lg font-semibold text-vercel-gray-600">
            {workingDaysElapsed} / {workingDaysTotal}
          </p>
        </div>
      </div>

      {/* Info Banner */}
      <div className="p-4 bg-vercel-gray-50 rounded-lg border border-vercel-gray-100">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-warning mt-1.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-vercel-gray-600 font-medium">Monthly Target: 140 hours</p>
            <p className="text-xs text-vercel-gray-400 mt-1">
              Working days exclude weekends and Bulgarian public holidays
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resources Under Target"
      maxWidth="3xl"
      stickyHeader={stickyHeaderContent}
    >
      {/* Resource List */}
      {items.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-2.5 h-2.5 rounded-full bg-success mx-auto mb-3" />
          <p className="text-sm text-vercel-gray-400">All resources are on target</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Sticky Table Header */}
          <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-4 py-3 text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider border-b border-vercel-gray-100">
            <span>Resource</span>
            <span>Hours (Actual / Expected)</span>
          </div>

          {/* Resource Rows */}
          {items.map((item) => {
            const isExpanded = expandedResourceId === item.userName;
            const tasks = isExpanded ? getTasksForUser(item.userName) : [];

            return (
              <div key={item.userName} className="rounded-lg border border-vercel-gray-100 overflow-hidden">
                {/* Resource Row - Clickable */}
                <button
                  onClick={() => handleResourceClick(item.userName)}
                  className="w-full flex items-center justify-between p-4 bg-white hover:bg-vercel-gray-50 transition-colors duration-200 ease-out text-left focus:outline-none focus:ring-1 focus:ring-black"
                >
                  <div className="flex items-center gap-3">
                    {/* Chevron Indicator with smooth rotation */}
                    <svg
                      className={`w-4 h-4 text-vercel-gray-400 transition-transform duration-200 ease-out ${
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
                    <div className="w-2 h-2 rounded-full bg-error" />
                    <span className="text-sm font-medium text-vercel-gray-600">{item.displayName}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium text-vercel-gray-600">
                      {item.actualHours.toFixed(1)}h
                    </span>
                    <span className="text-sm text-vercel-gray-400 mx-1">/</span>
                    <span className="text-sm text-vercel-gray-400">
                      {item.expectedHours.toFixed(1)}h
                    </span>
                    <span className="text-sm text-error ml-3">
                      -{item.deficit.toFixed(1)}h
                    </span>
                  </div>
                </button>

                {/* Expanded Task List with CSS Transition */}
                <div
                  className={`bg-vercel-gray-50 border-t border-vercel-gray-100 overflow-hidden transition-all duration-200 ease-out ${
                    isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="border-l-2 border-vercel-gray-100 ml-4">
                    {tasks.length === 0 ? (
                      <div className="p-4 text-center">
                        <p className="text-xs text-vercel-gray-300">No tasks recorded for this period</p>
                      </div>
                    ) : (
                      <div className="p-4">
                        {/* Task Table */}
                        <table className="w-full table-auto">
                          <thead>
                            <tr className="text-2xs font-bold text-vercel-gray-300 uppercase tracking-wider">
                              <th className="text-left pb-2 pr-4">Client</th>
                              <th className="text-left pb-2 pr-4">Date</th>
                              <th className="text-left pb-2 pr-4">Task</th>
                              <th className="text-right pb-2">Time</th>
                            </tr>
                          </thead>
                          <tbody className="text-xs">
                            {tasks.map((task, index) => (
                              <tr
                                key={`${task.client}-${task.date}-${task.task}-${index}`}
                                className="border-t border-vercel-gray-100"
                              >
                                <td className="py-2 pr-4 text-vercel-gray-600 font-medium">
                                  {task.client}
                                </td>
                                <td className="py-2 pr-4 text-vercel-gray-400">
                                  {format(new Date(task.date), 'MMM d')}
                                </td>
                                <td className="py-2 pr-4 text-vercel-gray-400 max-w-[200px] truncate">
                                  {task.task}
                                </td>
                                <td className="py-2 text-right text-vercel-gray-600 font-medium">
                                  {minutesToHours(task.minutes)}h
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
