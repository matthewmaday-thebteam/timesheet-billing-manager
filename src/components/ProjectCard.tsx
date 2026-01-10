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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <h3 className="font-semibold text-gray-900">{project.projectName}</h3>
            <p className="text-sm text-gray-500">
              {project.resources.length} resource{project.resources.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-gray-900">
            {minutesToHours(project.totalMinutes)}h
          </div>
          <div className="text-xs text-gray-500">total</div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 py-2">
          {project.resources.map((resource) => (
            <ResourceRow key={resource.userName} resource={resource} />
          ))}
        </div>
      )}
    </div>
  );
}
