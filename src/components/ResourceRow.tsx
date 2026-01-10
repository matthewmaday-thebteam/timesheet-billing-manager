import { useState } from 'react';
import { minutesToHours } from '../utils/calculations';
import { TaskList } from './TaskList';
import type { ResourceSummary } from '../types';

interface ResourceRowProps {
  resource: ResourceSummary;
}

export function ResourceRow({ resource }: ResourceRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l-2 border-gray-200 ml-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-2 px-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-gray-700">{resource.userName}</span>
        </div>
        <span className="text-gray-600 font-medium">
          {minutesToHours(resource.totalMinutes)}h
        </span>
      </button>

      {expanded && (
        <div className="pb-2">
          <TaskList tasks={resource.tasks} />
        </div>
      )}
    </div>
  );
}
