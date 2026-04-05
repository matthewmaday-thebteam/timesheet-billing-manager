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
    <div className="border-l-2 border-vercel-gray-100 ml-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-3 px-4 text-left focus:ring-1 focus:ring-black focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3 h-3 text-vercel-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-medium text-vercel-gray-600">{resource.displayName}</span>
        </div>
        <span className="text-sm font-medium text-vercel-gray-600">
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
