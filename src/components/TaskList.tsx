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
          className="flex items-center justify-between py-1.5 px-3 text-sm bg-gray-50 rounded"
        >
          <div className="flex-1 min-w-0">
            <span className="text-gray-700 truncate block">{task.taskName}</span>
            <div className="flex gap-2 mt-0.5">
              {task.entries.slice(0, 5).map((entry, i) => (
                <span key={i} className="text-xs text-gray-400">
                  {format(new Date(entry.date), 'M/d')}: {minutesToHours(entry.minutes)}h
                </span>
              ))}
              {task.entries.length > 5 && (
                <span className="text-xs text-gray-400">
                  +{task.entries.length - 5} more
                </span>
              )}
            </div>
          </div>
          <span className="ml-4 text-gray-600 font-medium whitespace-nowrap">
            {minutesToHours(task.totalMinutes)}h
          </span>
        </div>
      ))}
    </div>
  );
}
