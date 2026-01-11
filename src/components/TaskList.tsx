import { format } from 'date-fns';
import { minutesToHours } from '../utils/calculations';
import type { TaskSummary } from '../types';

interface TaskListProps {
  tasks: TaskSummary[];
}

export function TaskList({ tasks }: TaskListProps) {
  return (
    <div className="pl-8 space-y-1">
      {tasks.map((task, index) => (
        <div
          key={`${task.taskName}-${index}`}
          className="flex items-center justify-between py-2 px-3 text-sm bg-vercel-gray-50 rounded-md border border-vercel-gray-100"
        >
          <div className="flex-1 min-w-0">
            <span className="text-vercel-gray-600 truncate block">{task.taskName}</span>
            <div className="flex gap-2 mt-1">
              {task.entries.slice(0, 5).map((entry, i) => (
                <span key={i} className="text-xs text-vercel-gray-300">
                  {format(new Date(entry.date), 'M/d')}: {minutesToHours(entry.minutes)}h
                </span>
              ))}
              {task.entries.length > 5 && (
                <span className="text-xs text-vercel-gray-300">
                  +{task.entries.length - 5} more
                </span>
              )}
            </div>
          </div>
          <span className="ml-4 text-sm font-medium text-vercel-gray-600 whitespace-nowrap">
            {minutesToHours(task.totalMinutes)}h
          </span>
        </div>
      ))}
    </div>
  );
}
