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
    <div className="bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 text-left hover:bg-[#FAFAFA] transition-colors focus:ring-1 focus:ring-black focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-[#666666] transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div>
            <h3 className="text-sm font-semibold text-[#000000]">{project.projectName}</h3>
            <p className="text-[12px] text-[#666666]">
              {project.resources.length} resource{project.resources.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-[#000000]">
            {minutesToHours(project.totalMinutes)}h
          </div>
          <div className="text-[12px] text-[#666666]">total</div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#EAEAEA] py-2">
          {project.resources.map((resource) => (
            <ResourceRow key={resource.userName} resource={resource} />
          ))}
        </div>
      )}
    </div>
  );
}
