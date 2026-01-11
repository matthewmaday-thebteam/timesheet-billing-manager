import { useState } from 'react';
import { minutesToHours } from '../utils/calculations';
import { ResourceRow } from './ResourceRow';
import type { ProjectSummary } from '../types';

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-vercel-gray-100 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-vercel-gray-50 transition-colors focus:ring-1 focus:ring-black focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-vercel-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <h3 className="text-sm font-semibold text-vercel-gray-600">{project.projectName}</h3>
            <p className="text-xs text-vercel-gray-400">
              {project.resources.length} resource{project.resources.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-vercel-gray-600">
            {minutesToHours(project.totalMinutes)}h
          </div>
          <div className="text-xs text-vercel-gray-400">total</div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-vercel-gray-100 py-2">
          {project.resources.map((resource) => (
            <ResourceRow key={resource.userName} resource={resource} />
          ))}
        </div>
      )}
    </div>
  );
}
